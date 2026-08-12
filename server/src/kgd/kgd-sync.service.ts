import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { KgdClientService } from './kgd-client.service';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';
import { KgdReportCache } from '../report/kgd-report-cache.entity';
import { User } from '../auth/users.entity';

const PAGE_SIZE = 100;
const CONCURRENCY = 6; // 分页并发数：实测串行 41 页 28s，并发 6 约 5s，并发 8 约 4s
const SYNC_INTERVAL = 5 * 60 * 1000; // 每 5 分钟滚动同步一次

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
    @InjectRepository(KgdReportCache) private readonly reportCache: Repository<KgdReportCache>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  onModuleInit() {
    // 延迟到凭证就绪后再同步
    setTimeout(() => this.syncNow(), 8_000);
  }

  @Interval(SYNC_INTERVAL)
  syncNow(): Promise<void> {
    if (this.currentSync) return this.currentSync;
    this.currentSync = this.doSync().finally(() => {
      this.currentSync = null;
    });
    return this.currentSync;
  }

  private async doSync() {
    const start = Date.now();
    try {
      await Promise.all([
        this.syncBills(),
        this.syncTasks(),
        this.syncReportRecords(),
        this.syncUsers(),
      ]);
      this.logger.log(`数据同步完成，耗时 ${Date.now() - start}ms`);
    } catch (e) {
      this.logger.warn(`数据同步失败: ${(e as Error).message}`);
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

  /** 加工单滚动同步（同步完成后清理远程已删除的记录） */
  private async syncBills() {
    const start = Date.now();
    const fetchedIds: number[] = [];
    const first = await this.kgdClient.listProduceBills({ pageNo: 1, pageSize: PAGE_SIZE });
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 5000);
    let done = 0;

    const upsertPage = async (list: any[]) => {
      if (!list.length) return;
      const rows = list.map((b: any) => {
        fetchedIds.push(b.id);
        return {
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
        };
      });
      await this.bills.upsert(rows, ['billId']);
      done += list.length;
    };

    await upsertPage(firstList);
    // 并发拉取剩余页（实测并发能大幅缩短总耗时，接口可承受）
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listProduceBills({ pageNo, pageSize: PAGE_SIZE });
        await upsertPage(data ?? []);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // 全量拉取成功时，清理本地存在但远程已删除的记录
    if (done >= total && fetchedIds.length) {
      await this.bills
        .createQueryBuilder()
        .delete()
        .where('billId NOT IN (:...ids)', { ids: fetchedIds })
        .execute();
      this.logger.log(`加工单缓存清理完成：本地 ${fetchedIds.length} 条为准`);
    }
    this.logger.log(`加工单同步完成：${done} 条，耗时 ${Date.now() - start}ms`);
  }

  /** 生产任务滚动同步（同步完成后清理远程已删除的记录） */
  private async syncTasks() {
    const start = Date.now();
    const fetchedIds: number[] = [];
    const first = await this.kgdClient.listTasks({ pageNo: 1, pageSize: PAGE_SIZE });
    const firstList = first.data ?? [];
    const total = Math.min(first.count ?? firstList.length, 5000);
    let done = 0;

    const upsertPage = async (list: any[]) => {
      if (!list.length) return;
      const rows = list.map((t: any) => {
        fetchedIds.push(t.id);
        return {
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
        };
      });
      await this.tasks.upsert(rows, ['taskId']);
      done += list.length;
    };

    await upsertPage(firstList);
    // 并发拉取剩余页
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listTasks({ pageNo, pageSize: PAGE_SIZE });
        await upsertPage(data ?? []);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // 全量拉取成功时，清理本地存在但远程已删除的记录
    if (done >= total && fetchedIds.length) {
      await this.tasks
        .createQueryBuilder()
        .delete()
        .where('taskId NOT IN (:...ids)', { ids: fetchedIds })
        .execute();
      this.logger.log(`任务缓存清理完成：本地 ${fetchedIds.length} 条为准`);
    }
    this.logger.log(`任务同步完成：${done} 条，耗时 ${Date.now() - start}ms`);
  }

  /** 触发一次即时同步（写操作后 / 手动刷新时调用，可等待完成） */
  requestSync(): Promise<void> {
    return this.syncNow();
  }

  /**
   * 报工记录滚动同步：分页拉取快工单全部报工记录缓存到本地
   * - 本地已有（reportId 匹配）→ 更新业务字段；不写入 reportTime，避免覆盖本地报工时间
   * - 本地 reportId 为空的行先按 加工单+工序+用户+数量 匹配补全 ID 再更新
   * - 不做远程删除清理：报工记录删除罕见，且本地报工时间需保留
   */
  private async syncReportRecords() {
    const start = Date.now();
    const first = await this.kgdClient.listReportRecords({ pageNo: 1, pageSize: PAGE_SIZE });
    const all: any[] = [...(first.data ?? [])];
    const total = Math.min(first.count ?? all.length, 10_000);

    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await this.kgdClient.listReportRecords({ pageNo, pageSize: PAGE_SIZE });
        if (data?.length) all.push(...data);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // 补全本地 reportId 为空的记录（报工后即时写入、反查失败的兜底）
    const nullRows = await this.reportCache.find({ where: { reportId: IsNull() } });
    if (nullRows.length) {
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
    }));
    // rows 不含 reportTime：插入用列默认值，更新保留本地已记录的时间
    await this.reportCache.upsert(rows, ['reportId']);
    this.logger.log(`报工记录同步完成：${rows.length} 条，耗时 ${Date.now() - start}ms`);
  }
}
