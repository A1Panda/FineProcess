import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { KgdClientService } from './kgd-client.service';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';
import { KgdGoodsCache } from './kgd-goods-cache.entity';
import { KgdGoodsStockCache } from './kgd-goods-stock-cache.entity';
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
const GOODS_STOCK_FULL_RECONCILE_SEC = 24 * 60 * 60; // 商品库存全量对账间隔：每天一次
const GOODS_STOCK_PAGE_SIZE = 200; // 商品库存每页条数（公版实测 pageSize 200 有效，1.3k 行约 7 页）
const GOODS_STOCK_MIN_SYNC_SEC = 5 * 60; // 商品库存最小同步间隔：非全量场景距上次同步不足此时长直接跳过，避免查询高频触发对公版的重复全量拉取
/** 滚动同步只拉活动状态（已完成/已取消的历史数据由全量对账刷新）：加工单 未开始(1)+生产中(2) */
const BILL_ACTIVE_STATUSES = [1, 2, 5]; // 加工单活动状态：1=未开始 2=进行中 5=已暂停（5 纳入增量，缓存才能及时反映暂停；前端仍按 1,2 过滤显示）
/** 任务活动状态：未开始(1)+进行中(2)+已暂停(4) */
const TASK_ACTIVE_STATUSES = [1, 2, 4];
/** 全量同步时间窗口：所有全量对账只拉近一年内的数据，超过一年的历史不获取。
 *  报工按 report_time、任务按 updated_at、加工单按 created_at、商品按 updated_at 服务端过滤；
 *  本地超过一年的记录保留不误删（见各全量清理保护） */
const FULL_SYNC_WINDOW_DAYS = 365;
/** 公版 Web 报工记录列表每页条数（实测 pageSize 200 有效，全量 3665 条约 19 页） */
const WEB_PAGE_SIZE = 200;

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

/** 各同步模块的统计结果（供 doSync 汇总，日志统一口径） */
interface SyncStat {
  /** 本次拉取/处理的条数 */
  pulled: number;
  /** 本次清理的本地失效记录条数 */
  cleaned: number;
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
    @InjectRepository(KgdGoodsStockCache) private readonly goodsStock: Repository<KgdGoodsStockCache>,
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
    // 一次性加载全部同步游标/对账时间，各模块共享，避免逐个 findOneBy（每轮省约 6 次 DB 查询）
    await this.loadMeta();
    const jobs: { name: string; run: () => Promise<SyncStat> }[] = [
      { name: '加工单', run: () => this.syncBills(forceFull, reportWindowDays) },
      { name: '任务', run: () => this.syncTasks(forceFull, reportWindowDays) },
      { name: '报工记录', run: () => this.syncReportRecords(forceFull, reportWindowDays) },
      { name: '商品', run: () => this.syncGoods(forceFull) },
      { name: '库存', run: () => this.syncGoodsStock(forceFull) },
      { name: '用户', run: () => this.syncUsers() },
    ];
    // allSettled：单模块失败（如公版限流）不影响其他模块，汇总日志逐项标注成败；
    // 失败模块进入冷却（连续失败暂停重试），避免限流期间每 5 分钟持续撞墙
    const results = await Promise.allSettled(jobs.map((j) => this.runWithBackoff(j.name, j.run)));
    const failParts: string[] = [];
    const skipParts: string[] = [];
    let okCount = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value !== null) okCount++;
      else if (r.status === 'fulfilled') skipParts.push(jobs[i].name);
      else failParts.push(`${jobs[i].name}(${(r as PromiseRejectedResult).reason?.message ?? r.reason})`);
    });
    const skipText = skipParts.length ? `，跳过 ${skipParts.join('、')}` : '';
    if (failParts.length) {
      this.logger.warn(`数据同步完成：${okCount}/${results.length} 成功${skipText}，失败：${failParts.join('；')}，总耗时 ${Date.now() - start}ms`);
    } else {
      this.logger.log(`数据同步完成：${okCount}/${results.length} 成功${skipText}，总耗时 ${Date.now() - start}ms`);
    }
  }

  /** 模块失败退避状态：连续失败达到阈值后进入冷却，冷却期内跳过该模块（防限流撞墙） */
  private failState = new Map<string, { count: number; since: number }>();
  private readonly FAIL_MAX = 3; // 连续失败阈值
  private readonly FAIL_COOLDOWN_MS = 30 * 60 * 1000; // 冷却时长：30 分钟

  /** 包一层失败退避：成功清除状态；失败计数；冷却期内跳过返回 null */
  private async runWithBackoff(name: string, run: () => Promise<SyncStat>): Promise<SyncStat | null> {
    const st = this.failState.get(name);
    if (st && st.count >= this.FAIL_MAX && Date.now() - st.since < this.FAIL_COOLDOWN_MS) {
      const remainMin = Math.ceil((this.FAIL_COOLDOWN_MS - (Date.now() - st.since)) / 60000);
      this.logger.warn(`${name}同步跳过：连续失败 ${st.count} 次，${remainMin} 分钟后重试`);
      return null;
    }
    try {
      const stat = await run();
      this.failState.delete(name);
      return stat;
    } catch (e) {
      const cur = this.failState.get(name);
      if (cur) cur.count++;
      else this.failState.set(name, { count: 1, since: Date.now() });
      throw e; // 交给 doSync 汇总日志记录失败原因
    }
  }

  /** 同步游标/对账时间缓存（doSync 开头一次性加载，模块内只读） */
  private metaCache = new Map<string, string>();
  private async loadMeta() {
    const rows = await this.syncMeta.find();
    this.metaCache = new Map(rows.map((r) => [r.key, r.value ?? '']));
  }

  /** 判断某模块全量对账是否到期：从未全量 / 距上次对账超过间隔 */
  private fullDue(key: string, now: string, intervalSec: number): boolean {
    const last = this.metaCache.get(key);
    return !last || last < minusSeconds(now, intervalSec);
  }

  /** 用户滚动同步：新增本地账号、刷新岗位名（报工人选择等依赖本地用户表，须及时更新） */
  private async syncUsers(): Promise<SyncStat> {
    const start = Date.now();
    const adminUsername = this.config.get<string>('kgd.username');
    const defaultPassword = this.config.get<string>('kgd.defaultPassword', 'kgd123456');
    const { data: kgdUsers } = await this.kgdClient.listUsers({ pageNo: 1, pageSize: 500 });
    const users = kgdUsers ?? [];
    // 批量加载已存在账号，避免逐个 findOneBy（N+1）
    const kgdIds = users.map((u: any) => u.id).filter((id: any) => id != null);
    const existing = new Map<string, User>();
    if (kgdIds.length) {
      const rows = await this.users.find({ where: { kgdUserId: In(kgdIds) } });
      for (const r of rows) existing.set(String(r.kgdUserId), r);
    }
    let created = 0;
    let updated = 0;
    for (const u of users) {
      const roleName = u.role?.name ?? '';
      const exists = existing.get(String(u.id));
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
    return { pulled: created + updated, cleaned: 0 };
  }

  /**
   * 加工单滚动同步：活动状态（未开始+生产中+已暂停）增量为主 + 定期全量对账
   * - 增量：只拉 BILL_ACTIVE_STATUSES 状态，请求量从 40+ 页降到 3 页，毫秒级完成
   *   （含 5=已暂停：快工单暂停的单若不入增量，本地缓存将停留在旧"进行中"状态，前端刷新仍显示）
   * - 近 N 天已完成补拉：快工单整单完成（status=3）不在活动状态增量范围，
   *   若不补拉本地会一直停留旧"进行中"状态（完工预测/工序进度误判未完成）；
   *   用 updated_at 窗口精准补拉（实测近 3 天仅 20 条，1 页完成）
   * - 全量对账：首次 / 距上次对账超过 BILL_FULL_RECONCILE_SEC / 手动刷新强制时执行，按 created_at 拉近一年
   *   （超过一年的历史不获取；produce_bill/list 支持 created_at_start 服务端过滤，实测一年窗口=全量）
   *   并清理远程已删除记录、刷新已完成/已取消历史；清理仅限"近一年内创建"的失效单据，超一年本地历史保留
   */
  private async syncBills(forceFull = false, reportWindowDays = 0): Promise<SyncStat> {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const fullDue = forceFull || this.fullDue('bill_full_sync_at', now, BILL_FULL_RECONCILE_SEC);

    if (fullDue) {
      // 全量只拉近一年（created_at 窗口）：超过一年的历史不再获取
      const { all, total } = await this.fetchBills(undefined, minusDays(now, FULL_SYNC_WINDOW_DAYS));
      await this.upsertBills(all);
      // 全量未截断时才清理本地已删除记录，避免误删；
      // 窗口只拉近一年，清理仅限"近一年内创建"的单据，超过一年或创建时间未知的本地记录保留不误删
      let cleaned = 0;
      if (total < 10_000 && all.length) {
        const ids = all.map((b: any) => b.id).filter((id: any) => id != null);
        const cutoff = minusDays(now, FULL_SYNC_WINDOW_DAYS);
        const del = await this.bills
          .createQueryBuilder()
          .delete()
          .where('billId NOT IN (:...ids)', { ids })
          .andWhere('createdAt >= :cutoff', { cutoff })
          .execute();
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`加工单缓存清理完成：删除本地已失效 ${cleaned} 条（仅限近一年创建）`);
      }
      await this.syncMeta.upsert({ key: 'bill_full_sync_at', value: now }, ['key']);
      this.logger.log(`加工单同步完成(全量对账)：拉取 ${all.length} 条，清理 ${cleaned} 条，耗时 ${Date.now() - start}ms`);
      return { pulled: all.length, cleaned };
    }

    let pulled = 0;
    for (const st of BILL_ACTIVE_STATUSES) {
      const { all } = await this.fetchBills(st);
      await this.upsertBills(all);
      pulled += all.length;
    }
    // 补拉近 N 天 updated_at 的已完成加工单（与任务模块同款）：整单完成不在活动状态增量范围，
    // 不补拉则本地缓存停留在旧"进行中"状态，完工预测/工序进度误判未完成；每日全量对账兜底
    const doneDays = reportWindowDays > 0 ? reportWindowDays : 3;
    const { all: doneBills } = await this.fetchBills(3, undefined, minusDays(now, doneDays));
    let donePulled = 0;
    if (doneBills.length) {
      await this.upsertBills(doneBills);
      donePulled = doneBills.length;
      pulled += donePulled;
    }
    this.logger.log(`加工单同步完成(活动+近${doneDays}天已完成)：拉取 ${pulled} 条，耗时 ${Date.now() - start}ms`);
    return { pulled, cleaned: 0 };
  }

  /** 分页拉取加工单（status 为空即全量；createdAfter 按 created_at 窗口、updatedAfter 按 updated_at 窗口） */
  private async fetchBills(status?: number, createdAfter?: string, updatedAfter?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (status !== undefined) params.status = status;
    if (createdAfter) {
      params.created_at_start = createdAfter;
      params.created_at_end = fmtDateTime(new Date());
    }
    if (updatedAfter) {
      params.updated_at_start = updatedAfter;
      params.updated_at_end = fmtDateTime(new Date());
    }
    return this.fetchPaged((pageNo) => this.kgdClient.listProduceBills({ pageNo, pageSize: PAGE_SIZE, ...params }));
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
      createdAt: b.created_at ?? null,
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
  private async syncTasks(forceFull = false, reportWindowDays = 0): Promise<SyncStat> {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const fullDue = forceFull || this.fullDue('task_full_sync_at', now, TASK_FULL_RECONCILE_SEC);

    if (fullDue) {
      // 全量只拉近一年（updated_at 窗口）：超过一年的历史不再获取。
      // OpenAPI 任务拉取与公版 order_number 校准互不依赖，并行执行（全量轮从 ~19s 降到 ~12s）；
      // 公版校准失败不影响任务同步（warn 后返回空 Map 继续）
      const tasksP = this.fetchTasks(undefined, minusDays(now, FULL_SYNC_WINDOW_DAYS));
      const ordersP = this.kgdClient
        .fetchWebCraftOrders(minusDays(now, FULL_SYNC_WINDOW_DAYS))
        .catch((e) => {
          this.logger.warn(`工艺顺序校准失败：${(e as Error).message}`);
          return new Map<number, number>();
        });
      const [{ all, total }, orders] = await Promise.all([tasksP, ordersP]);
      await this.upsertTasks(all);
      if (orders.size) {
        await this.applyCraftSeq(orders);
        this.logger.log(`工艺顺序校准完成：更新 ${orders.size} 条（来源：公版 order_number）`);
      }
      // 全量未截断时才清理本地已删除记录，避免误删；
      // 窗口只拉近一年，清理仅限"活动或近一年内完成"的任务，超过一年的本地历史保留不误删
      let cleaned = 0;
      if (total < 10_000 && all.length) {
        const ids = all.map((t: any) => t.id).filter((id: any) => id != null);
        const cutoff = minusDays(now, FULL_SYNC_WINDOW_DAYS);
        const del = await this.tasks
          .createQueryBuilder()
          .delete()
          .where('taskId NOT IN (:...ids)', { ids })
          .andWhere(`(end_time IS NULL OR end_time = '' OR end_time >= :cutoff)`, { cutoff })
          .execute();
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`任务缓存清理完成：删除本地已失效 ${cleaned} 条（仅限活动/近一年完成）`);
      }
      await this.syncMeta.upsert({ key: 'task_full_sync_at', value: now }, ['key']);
      this.logger.log(`任务同步完成(全量对账)：拉取 ${all.length} 条，清理 ${cleaned} 条，耗时 ${Date.now() - start}ms`);
      return { pulled: all.length, cleaned };
    }

    let pulled = 0;
    for (const st of TASK_ACTIVE_STATUSES) {
      const { all } = await this.fetchTasks(st);
      await this.upsertTasks(all);
      pulled += all.length;
    }
    // 补拉近 N 天 updated_at 的已完成任务：快工单报满量自动完成（status=3），
    // 活动状态增量拉不到，若不补拉本地会一直停留旧状态（每日全量对账兜底）。
    // 用 updated_at 窗口精准补拉，1 页请求即可（实测近 3 天仅 37 条）
    const doneDays = reportWindowDays > 0 ? reportWindowDays : 3;
    const { all: doneTasks } = await this.fetchTasks(3, minusDays(now, doneDays));
    let donePulled = 0;
    if (doneTasks.length) {
      await this.upsertTasks(doneTasks);
      donePulled = doneTasks.length;
      pulled += donePulled;
    }
    // 增量：补齐新下订单的真实工艺顺序（仅校准本地 craft_seq 为空的活动任务，
    // 保证新单即使被拖过工序也能与公版一致；存量单由每日全量对账校准）。
    // 公版拉取同样限近 N 天窗口（与已完成补拉一致），避免每轮全量拉公版
    try {
      const pending = await this.tasks
        .createQueryBuilder()
        .select('t.taskId', 'taskId')
        .from(KgdTaskCache, 't')
        .where('t.craft_seq IS NULL')
        .andWhere('t.status IN (:...st)', { st: TASK_ACTIVE_STATUSES })
        .getRawMany<{ taskId: number }>();
      if (pending.length) {
        const orders = await this.kgdClient.fetchWebCraftOrders(minusDays(now, doneDays));
        const need = new Map<number, number>();
        for (const p of pending) {
          const seq = orders.get(Number(p.taskId));
          if (seq != null) need.set(Number(p.taskId), seq);
        }
        await this.applyCraftSeq(need);
        if (need.size) this.logger.log(`新单工艺顺序补齐：${need.size} 条（来源：公版 order_number）`);
      }
    } catch (e) {
      this.logger.warn(`新单工艺顺序补齐失败：${(e as Error).message}`);
    }
    this.logger.log(`任务同步完成(增量)：活动 ${pulled - donePulled} 条 + 近${doneDays}天已完成 ${donePulled} 条，耗时 ${Date.now() - start}ms`);
    return { pulled, cleaned: 0 };
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

  /** 分页拉取生产任务（status 为空即全量；updatedAtStart 非空时按 updated_at 时间窗口拉取） */
  private async fetchTasks(status?: number, updatedAtStart?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (status !== undefined) params.status = status;
    if (updatedAtStart) {
      params.updated_at_start = updatedAtStart;
      params.updated_at_end = fmtDateTime(new Date());
    }
    return this.fetchPaged((pageNo) => this.kgdClient.listTasks({ pageNo, pageSize: PAGE_SIZE, ...params }));
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
  private async syncGoods(forceFull = false): Promise<SyncStat> {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastSync = this.metaCache.get('goods_last_sync') ?? null;
    const fullDue = forceFull || !lastSync || this.fullDue('goods_full_sync_at', now, GOODS_FULL_RECONCILE_SEC);

    if (fullDue) {
      // 全量只拉近一年（updated_at 窗口）：超过一年的历史不再获取
      const { all, total } = await this.fetchGoods(minusDays(now, FULL_SYNC_WINDOW_DAYS));
      await this.upsertGoods(all);
      // 全量未截断时才清理本地已删除记录，避免误删；
      // 窗口只拉近一年（updated_at），清理仅限"近一年内更新过"的商品，超过一年未更新的本地记录保留不误删
      let cleaned = 0;
      if (total < 10_000 && all.length) {
        const ids = all.map((g: any) => g.id).filter((id: any) => id != null);
        const cutoff = minusDays(now, FULL_SYNC_WINDOW_DAYS);
        const del = await this.goods
          .createQueryBuilder()
          .delete()
          .where('goodsId NOT IN (:...ids)', { ids })
          .andWhere('updatedAt >= :cutoff', { cutoff })
          .execute();
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`商品缓存清理完成：删除本地已失效 ${cleaned} 条（仅限近一年更新）`);
      }
      await this.syncMeta.upsert({ key: 'goods_full_sync_at', value: now }, ['key']);
      await this.syncMeta.upsert({ key: 'goods_last_sync', value: now }, ['key']);
      this.logger.log(`商品同步完成(全量对账)：拉取 ${all.length} 条，清理 ${cleaned} 条，耗时 ${Date.now() - start}ms`);
      return { pulled: all.length, cleaned };
    }

    const { all } = await this.fetchGoods(minusSeconds(lastSync!, REPORT_OVERLAP_SEC));
    await this.upsertGoods(all);
    await this.syncMeta.upsert({ key: 'goods_last_sync', value: now }, ['key']);
    this.logger.log(`商品同步完成(增量)：拉取 ${all.length} 条，耗时 ${Date.now() - start}ms`);
    return { pulled: all.length, cleaned: 0 };
  }

  /** 分页拉取商品（updatedAtStart 非空时按 updated_at 时间窗口拉取） */
  private async fetchGoods(updatedAtStart?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (updatedAtStart) {
      params.updated_at_start = updatedAtStart;
      params.updated_at_end = fmtDateTime(new Date());
    }
    return this.fetchPaged((pageNo) => this.kgdClient.listGoods({ pageNo, pageSize: PAGE_SIZE, ...params }));
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

  /**
   * 商品库存滚动同步：数据源为公版 Web /api/goods_stock/list（OpenAPI 无库存接口）。
   * - 全量对账：首次 / 距上次对账超过 GOODS_STOCK_FULL_RECONCILE_SEC / forceFull 时执行，
   *   全量拉取（约 1.3k 行，14 页）后覆盖写入，并清理远程已删除的库存行（总量 1.3k 无截断风险）
   * - 增量：以 goods_stock_last_sync 为游标按 updated_at 窗口拉取（公版 updated_at 过滤可能退化为全量，
   *   覆盖写入无害；删除清理只发生在全量对账分支）
   */
  private async syncGoodsStock(forceFull = false): Promise<SyncStat> {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastSync = this.metaCache.get('goods_stock_last_sync') ?? null;
    const fullDue = forceFull || !lastSync || this.fullDue('goods_stock_full_sync_at', now, GOODS_STOCK_FULL_RECONCILE_SEC);

    // 低频刷新：非全量场景距上次同步不足 GOODS_STOCK_MIN_SYNC_SEC 直接跳过（库存实时性要求不高，避免高频查询重复打公版）
    if (!fullDue && lastSync) {
      const lastMs = new Date(lastSync.replace(' ', 'T')).getTime();
      if (Number.isFinite(lastMs) && Date.now() - lastMs < GOODS_STOCK_MIN_SYNC_SEC * 1000) {
        return { pulled: 0, cleaned: 0 };
      }
    }

    if (fullDue) {
      const { all, total } = await this.fetchGoodsStock();
      await this.upsertGoodsStock(all);
      let cleaned = 0;
      if (total < 10_000 && all.length) {
        const ids = all.map((s: any) => s.id).filter((id: any) => id != null);
        const del = await this.goodsStock
          .createQueryBuilder()
          .delete()
          .where('stockId NOT IN (:...ids)', { ids })
          .execute();
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`库存缓存清理完成：删除本地已失效 ${cleaned} 条`);
      }
      await this.syncMeta.upsert({ key: 'goods_stock_full_sync_at', value: now }, ['key']);
      await this.syncMeta.upsert({ key: 'goods_stock_last_sync', value: now }, ['key']);
      this.logger.log(`库存同步完成(全量对账)：拉取 ${all.length} 条，清理 ${cleaned} 条，耗时 ${Date.now() - start}ms`);
      return { pulled: all.length, cleaned };
    }

    const { all } = await this.fetchGoodsStock(minusSeconds(lastSync!, REPORT_OVERLAP_SEC));
    await this.upsertGoodsStock(all);
    await this.syncMeta.upsert({ key: 'goods_stock_last_sync', value: now }, ['key']);
    this.logger.log(`库存同步完成(增量)：拉取 ${all.length} 条，耗时 ${Date.now() - start}ms`);
    return { pulled: all.length, cleaned: 0 };
  }

  /** 分页拉取商品库存（公版 /api/goods_stock/list；updatedAtStart 非空时按 updated_at 窗口拉取） */
  private async fetchGoodsStock(updatedAtStart?: string): Promise<{ all: any[]; total: number }> {
    const params: Record<string, unknown> = {};
    if (updatedAtStart) {
      params.updated_at_start = updatedAtStart;
      params.updated_at_end = fmtDateTime(new Date());
    }
    return this.fetchPaged(
      (pageNo) => this.kgdClient.listWebGoodsStock({ pageNo, pageSize: GOODS_STOCK_PAGE_SIZE, ...params }),
      GOODS_STOCK_PAGE_SIZE,
    );
  }

  /** 写入库存缓存（一条 = 商品×仓库；raw 保留快工单原始字段供本地过滤） */
  private async upsertGoodsStock(all: any[]) {
    if (!all.length) return;
    const rows = all.map((s: any) => ({
      stockId: s.id,
      wareId: s.ware?.id ?? 0,
      wareName: s.ware?.name ?? '',
      goodsId: s.goods?.id ?? 0,
      goodsCode: s.goods?.code ?? '',
      goodsName: s.goods?.name ?? '',
      goodsStandard: s.goods?.standard ?? '',
      unitName: s.goods?.unit?.name ?? '',
      source: Number(s.goods?.source ?? 0),
      sourceName: s.goods?.source_name ?? '',
      categoryPathNames: s.goods?.category_path_names ?? '',
      num: String(s.num ?? '0'),
      wasteNum: String(s.waste_num ?? '0'),
      stockTotalNum: String(s.stock_total_num ?? '0'),
      stockTotalWasteNum: String(s.stock_total_waste_num ?? '0'),
      stockTotalAvailableNum: String(s.stock_total_available_num ?? '0'),
      lockStockNum: String(s.lock_stock_num ?? '0'),
      purchaseInTransitNum: String(s.purchase_in_transit_num ?? '0'),
      lowLimit: s.low_limit != null ? String(s.low_limit) : null,
      upperLimit: s.upper_limit != null ? String(s.upper_limit) : null,
      updatedAt: s.updated_at ?? null,
      fieldValueList: s.fieldValueList ?? [],
      raw: s,
    }));
    await this.goodsStock.upsert(rows, ['stockId']);
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
   *   （超过一年的历史不获取）；远程记录全部落在窗口内（实测超一年 0 条），未截断时清理本地已删除残留
   * - 本地已有（reportId 匹配）→ 更新业务字段；不写入 reportTime，避免覆盖本地报工时间
   * - 本地 reportId 为空的行按 加工单+工序+用户+数量 匹配补全 ID 再更新
   */
  private async syncReportRecords(forceFull = false, reportWindowDays = 0): Promise<SyncStat> {
    const start = Date.now();
    const now = fmtDateTime(new Date());
    const lastSync = this.metaCache.get('report_last_sync') ?? null;
    const fullDue = forceFull || !lastSync || this.fullDue('report_full_sync_at', now, REPORT_FULL_RECONCILE_SEC);

    if (fullDue) {
      const stat = await this.fullSyncReportRecords(now);
      this.logger.log(`报工记录同步完成(全量对账)：拉取 ${stat.pulled} 条，清理 ${stat.cleaned} 条，耗时 ${Date.now() - start}ms`);
      return stat;
    }
    if (reportWindowDays > 0) {
      const from = minusDays(now, reportWindowDays);
      const stat = await this.incrementalSyncReportRecords(now, from, true);
      this.logger.log(`报工记录同步完成(近${reportWindowDays}天)：拉取 ${stat.pulled} 条，清理 ${stat.cleaned} 条，耗时 ${Date.now() - start}ms`);
      if (stat.pulled > 0) await this.syncWebReportTimesSafe(minusSeconds(from, REPORT_OVERLAP_SEC));
      return stat;
    }
    const stat = await this.incrementalSyncReportRecords(now, lastSync!);
    this.logger.log(`报工记录同步完成(增量)：拉取 ${stat.pulled} 条，耗时 ${Date.now() - start}ms`);
    // 增量拉到新记录后，立即从公版回填新记录的报工时间（只拉与增量一致的近期窗口，轻量）
    if (stat.pulled > 0) await this.syncWebReportTimesSafe(minusSeconds(lastSync!, REPORT_OVERLAP_SEC));
    return stat;
  }

  /** 增量同步后回填公版报工时间：只拉与增量窗口一致的近期数据，失败不影响本次同步。
   *  公版 Web 端上报带完整 report_time，OpenAPI 同步记录无时间戳，在此按 report_id 补齐 */
  private async syncWebReportTimesSafe(from: string): Promise<void> {
    try {
      await this.syncWebReportTimes(from);
    } catch (e) {
      this.logger.warn(`公版报工时间回填失败（不影响本次同步）: ${(e as Error).message}`);
    }
  }

  /**
   * 全量拉取（仅近一年 report_time 窗口）+ upsert + 推进游标。
   * 删除清理：实测远程报工记录【全部落在近一年窗口内】（超一年 0 条），且本地记录均带 report_id，
   * 因此「本地 report_id 非空但不在本次窗口集合」的记录必为远程已删除（残留），可以安全清理；
   * 仅在远程未截断（total < 10000，窗口拉到的即远程全部）时执行清理，防止未来数据量超限截断误删；
   * 本地 report_id 为空的记录（报工后尚未同步回 ID）一律保留。
   */
  private async fullSyncReportRecords(now: string): Promise<SyncStat> {
    const from = minusDays(now, FULL_SYNC_WINDOW_DAYS);
    const { all, total } = await this.fetchReportRecords({ report_time_start: from });
    await this.backfillNullReportIds(all);
    await this.upsertReportRows(all);
    // 全量未截断时才清理远程已删除的本地残留，避免误删；
    // 窗口只拉近一年，实测远程全部记录都在窗口内（超一年 0 条），不在集合 = 远程已删除
    let cleaned = 0;
    if (total < 10_000 && all.length) {
      const ids = all.map((r: any) => r.id).filter((id: any) => id != null);
      if (ids.length) {
        const del = await this.reportCache
          .createQueryBuilder()
          .delete()
          .where('reportId IS NOT NULL')
          .andWhere('reportId NOT IN (:...ids)', { ids })
          .execute();
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`报工全量对账清理完成：删除本地已失效 ${cleaned} 条（远程已删除）`);
      }
    }
    // 公版系统回填报工时间（OpenAPI 记录无时间戳，纯同步记录在此补齐）；失败不影响本次对账
    try {
      await this.syncWebReportTimes();
    } catch (e) {
      this.logger.warn(`公版报工时间回填失败（不影响本次对账）: ${(e as Error).message}`);
    }
    // 同步成功后才推进游标（失败保持原游标，下次继续对账）
    await this.syncMeta.upsert({ key: 'report_last_sync', value: now }, ['key']);
    await this.syncMeta.upsert({ key: 'report_full_sync_at', value: now }, ['key']);
    return { pulled: all.length, cleaned };
  }

  /**
   * 从公版 Web 系统回填报工时间：OpenAPI 报工接口返回的记录不含时间戳字段，
   * 本地缓存中纯同步记录（report_time 为空）在此按 report_id 精确匹配，回填公版 report_time。
   * 只回填空值，不覆盖本地报工时间。可手动触发（POST /tasks/sync-web-report-times）。
   * @param from 拉取窗口起点；不传则与全量对账一致（近一年）
   */
  async syncWebReportTimes(from?: string): Promise<{ updated: number; total: number }> {
    const start = Date.now();
    // 没有待回填的报工时间则直接跳过（本地报工都带本地时间；避免每次全量多花约 20s 拉公版）
    const emptyCount = await this.reportCache.count({
      where: [{ reportTime: '' }, { reportTime: IsNull() }],
    });
    if (emptyCount === 0) {
      this.logger.log('公版报工时间回填跳过：无空 report_time 记录');
      return { updated: 0, total: 0 };
    }
    const now = fmtDateTime(new Date());
    const fromDate = from ?? minusDays(now, FULL_SYNC_WINDOW_DAYS);
    const rows: any[] = [];
    let page = 1;
    for (;;) {
      const { data, count } = await this.kgdClient.listWebReportRecords({ pageNo: page, report_time_start: fromDate });
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < WEB_PAGE_SIZE || page * WEB_PAGE_SIZE >= (count ?? rows.length)) break;
      page++;
    }
    // (id -> report_time)，列表按时间倒序先到即最新，同 id 保留首个；值校验后拼接 SQL
    const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const map = new Map<number, string>();
    for (const r of rows) {
      if (r.id != null && typeof r.report_time === 'string' && TIME_RE.test(r.report_time)) {
        const id = Number(r.id);
        if (!map.has(id)) map.set(id, r.report_time);
      }
    }
    let updated = 0;
    const CHUNK = 500;
    const ids = [...map.keys()];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunkIds = ids.slice(i, i + CHUNK);
      // 只回填本地 report_time 为空的记录
      const need = await this.reportCache
        .createQueryBuilder()
        .select('id', 'rowId')
        .addSelect('report_id', 'reportId')
        .where('report_id IN (:...ids)', { ids: chunkIds })
        .andWhere(`(report_time = '' OR report_time IS NULL)`)
        .getRawMany<{ rowId: number; reportId: string }>();
      if (!need.length) continue;
      const caseSql = need.map((n) => `WHEN ${Number(n.reportId)} THEN '${map.get(Number(n.reportId))}'`).join(' ');
      const res = await this.reportCache
        .createQueryBuilder()
        .update()
        .set({ reportTime: () => `CASE report_id ${caseSql} END` })
        .where('id IN (:...rowIds)', { rowIds: need.map((n) => Number(n.rowId)) })
        .execute();
      updated += res.affected ?? 0;
    }
    this.logger.log(`公版报工时间回填完成：拉取 ${rows.length} 条，回填 ${updated} 条，耗时 ${Date.now() - start}ms`);
    return { updated, total: rows.length };
  }

  /** 按 [from, now] 窗口拉取 + upsert + 推进游标（from 为游标或近 N 天起点）
   *  cleanupWindow=true（手动短按近 N 天刷新）时额外做删除对账。
   *  ⚠️ 快工单报工列表接口返回的记录【不含时间戳字段】：
   *  - 纯同步记录（本地 report_time 为空）无法判断归属窗口，窗口路径绝不清理它们，
   *    否则会把窗口外的历史同步记录全部误删（历史 Bug：一次短按刷新删掉 3555 条）。
   *  - 远程已删除的同步记录统一由全量对账（每日 / 长按刷新）兜底清理。
   *  - 窗口路径只清理「本地报工时间落在本次拉取窗口内、却未被窗口拉到」的记录，
   *    此时该记录必定已在远程被删除（若远程仍在，窗口拉取必然返回它）。 */
  private async incrementalSyncReportRecords(now: string, from: string, cleanupWindow = false): Promise<SyncStat> {
    const fetchFrom = minusSeconds(from, REPORT_OVERLAP_SEC);
    const { all, total } = await this.fetchReportRecords({
      report_time_start: fetchFrom,
      report_time_end: now,
    });
    await this.backfillNullReportIds(all);
    await this.upsertReportRows(all);
    let cleaned = 0;
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
        cleaned = del.affected ?? 0;
        if (cleaned) this.logger.log(`报工窗口对账完成：删除本地已失效 ${cleaned} 条`);
      }
    }
    await this.syncMeta.upsert({ key: 'report_last_sync', value: now }, ['key']);
    return { pulled: all.length, cleaned };
  }

  /** 分页拉取报工记录（params 为空即全量） */
  private async fetchReportRecords(params: Record<string, unknown>) {
    return this.fetchPaged((pageNo) => this.kgdClient.listReportRecords({ pageNo, pageSize: PAGE_SIZE, ...params }));
  }

  /**
   * 通用分页拉取：先取第 1 页拿 total，再并发拉取剩余页（4 个模块共用，避免重复实现）。
   * fetcher 需返回 { data, count }（count 缺省时按 data 长度估算），total 上限 10000 防越界
   */
  private async fetchPaged(
    fetcher: (pageNo: number) => Promise<{ data: any[]; count?: number }>,
    pageSize = PAGE_SIZE,
  ): Promise<{ all: any[]; total: number }> {
    const first = await fetcher(1);
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 10_000);
    const all = [...firstList];
    const pageCount = Math.ceil(total / pageSize);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await fetcher(pageNo);
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
      // 不良品项明细（快工单 report_waste_list：[{waste_item:{code,name},num}]）
      wasteList: Array.isArray(r.report_waste_list) && r.report_waste_list.length
        ? JSON.stringify(r.report_waste_list.map((w: any) => ({
            code: String(w.waste_item?.code ?? ''),
            name: String(w.waste_item?.name ?? ''),
            num: Number(w.num) || 0,
          })))
        : null,
      syncedAt: new Date(),
    }));
    await this.reportCache.upsert(rows, ['reportId']);
  }
}
