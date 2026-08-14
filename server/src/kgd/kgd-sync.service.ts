import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { KgdClientService } from './kgd-client.service';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';
import { KgdGoodsCache } from './kgd-goods-cache.entity';
import { KgdReportCache } from '../report/kgd-report-cache.entity';
import { User } from '../auth/users.entity';
import { KgdSyncMeta } from './kgd-sync-meta.entity';

const PAGE_SIZE = 100;
const CONCURRENCY = 6; // 分页并发数：实测串行 41 页 28s，并发 6 约 5s，并发 8 约 4s
const SYNC_INTERVAL = 5 * 60 * 1000; // 每 5 分钟滚动同步一次
const REPORT_OVERLAP_SEC = 60; // 报工增量窗口与上次游标重叠秒数，防止边界漏数据
const REPORT_FULL_RECONCILE_SEC = 24 * 60 * 60; // 报工全量对账间隔：每天一次清理本地已存在但远程已删除的记录（需即时全量时用长按刷新按钮）
const REPORT_RECENT_DAYS = 3; // 手动刷新（短按增量）时报工覆盖最近天数：完善近期被修改/漏同步的报工记录
const BILL_FULL_RECONCILE_SEC = 24 * 60 * 60; // 加工单全量对账间隔：每天一次（长按刷新可强制触发）
const TASK_FULL_RECONCILE_SEC = 24 * 60 * 60; // 任务全量对账间隔：每天一次（长按刷新可强制触发）
const GOODS_FULL_RECONCILE_SEC = 24 * 60 * 60; // 商品全量对账间隔：每天一次
/** 滚动同步只拉活动状态（已完成/已取消的历史数据由全量对账刷新）：加工单 未开始(1)+生产中(2) */
const BILL_ACTIVE_STATUSES = [1, 2, 5]; // 加工单活动状态：1=未开始 2=进行中 5=已暂停（5 纳入增量，缓存才能及时反映暂停；前端仍按 1,2 过滤显示）
/** 任务活动状态：未开始(1)+进行中(2)+已暂停(4) */
const TASK_ACTIVE_STATUSES = [1, 2, 4];
/** 全量同步时间窗口：只拉近一年内的数据，超过一年的历史不获取。
 *  报工按 report_time、任务按 updated_at 服务端过滤；本地超过一年的记录保留不误删（见全量清理保护） */
const FULL_SYNC_WINDOW_DAYS = 365;

/** 格式化为 'YYYY-MM-DD HH:mm:ss'（快工单 report_time 过滤精确到秒） */
function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 将 'YYYY-MM-DD HH:mm:ss' 向前回退 n 秒 */
function minusSeconds(s: string, sec: number): string {
  const d = new Date(`${s.replace(' ', 'T')}`);
  d.setSeconds(d.getSeconds() - sec);
  return fmtDateTime(d);
}

/** 将 'YYYY-MM-DD HH:mm:ss' 向前回退 n 天 */
function minusDays(s: string, days: number): string {
  const d = new Date(`${s.replace(' ', 'T')}`);
  d.setDate(d.getDate() - days);
  return fmtDateTime(d);
}

/** 任务状态码：1=未开始 2=进行中 3=已完成 4=暂停/取消（接口只返回 status_name 字符串） */
const TASK_STATUS_MAP: Record<string, number> = {
  未开始: 1,
  进行中: 2,
  已完成: 3,
  已暂停: 4,
  已取消: 4,
};

/** 从接口自定义字段中取值（如 HT图号） */
function extractFieldValue(fieldList: { name: string; value?: string }[] | undefined, name: string): string | null {
  const f = (fieldList ?? []).find((x) => x.name === name);
  return f?.value ?? null;
}

/**
 * 快工单数据滚动同步：
 * - 分页（每页 100 条）拉取加工单 / 生产任务，upsert 到本地缓存表
 * - 避免一次性大批量请求；前端查询改为读本地缓存，秒级响应
 */
@Injectable()
export class KgdSyncService implements OnModuleInit {
  private readonly logger = new Logger(KgdSyncService.name);
  /** 进行中的同步任务，避免并发重复同步（定时同步与手动刷新共用） */
  private currentSync: Promise<void> | null = null;

  constructor(
    private readonly kgdClient: KgdClientService,
    private readonly config: ConfigService,
    @InjectRepository(KgdBillCache) private readonly bills: Repository<KgdBillCache>,
    @InjectRepository(KgdTaskCache) private readonly tasks: Repository<KgdTaskCache>,
    @InjectRepository(KgdGoodsCache) private readonly goods: Repository<KgdGoodsCache>,
    @InjectRepository(KgdReportCache) private readonly reportCache: Repository<KgdReportCache>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(KgdSyncMeta) private readonly syncMeta: Repository<KgdSyncMeta>,
  ) {}

  onModuleInit() {
    // 自动定时同步（KGD_AUTO_SYNC=false 的开发环境只保留手动按钮刷新，避免与生产环境同时拉取快工单打架）
    if (!this.config.get<boolean>('autoSync')) {
      this.logger.log('自动定时同步已禁用（KGD_AUTO_SYNC=false），仅保留手动刷新（短按增量 / 长按全量）');
      return;
    }
    // 延迟到凭证就绪后再同步
    setTimeout(() => this.syncNow(), 8_000);
  }

  /** 定时自动同步（每 5 分钟）。仅定时器触发，受 KGD_AUTO_SYNC 开关控制；手动刷新 / 写操作后的 requestSync 不受影响 */
  @Interval(SYNC_INTERVAL)
  async autoSync(): Promise<void> {
    if (!this.config.get<boolean>('autoSync')) return;
    await this.syncNow();
  }

  /** 查询触发的即时同步节流窗口：30 秒内只真正执行一次，间隔内的查询直接读缓存返回 */
  private static readonly QUERY_SYNC_THROTTLE_MS = 30_000;
  private lastSyncStartedAt = 0;

  /** 触发一次即时同步（手动刷新 / 写操作后 / 定时器调用，可等待完成）。
   *  throttleMs>0 表示查询触发的节流同步：距上次真正执行不足 throttleMs 时直接跳过（读缓存返回） */
  syncNow(forceFull = false, reportWindowDays = 0, throttleMs = 0): Promise<void> {
    const now = Date.now();
    if (throttleMs > 0 && now - this.lastSyncStartedAt < throttleMs) return Promise.resolve();
    if (this.currentSync) return this.currentSync;
    this.currentSync = this.doSync(forceFull, reportWindowDays).finally(() => {
      this.currentSync = null;
    });
    this.lastSyncStartedAt = now;
    return this.currentSync;
  }

  private async doSync(forceFull = false, reportWindowDays = 0) {
    const start = Date.now();
    try {
      await Promise.all([
        this.syncBills(forceFull),
        this.syncTasks(forceFull, reportWindowDays),
        this.syncReportRecords(forceFull, reportWindowDays),
        this.syncGoods(forceFull),
        this.syncUsers(),
      ]);
      this.logger.log(`数据同步完成，耗时 ${Date.now() - start}ms`);
    } catch (e) {
      this.logger.warn(`数据同步失败: ${(e as Error).message}\n${(e as Error).stack}`);
    }
  }

  /** 用户滚动同步：新增本地账号、刷新岗位名（报工人选择等依赖本地用户表，须及时更新） */
  private async syncUsers() {
    const start = Date.now();
    const adminUsername = this.config.get<string>('kgd.username');
    const defaultPassword = this.config.get<string>('kgd.defaultPassword', 'kgd123456');
    const { data: kgdUsers } = await this.kgdClient.listUsers({ pageNo: 1, pageSize: 500 });
    let created = 0;
    let updated = 0;
    for (const u of kgdUsers ?? []) {
      const roleName = u.role?.name ?? '';
      const exists = await this.users.findOneBy({ kgdUserId: u.id });
      if (exists) {
        if (exists.roleName !== roleName) {
          await this.users.update({ id: exists.id }, { roleName });
          updated++;
        }
        continue;
      }
      const hash = await bcrypt.hash(defaultPassword, 10);
      await this.users.save(
        this.users.create({
          kgdUserId: u.id,
          username: u.name ?? `u${u.id}`,
          name: u.real_name ?? u.name ?? '',
          password: hash,
          role: u.name === adminUsername ? 'admin' : 'worker',
          roleName,
        }),
      );
      created++;
    }
    this.logger.log(`用户同步完成：新增 ${created}，更新岗位 ${updated}，耗时 ${Date.now() - start}ms`);
  }

  /**
   * 加工单滚动同步：活动状态（未开始+生产中+已暂停）增量为主 + 定期全量对账
   * - 增量：只拉 BILL_ACTIVE_STATUSES 状态，请求量从 40+ 页降到 3 页，毫秒级完成
   *   （含 5=已暂停：快工单暂停的单若不入增量，本地缓存将停留在旧"进行中"状态，前端刷新仍显示）
   * - 全量对账：首次 / 距上次对账超过 BILL_FULL_RECONCILE_SEC / 手动刷新强制时执行，拉全量并清理远程已删除记录、刷新已完成/已取消历史
   *   （加工单量小约千余条，且需保证暂停/完成状态准确，保持全量拉取；时间窗口仅用于报工与任务）
   */
  private async syncBills(forceFull = false) {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastFull = (await this.syncMeta.findOneBy({ key: 'bill_full_sync_at' }))?.value || null;
    const fullDue = forceFull || !lastFull || lastFull < minusSeconds(now, BILL_FULL_RECONCILE_SEC);

    if (fullDue) {
      const { all, total } = await this.fetchBills();
      await this.upsertBills(all);
      // 全量未截断时才清理本地已删除记录，避免误删
      if (total < 10_000 && all.length) {
        const ids = all.map((b: any) => b.id).filter((id: any) => id != null);
        const del = await this.bills
          .createQueryBuilder()
          .delete()
          .where('billId NOT IN (:...ids)', { ids })
          .execute();
        if (del.affected) this.logger.log(`加工单缓存清理完成：删除本地已失效 ${del.affected} 条`);
      }
      await this.syncMeta.upsert({ key: 'bill_full_sync_at', value: now }, ['key']);
      this.logger.log(`加工单同步完成(全量对账)：${all.length} 条，耗时 ${Date.now() - start}ms`);
      return;
    }

    let done = 0;
    for (const st of BILL_ACTIVE_STATUSES) {
      const { all } = await this.fetchBills(st);
      await this.upsertBills(all);
      done += all.length;
    }
    this.logger.log(`加工单同步完成(活动)：${done} 条，耗时 ${Date.now() - start}ms`);
  }

  /** 分页拉取加工单（status 为空即全量），并发拉取剩余页 */
  private async fetchBills(status?: number): Promise<{ all: any[]; total: number }> {
    const params = status !== undefined ? { status } : {};
    const first = await this.kgdClient.listProduceBills({ pageNo: 1, pageSize: PAGE_SIZE, ...params });
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 10_000);
    const all = [...firstList];
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listProduceBills({ pageNo, pageSize: PAGE_SIZE, ...params });
        all.push(...(data ?? []));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { all, total };
  }

  private async upsertBills(all: any[]) {
    if (!all.length) return;
    const rows = all.map((b: any) => ({
      billId: b.id,
      code: b.code ?? '',
      htNo: extractFieldValue(b.fieldValueList, 'HT图号'),
      goodsName: b.goods?.name ?? '',
      goodsSpec: b.goods?.standard ?? '',
      num: Number(b.num ?? 0),
      unitName: b.goods?.unit?.name ?? 'PCS',
      status: Number(b.status ?? 0),
      statusName: b.status_name ?? '',
      planStart: b.start_produce_date ?? null,
      planEnd: b.end_produce_date ?? null,
      deliveryDate: b.delivery_date ?? null,
    }));
    await this.bills.upsert(rows, ['billId']);
  }

  /**
   * 生产任务滚动同步：活动状态（未开始+进行中+已暂停）增量为主 + 定期全量对账
   * - 增量：只拉 TASK_ACTIVE_STATUSES 状态，请求量从 40+ 页降到 3 页
   * - 近 N 天已完成：快工单内报满量会【自动】把任务置为已完成（status=3），
   *   活动状态增量拉不到，若不补拉本地会一直停留旧状态；
   *   用 updated_at 窗口精准补拉 [当前-N天, 当前] 的已完成任务（实测仅 1 页 37 条）
   * - 全量对账：首次 / 距上次对账超过 TASK_FULL_RECONCILE_SEC / 手动刷新强制时执行，按 updated_at 拉近一年
   *   （超过一年的历史不获取），刷新活动/已完成状态；清理仅限"活动或近一年完成"的失效任务，超一年本地历史保留
   */
  private async syncTasks(forceFull = false, reportWindowDays = 0) {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastFull = (await this.syncMeta.findOneBy({ key: 'task_full_sync_at' }))?.value || null;
    const fullDue = forceFull || !lastFull || lastFull < minusSeconds(now, TASK_FULL_RECONCILE_SEC);

    if (fullDue) {
      // 全量只拉近一年（updated_at 窗口）：超过一年的历史不再获取
      const { all, total } = await this.fetchTasks(undefined, minusDays(now, FULL_SYNC_WINDOW_DAYS));
      await this.upsertTasks(all);
      // 全量：用公版 order_number 校准真实工艺顺序（OpenAPI 返回按 id 升序，非真实顺序；
      // 快工单真实顺序由可拖动的 order_number 决定，需登录公版 Web 接口获取）
      try {
        const orders = await this.kgdClient.fetchWebCraftOrders();
        await this.applyCraftSeq(orders);
        this.logger.log(`工艺顺序校准完成：更新 ${orders.size} 条（来源：公版 order_number）`);
      } catch (e) {
        this.logger.warn(`工艺顺序校准失败：${(e as Error).message}`);
      }
      // 全量未截断时才清理本地已删除记录，避免误删；
      // 窗口只拉近一年，清理仅限"活动或近一年内完成"的任务，超过一年的本地历史保留不误删
      if (total < 10_000 && all.length) {
        const ids = all.map((t: any) => t.id).filter((id: any) => id != null);
        const cutoff = minusDays(now, FULL_SYNC_WINDOW_DAYS);
        const del = await this.tasks
          .createQueryBuilder()
          .delete()
          .where('taskId NOT IN (:...ids)', { ids })
          .andWhere(`(end_time IS NULL OR end_time = '' OR end_time >= :cutoff)`, { cutoff })
          .execute();
        if (del.affected) this.logger.log(`任务缓存清理完成：删除本地已失效 ${del.affected} 条（仅限活动/近一年完成）`);
      }
      await this.syncMeta.upsert({ key: 'task_full_sync_at', value: now }, ['key']);
      this.logger.log(
        `任务同步完成(全量对账)：近一年 ${all.length} 条，耗时 ${Date.now() - start}ms`,
      );
      return;
    }

    let done = 0;
    for (const st of TASK_ACTIVE_STATUSES) {
      const { all } = await this.fetchTasks(st);
      await this.upsertTasks(all);
      done += all.length;
    }
    // 补拉近 N 天 updated_at 的已完成任务：快工单报满量自动完成（status=3），
    // 活动状态增量拉不到，若不补拉本地会一直停留旧状态（每日全量对账兜底）。
    // 用 updated_at 窗口精准补拉，1 页请求即可（实测近 3 天仅 37 条）
    const doneDays = reportWindowDays > 0 ? reportWindowDays : 3;
    const { all: doneTasks } = await this.fetchTasks(3, minusDays(now, doneDays));
    if (doneTasks.length) {
      await this.upsertTasks(doneTasks);
      done += doneTasks.length;
    }
    // 增量：补齐新下订单的真实工艺顺序（仅校准本地 craft_seq 为空的活动任务，
    // 保证新单即使被拖过工序也能与公版一致；存量单由每日全量对账校准）
    try {
      const pending = await this.tasks
        .createQueryBuilder()
        .select('t.taskId', 'taskId')
        .from(KgdTaskCache, 't')
        .where('t.craft_seq IS NULL')
        .andWhere('t.status IN (:...st)', { st: TASK_ACTIVE_STATUSES })
        .getRawMany<{ taskId: number }>();
      if (pending.length) {
        const orders = await this.kgdClient.fetchWebCraftOrders();
        const need = new Map<number, number>();
        for (const p of pending) {
          const seq = orders.get(Number(p.taskId));
          if (seq != null) need.set(Number(p.taskId), seq);
        }
        await this.applyCraftSeq(need);
        this.logger.log(`新单工艺顺序补齐：${need.size} 条（来源：公版 order_number）`);
      }
    } catch (e) {
      this.logger.warn(`新单工艺顺序补齐失败：${(e as Error).message}`);
    }
    this.logger.log(`任务同步完成(活动+近${doneDays}天已完成)：${done} 条，耗时 ${Date.now() - start}ms`);
  }

  /** 批量将 taskId → order_number 写入 craft_seq（CASE WHEN，1000 条一批） */
  private async applyCraftSeq(orders: Map<number, number>) {
    if (!orders.size) return;
    const entries = Array.from(orders.entries());
    const CHUNK = 1000;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const cases = chunk.map(([taskId, seq]) => `WHEN ${Number(taskId)} THEN ${Number(seq)}`).join(' ');
      const ids = chunk.map(([taskId]) => Number(taskId)).join(',');
      await this.tasks.query(
        `UPDATE kgd_task_cache SET craft_seq = CASE task_id ${cases} ELSE craft_seq END WHERE task_id IN (${ids})`,
      );
    }
  }

  /** 分页拉取生产任务（status 为空即全量；updatedAtStart 非空时按 updated_at 时间窗口拉取），并发拉取剩余页 */
  private async fetchTasks(status?: number, updatedAtStart?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (status !== undefined) params.status = status;
    if (updatedAtStart) {
      params.updated_at_start = updatedAtStart;
      params.updated_at_end = fmtDateTime(new Date());
    }
    const first = await this.kgdClient.listTasks({ pageNo: 1, pageSize: PAGE_SIZE, ...params });
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 10_000);
    const all = [...firstList];
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listTasks({ pageNo, pageSize: PAGE_SIZE, ...params });
        all.push(...(data ?? []));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { all, total };
  }

  /** 写入任务缓存（增量/全量共用；craft_seq 由全量分支用公版 order_number 单独校准） */
  private async upsertTasks(all: any[]) {
    if (!all.length) return;
    const rows = all.map((t: any) => ({
      taskId: t.id,
      billId: t.produce_bill?.id ?? 0,
      billCode: t.produce_bill?.code ?? '',
      htNo: extractFieldValue(t.fieldValueList, 'HT图号'),
      craftName: t.pub_craft?.name ?? '',
      craftCode: t.pub_craft?.code ?? null,
      goodsName: t.produce_bill?.goods?.name ?? '',
      goodsCode: t.produce_bill?.goods?.code ?? null,
      goodsSpec: t.produce_bill?.goods?.standard ?? '',
      num: t.num ?? '0',
      validNum: t.valid_num ?? '0',
      wasteNum: t.waste_num ?? '0',
      status: TASK_STATUS_MAP[t.status_name ?? ''] ?? 0,
      statusName: t.status_name ?? '',
      endTime: t.end_time ?? null,
      reportableUserNames: t.reportable_user_names ?? null,
      unitName: t.unit?.name ?? '',
      workshopPathNames: t.workshop_path_names ?? '',
      produceLineNames: t.produce_line_names ?? '',
    }));
    await this.tasks.upsert(rows, ['taskId']);
  }

  /**
   * 商品滚动同步：增量为主 + 定期全量对账
   * - 增量：以 kgd_sync_meta.goods_last_sync 为游标，仅拉 [游标-60s, 当前] 的 updated_at 窗口
   * - 全量对账：首次 / 距上次对账超过 GOODS_FULL_RECONCILE_SEC / forceFull 时执行，
   *   按 updated_at 拉近一年全量，清理本地已删除记录
   * - 商品量约千余条，开放接口 /goods 改读缓存；写操作（新增/编辑）后由 requestSync 快速刷新
   */
  private async syncGoods(forceFull = false) {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastSync = (await this.syncMeta.findOneBy({ key: 'goods_last_sync' }))?.value || null;
    const lastFull = (await this.syncMeta.findOneBy({ key: 'goods_full_sync_at' }))?.value || null;
    const fullDue = forceFull || !lastSync || !lastFull || lastFull < minusSeconds(now, GOODS_FULL_RECONCILE_SEC);

    if (fullDue) {
      const { all, total } = await this.fetchGoods(minusDays(now, FULL_SYNC_WINDOW_DAYS));
      await this.upsertGoods(all);
      // 全量未截断时才清理本地已删除记录，避免误删；
      // 窗口只拉近一年（updated_at），清理仅限"近一年内更新过"的商品，超过一年未更新的本地记录保留不误删
      if (total < 10_000 && all.length) {
        const ids = all.map((g: any) => g.id).filter((id: any) => id != null);
        const cutoff = minusDays(now, FULL_SYNC_WINDOW_DAYS);
        const del = await this.goods
          .createQueryBuilder()
          .delete()
          .where('goodsId NOT IN (:...ids)', { ids })
          .andWhere('updatedAt >= :cutoff', { cutoff })
          .execute();
        if (del.affected) this.logger.log(`商品缓存清理完成：删除本地已失效 ${del.affected} 条（仅限近一年更新）`);
      }
      await this.syncMeta.upsert({ key: 'goods_full_sync_at', value: now }, ['key']);
      await this.syncMeta.upsert({ key: 'goods_last_sync', value: now }, ['key']);
      this.logger.log(`商品同步完成(全量对账)：${all.length} 条，耗时 ${Date.now() - start}ms`);
      return;
    }

    const { all } = await this.fetchGoods(minusSeconds(lastSync!, REPORT_OVERLAP_SEC));
    await this.upsertGoods(all);
    await this.syncMeta.upsert({ key: 'goods_last_sync', value: now }, ['key']);
    this.logger.log(`商品同步完成(增量)：${all.length} 条，耗时 ${Date.now() - start}ms`);
  }

  /** 分页拉取商品（updatedAtStart 非空时按 updated_at 时间窗口拉取），并发拉取剩余页 */
  private async fetchGoods(updatedAtStart?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (updatedAtStart) {
      params.updated_at_start = updatedAtStart;
      params.updated_at_end = fmtDateTime(new Date());
    }
    const first = await this.kgdClient.listGoods({ pageNo: 1, pageSize: PAGE_SIZE, ...params });
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 10_000);
    const all = [...firstList];
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listGoods({ pageNo, pageSize: PAGE_SIZE, ...params });
        all.push(...(data ?? []));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { all, total };
  }

  /** 写入商品缓存（增量/全量共用；raw 保留快工单原始字段供本地过滤） */
  private async upsertGoods(all: any[]) {
    if (!all.length) return;
    const rows = all.map((g: any) => ({
      goodsId: g.id,
      code: g.code ?? '',
      name: g.name ?? '',
      standard: g.standard ?? '',
      categoryPathNames: g.category_path_names ?? '',
      source: Number(g.source ?? 0),
      sourceName: g.source_name ?? '',
      unitName: g.unit?.name ?? '',
      sellingMoney: g.selling_money ?? null,
      isEnable: g.is_enable != null ? Number(g.is_enable) : 1,
      updatedAt: g.updated_at ?? null,
      fieldValueList: g.fieldValueList ?? [],
      raw: g,
    }));
    await this.goods.upsert(rows, ['goodsId']);
  }

  /** 触发一次即时同步（写操作后 / 手动刷新时调用，可等待完成）。
   *  forceFull=true 强制全量对账；reportWindowDays>0 时报工记录改为覆盖最近 N 天窗口（手动刷新短按）；
   *  throttleMs>0 用于查询前同步（见 syncNow，默认不节流） */
  requestSync(forceFull = false, reportWindowDays = 0, throttleMs = 0): Promise<void> {
    return this.syncNow(forceFull, reportWindowDays, throttleMs);
  }

  /**
   * 报工记录同步：增量为主 + 定期全量对账
   * - 增量：以 kgd_sync_meta.report_last_sync 为游标，仅拉 [游标-60s, 当前时间] 窗口，省 OpenAPI 配额（定时轮询）
   * - 近 N 天：手动刷新短按时覆盖 [当前-N天, 当前] 窗口，完善近期被修改 / 漏同步的报工记录
   * - 全量对账：首次 / 距上次对账超过 REPORT_FULL_RECONCILE_SEC / 手动刷新长按强制时执行，按 report_time 拉近一年
   *   （超过一年的历史不获取）；窗口受限时跳过删除清理，超一年本地记录保留（见 fullSyncReportRecords）
   * - 本地已有（reportId 匹配）→ 更新业务字段；不写入 reportTime，避免覆盖本地报工时间
   * - 本地 reportId 为空的行按 加工单+工序+用户+数量 匹配补全 ID 再更新
   */
  private async syncReportRecords(forceFull = false, reportWindowDays = 0) {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastSync = (await this.syncMeta.findOneBy({ key: 'report_last_sync' }))?.value || null;
    const lastFull = (await this.syncMeta.findOneBy({ key: 'report_full_sync_at' }))?.value || null;
    const fullDue = forceFull || !lastSync || !lastFull || lastFull < minusSeconds(now, REPORT_FULL_RECONCILE_SEC);

    if (fullDue) {
      await this.fullSyncReportRecords(now);
      this.logger.log(`报工记录同步完成(全量对账)：耗时 ${Date.now() - start}ms`);
      return;
    }
    if (reportWindowDays > 0) {
      const from = minusDays(now, reportWindowDays);
      await this.incrementalSyncReportRecords(now, from, true);
      this.logger.log(`报工记录同步完成(近${reportWindowDays}天)：窗口 [${minusSeconds(from, REPORT_OVERLAP_SEC)}, ${now}]，耗时 ${Date.now() - start}ms`);
      return;
    }
    await this.incrementalSyncReportRecords(now, lastSync!);
    this.logger.log(`报工记录同步完成(增量)：窗口 [${minusSeconds(lastSync!, REPORT_OVERLAP_SEC)}, ${now}]，耗时 ${Date.now() - start}ms`);
  }

  /**
   * 全量拉取（仅近一年 report_time 窗口）+ upsert + 推进游标。
   * ⚠️ 窗口受限时【跳过删除清理】：本地 report_time 无值（纯同步记录）无法区分记录年龄，
   * 若继续按 "report_id NOT IN 远程集合" 清理，会把超过一年、未被本次窗口拉到的历史记录全部误删。
   * 超一年的本地历史保留；远程已删除记录的清理在窗口模式下放弃（宁保留不误删）。
   */
  private async fullSyncReportRecords(now: string) {
    const from = minusDays(now, FULL_SYNC_WINDOW_DAYS);
    const { all, total } = await this.fetchReportRecords({ report_time_start: from });
    await this.backfillNullReportIds(all);
    await this.upsertReportRows(all);
    this.logger.log(
      `报工全量对账：窗口 [${from}, ${now}] 拉取 ${all.length} 条（total=${total}）；窗口模式跳过本地删除清理（保留超一年历史）`,
    );
    // 同步成功后才推进游标（失败保持原游标，下次继续对账）
    await this.syncMeta.upsert({ key: 'report_last_sync', value: now }, ['key']);
    await this.syncMeta.upsert({ key: 'report_full_sync_at', value: now }, ['key']);
  }

  /** 按 [from, now] 窗口拉取 + upsert + 推进游标（from 为游标或近 N 天起点）
   *  cleanupWindow=true（手动短按近 N 天刷新）时额外做删除对账。
   *  ⚠️ 快工单报工列表接口返回的记录【不含时间戳字段】：
   *  - 纯同步记录（本地 report_time 为空）无法判断归属窗口，窗口路径绝不清理它们，
   *    否则会把窗口外的历史同步记录全部误删（历史 Bug：一次短按刷新删掉 3555 条）。
   *  - 远程已删除的同步记录统一由全量对账（每日 / 长按刷新）兜底清理。
   *  - 窗口路径只清理「本地报工时间落在本次拉取窗口内、却未被窗口拉到」的记录，
   *    此时该记录必定已在远程被删除（若远程仍在，窗口拉取必然返回它）。 */
  private async incrementalSyncReportRecords(now: string, from: string, cleanupWindow = false) {
    const fetchFrom = minusSeconds(from, REPORT_OVERLAP_SEC);
    const { all, total } = await this.fetchReportRecords({
      report_time_start: fetchFrom,
      report_time_end: now,
    });
    await this.backfillNullReportIds(all);
    await this.upsertReportRows(all);
    if (cleanupWindow && total < 10_000) {
      const ids = all.map((r: any) => r.id).filter((id: any) => id != null);
      if (ids.length) {
        // 只删本地报工时间落在本次拉取窗口内、却未在窗口数据中出现的记录；
        // 字符串比较对 'YYYY-MM-DD HH:mm:ss' 定长时间安全
        const del = await this.reportCache
          .createQueryBuilder()
          .delete()
          .where(
            'report_id IS NOT NULL AND report_id NOT IN (:...ids) AND report_time >= :fetchFrom AND report_time <= :now',
            { ids, fetchFrom, now },
          )
          .execute();
        if (del.affected) this.logger.log(`报工窗口对账完成：删除本地已失效 ${del.affected} 条`);
      }
    }
    await this.syncMeta.upsert({ key: 'report_last_sync', value: now }, ['key']);
  }

  /** 分页拉取报工记录（params 为空即全量） */
  private async fetchReportRecords(params: Record<string, unknown>) {
    const all: any[] = [];
    const query = { pageNo: 1, pageSize: PAGE_SIZE, ...params };
    const first = await this.kgdClient.listReportRecords(query);
    all.push(...(first.data ?? []));
    const total = Math.min(first.count ?? all.length, 10_000);
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listReportRecords({ ...query, pageNo, pageSize: PAGE_SIZE });
        if (data?.length) all.push(...data);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { all, total };
  }

  /** 补全本地 reportId 为空的记录（报工后即时写入、反查失败的兜底） */
  private async backfillNullReportIds(all: any[]) {
    const nullRows = await this.reportCache.find({ where: { reportId: IsNull() } });
    if (!nullRows.length) return;
    for (const nr of nullRows) {
      const hit = all.find(
        (r: any) =>
          (r.produce_bill?.code ?? '') === nr.billCode &&
          (r.pub_craft?.name ?? '') === nr.craftName &&
          String(r.report_user_id ?? '') === String(nr.reportUserId) &&
          String(r.valid_num ?? '0') === String(nr.validNum) &&
          String(r.waste_num ?? '0') === String(nr.wasteNum),
      );
      if (hit) {
        await this.reportCache.update({ id: nr.id }, { reportId: Number(hit.id) });
      }
    }
  }

  /** 远程报工记录行 → upsert 本地缓存（不含 reportTime，避免覆盖本地报工时间） */
  private async upsertReportRows(all: any[]) {
    const rows = all.map((r: any) => ({
      reportId: r.id,
      billCode: r.produce_bill?.code ?? '',
      craftName: r.pub_craft?.name ?? '',
      unitName: r.produce_bill_craft?.unit?.name ?? '',
      planNum: r.produce_bill_craft?.num ?? '',
      reportUserId: String(r.report_user_id ?? ''),
      reportUserName: r.report_user?.real_name ?? '',
      validNum: String(r.valid_num ?? '0'),
      wasteNum: String(r.waste_num ?? '0'),
      workingMinutes: r.working_minutes ?? 0,
      validMoney: String(r.valid_money ?? '0'),
      priceModeName: r.price_mode_name ?? '',
      remark: r.remark ?? null,
      syncedAt: new Date(),
    }));
    await this.reportCache.upsert(rows, ['reportId']);
  }
}
