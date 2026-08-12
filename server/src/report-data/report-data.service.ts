import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdSyncService } from '../kgd/kgd-sync.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';

const PAGE_SIZE = 100;
const CONCURRENCY = 6; // 分页并发数（与同步服务实测一致）

/** 从接口自定义字段中取值（如 HT图号） */
function extractFieldValue(fieldList: { name: string; value?: string }[] | undefined, name: string): string | null {
  const f = (fieldList ?? []).find((x) => x.name === name);
  return f?.value ?? null;
}

/** 加工单交付日期规整为 YYYY-MM-DD（远程可能返回完整 datetime） */
function dateOnly(v: unknown): string | null {
  return v ? String(v).slice(0, 10) : null;
}

/**
 * 日报数据源：面向 AstrBot 机器人插件等外部系统的只读接口实现。
 *
 * 设计说明：插件原本直连快工单 OpenAPI 的取数逻辑（core/api.py）改为请求本服务。
 * - 报工记录：OpenAPI 返回不含时间戳，只能按 created_at 窗口实时拉取，无法走本地缓存
 * - 生产任务 / 用户：同理实时拉取，保证数据最新
 * - 加工单交期：读取本地缓存（kgd_bill_cache 已含 delivery_date，每 5 分钟同步），
 *   查询前先触发一次即时同步，保证交期尽量新鲜
 */
@Injectable()
export class ReportDataService {
  private readonly logger = new Logger(ReportDataService.name);

  constructor(
    private readonly kgdClient: KgdClientService,
    private readonly sync: KgdSyncService,
    @InjectRepository(KgdBillCache) private readonly bills: Repository<KgdBillCache>,
  ) {}

  /** 分页并发拉取指定接口全量数据 */
  private async fetchAll(
    kind: 'reports' | 'tasks' | 'users',
    params: Record<string, unknown>,
  ): Promise<any[]> {
    const page = (pageNo: number, pageSize: number) => {
      switch (kind) {
        case 'reports':
          return this.kgdClient.listReportRecords({ pageNo, pageSize, ...params });
        case 'tasks':
          return this.kgdClient.listTasks({ pageNo, pageSize, ...params });
        case 'users':
          return this.kgdClient.listUsers({ pageNo, pageSize, ...params });
      }
    };
    const first = await page(1, PAGE_SIZE);
    const all: any[] = [...(first.data ?? [])];
    const total = Math.min(first.count ?? all.length, 10_000);
    const pageCount = Math.ceil(total / PAGE_SIZE);
    let next = 2;
    const worker = async () => {
      while (next <= pageCount) {
        const pageNo = next++;
        const { data } = await page(pageNo, PAGE_SIZE);
        if (data?.length) all.push(...data);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return all;
  }

  // ===== 报工记录 =====

  /** 指定日期报工明细（按 created_at 归属日期，等价插件 fetch_day_reports） */
  async getDayReports(day: string) {
    const records = await this.fetchAll('reports', {
      created_at_start: `${day} 00:00:00`,
      created_at_end: `${day} 23:59:59`,
    });
    return records.map((r: any) => {
      const pb = r.produce_bill ?? {};
      const goods = pb.goods ?? {};
      return {
        billCode: pb.code ?? '',
        craftName: r.pub_craft?.name ?? '',
        goodsName: goods.name ?? '',
        goodsStandard: goods.standard ?? '',
        deliveryDate: dateOnly(pb.delivery_date),
        htNo: extractFieldValue(r.fieldValueList, 'HT图号'),
        reportUserName: r.report_user?.real_name ?? '',
        validNum: r.valid_num ?? '0',
        wasteNum: r.waste_num ?? '0',
        reportNum: r.report_num ?? '0',
        workingMinutes: r.working_minutes ?? 0,
        priceModeName: r.price_mode_name ?? '',
      };
    });
  }

  // ===== 生产任务 =====

  /** 按状态查任务列表（status 为快工单任务状态码：1=未开始 2=进行中） */
  async getTasks(status: number) {
    const tasks = await this.fetchAll('tasks', { status });
    return tasks.map((t: any) => {
      const pb = t.produce_bill ?? {};
      const goods = pb.goods ?? {};
      return {
        code: pb.code ?? '',
        ht: extractFieldValue(t.fieldValueList, 'HT图号') ?? '',
        craft: t.pub_craft?.name ?? '',
        goods: goods.name ?? '',
        standard: goods.standard ?? '',
        num: t.num ?? '0',
        validNum: t.valid_num ?? '0',
        wasteNum: t.waste_num ?? '0',
        statusName: t.status_name ?? '',
        startTime: t.start_time ?? t.created_at ?? null,
        deliveryDate: dateOnly(pb.delivery_date),
        produceLineNames: t.produce_line_names ?? '',
        reportableUserNames: t.reportable_user_names ?? '',
      };
    });
  }

  /** 按加工单号+工序精确查询并合并任务详情（等价插件 fetch_task 的合并结构） */
  async getTask(code: string, craft: string) {
    const tasks = await this.fetchAll('tasks', { produce_bill_code: code, craft_name: craft });
    if (!tasks.length) return null;
    // 多任务并存时取优先级最高的状态（进行中 > 已完成 > 其他）
    const STATUS_PRIORITY: Record<string, number> = { 进行中: 2, 已完成: 1 };
    const toInt = (v: unknown) => Number(v ?? 0) || 0;
    const merged = {
      num: tasks.reduce((s, t) => s + toInt(t.num), 0),
      valid_num: tasks.reduce((s, t) => s + toInt(t.valid_num), 0),
      waste_num: tasks.reduce((s, t) => s + toInt(t.waste_num), 0),
      status_name:
        tasks
          .map((t: any) => t.status_name ?? '')
          .sort((a, b) => (STATUS_PRIORITY[b] ?? 0) - (STATUS_PRIORITY[a] ?? 0))[0] ?? '',
      ht: [...new Set(tasks.map((t: any) => extractFieldValue(t.fieldValueList, 'HT图号')).filter(Boolean))].join('、'),
      produce_line_names: [...new Set(tasks.map((t: any) => t.produce_line_names).filter(Boolean))].join('、'),
      reportable_user_names: [...new Set(tasks.map((t: any) => t.reportable_user_names).filter(Boolean))].join('、'),
      delivery_date:
        dateOnly(tasks.find((t: any) => t.produce_bill?.delivery_date)?.produce_bill?.delivery_date) ?? '',
    };
    return merged;
  }

  // ===== 用户 =====

  /** 用户列表（含部门路径，供插件建立南/北线索引） */
  async getUsers() {
    const users = await this.fetchAll('users', {});
    return users.map((u: any) => ({
      name: u.name ?? '',
      realName: u.real_name ?? '',
      departmentPathNames: u.department_path_names ?? '',
    }));
  }

  // ===== 加工单交期 =====

  /** 加工单交期映射 {code: YYYY-MM-DD}：读本地缓存，查询前先触发一次即时同步 */
  async getDeliveryDates(codes: string[]) {
    const list = codes.filter(Boolean);
    if (!list.length) return {};
    try {
      await this.sync.requestSync();
    } catch (e) {
      // 同步失败不阻断查询，继续用缓存数据
      this.logger.warn(`查询交期前同步失败，使用现有缓存: ${(e as Error).message}`);
    }
    const rows = await this.bills.find({
      where: { code: In(list) },
      select: { code: true, deliveryDate: true },
    });
    const map: Record<string, string> = {};
    for (const b of rows) {
      if (b.deliveryDate) map[b.code] = String(b.deliveryDate).slice(0, 10);
    }
    return map;
  }
}
