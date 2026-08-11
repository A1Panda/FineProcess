import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { KgdClientService } from './kgd-client.service';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';

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
    @InjectRepository(KgdBillCache) private readonly bills: Repository<KgdBillCache>,
    @InjectRepository(KgdTaskCache) private readonly tasks: Repository<KgdTaskCache>,
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
      await Promise.all([this.syncBills(), this.syncTasks()]);
      this.logger.log(`数据同步完成，耗时 ${Date.now() - start}ms`);
    } catch (e) {
      this.logger.warn(`数据同步失败: ${(e as Error).message}`);
    }
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
}
