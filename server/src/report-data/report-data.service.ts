import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdSyncService } from '../kgd/kgd-sync.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';

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
    @InjectRepository(KgdTaskCache) private readonly tasks: Repository<KgdTaskCache>,
  ) {}

  /** 分页并发拉取指定接口全量数据 */
  private async fetchAll(
    kind: 'reports' | 'tasks' | 'users' | 'goods',
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
        case 'goods':
          return this.kgdClient.listGoods({ pageNo, pageSize, ...params });
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

  // ===== 加工单状态 =====

  /**
   * 加工单列表 + 状态 + 工序进度链（读本地缓存，查询前先触发一次即时同步）。
   *
   * 返回每张加工单的基本信息与整单工序进度（同单任务按工艺顺序排列），
   * 供机器人插件渲染「加工单进行状态」页：
   * - 加工单 status=1（未开始）时插件展示「未编程」
   * - 已开始（status>=2）时逐工序展示完成百分比
   */
  async getBillStatus() {
    try {
      await this.sync.requestSync();
    } catch (e) {
      // 同步失败不阻断查询，继续用缓存数据
      this.logger.warn(`查询加工单状态前同步失败，使用现有缓存: ${(e as Error).message}`);
    }
    // 加工单按交期从早到晚排序，无交期排最后
    const bills = await this.bills
      .createQueryBuilder('b')
      .addSelect(
        `CASE WHEN b.deliveryDate IS NULL OR b.deliveryDate = '' THEN 1 ELSE 0 END`,
        'deliveryNull',
      )
      .orderBy('deliveryNull', 'ASC')
      .addOrderBy('b.deliveryDate', 'ASC')
      .addOrderBy('b.htNo', 'ASC')
      .addOrderBy('b.code', 'ASC')
      .getMany();

    const codes = bills.map((b) => b.code);
    const byBill = new Map<string, KgdTaskCache[]>();
    if (codes.length) {
      // 分批查询任务链（与 tasks.service 一致：每批 500）
      for (let i = 0; i < codes.length; i += 500) {
        const chunk = codes.slice(i, i + 500);
        const rows = await this.tasks
          .createQueryBuilder('t')
          .select([
            't.taskId',
            't.billCode',
            't.craftName',
            't.craftCode',
            't.craftSeq',
            't.status',
            't.statusName',
            't.num',
            't.validNum',
            't.wasteNum',
          ])
          .where('t.billCode IN (:...codes)', { codes: chunk })
          .getMany();
        for (const r of rows) {
          const arr = byBill.get(r.billCode) ?? [];
          arr.push(r);
          byBill.set(r.billCode, arr);
        }
      }
    }
    for (const arr of byBill.values())
      arr.sort((a, b) => {
        const sa = a.craftSeq != null ? Number(a.craftSeq) : Number(a.taskId);
        const sb = b.craftSeq != null ? Number(b.craftSeq) : Number(b.taskId);
        return sa - sb;
      });

    return bills.map((b) => {
      const chain = byBill.get(b.code) ?? [];
      return {
        code: b.code,
        htNo: b.htNo,
        goodsName: b.goodsName,
        goodsSpec: b.goodsSpec,
        num: b.num,
        unitName: b.unitName,
        /** 加工单状态：1=未开始 2=进行中 3=完成 4=取消 */
        status: Number(b.status),
        statusName: b.statusName,
        deliveryDate: b.deliveryDate ? String(b.deliveryDate).slice(0, 10) : null,
        /** 工序进度（同单按工艺顺序）：percent = (良品+不良) / 计划数 */
        craftProgress: chain.map((c) => {
          const num = Number(c.num) || 0;
          const done = Number(c.validNum) + Number(c.wasteNum);
          const percent = num > 0 ? Math.min(100, Math.round((done / num) * 100)) : 0;
          return {
            craftName: c.craftName,
            status: Number(c.status),
            statusName: c.statusName,
            percent,
            num,
            validNum: Number(c.validNum) || 0,
            wasteNum: Number(c.wasteNum) || 0,
          };
        }),
      };
    });
  }

  // ===== 加工单编辑 =====

  /** 编辑加工单（透传快工单 /open_api/produce_bill/edit，字段校验由快工单侧完成） */
  async editBill(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.editProduceBill(payload);
    return data;
  }

  // ===== 工序 =====

  /** 工序列表（透传 /open_api/pub_craft/list，支持分页/名称过滤） */
  async getCrafts(params: Record<string, unknown> = {}) {
    const { data } = await this.kgdClient.listCrafts(params);
    return data;
  }

  /** 工序新增（透传 /open_api/pub_craft/add，必填 name） */
  async addCraft(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.addCraft(payload);
    return data;
  }

  /** 工序编辑（透传 /open_api/pub_craft/edit，必填 id） */
  async editCraft(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.editCraft(payload);
    return data;
  }

  // ===== 商品（新增/编辑） =====

  /** 商品新增（透传 /open_api/goods/add，必填 name） */
  async addGoods(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.addGoods(payload);
    return data;
  }

  /** 商品编辑（透传 /open_api/goods/edit，必填 id+name） */
  async editGoods(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.editGoods(payload);
    return data;
  }

  // ===== 加工单（列表/新增/状态） =====

  /** 加工单列表（实时拉取 /open_api/produce_bill/list，支持 code/goods_keyword/keyword/status 等过滤） */
  async getProduceBills(params: Record<string, unknown> = {}) {
    const { data, count } = await this.kgdClient.listProduceBills(params);
    return { list: data, count };
  }

  /** 加工单新增（透传 /open_api/produce_bill/add，必填 goods_id+num） */
  async addProduceBill(payload: Record<string, unknown>) {
    const { data } = await this.kgdClient.addProduceBill(payload);
    return data;
  }

  /** 加工单状态修改：type 1=开始 2=撤回 3=完成 4=取消 */
  async changeProduceBillStatus(body: { id: number; type: 1 | 2 | 3 | 4; cancelReason?: string }) {
    const { data } = await this.kgdClient.editProduceBillStatus(body.id, body.type, body.cancelReason);
    return data;
  }

  // ===== 生产任务状态 =====

  /** 生产任务状态修改：status 1=未开始 2=进行中 3=已完成 4=暂停 */
  async changeTaskStatus(body: { id: number; status: 1 | 2 | 3 | 4 }) {
    const { data } = await this.kgdClient.editTaskStatus(body.id, body.status);
    return data;
  }

  // ===== 商品列表 =====

  /**
   * 商品列表（实时拉取快工单 /open_api/goods/list）。
   * 支持按名称/编号/规格（keyword）、更新时间窗口（updatedAtStart/End）、
   * 供应商、创建人、分类、来源、启用状态筛选。
   */
  async getGoods(
    keyword?: string,
    updatedAtStart?: string,
    updatedAtEnd?: string,
    supplierName?: string,
    createUserName?: string,
    categoryName?: string,
    source?: string,
    isEnable?: string,
  ) {
    const params: Record<string, unknown> = {};
    const set = (key: string, v?: string, numeric = false) => {
      const s = (v ?? '').trim();
      if (!s) return;
      params[key] = numeric ? Number(s) : s;
    };
    set('goods_keyword', keyword);
    set('updated_at_start', updatedAtStart);
    set('updated_at_end', updatedAtEnd);
    set('supplier_name', supplierName);
    set('create_user_name', createUserName);
    set('category_name', categoryName);
    set('source', source, true);
    set('is_enable', isEnable, true);
    const records = await this.fetchAll('goods', params);
    return records.map((g: any) => ({
      id: g.id,
      code: g.code ?? '',
      name: g.name ?? '',
      standard: g.standard ?? '',
      categoryPathNames: g.category_path_names ?? '',
      source: Number(g.source ?? 0),
      sourceName: g.source_name ?? '',
      unitName: g.unit?.name ?? '',
      updatedAt: g.updated_at ?? null,
      /** 扩展字段（自定义属性），[{ name, value }]，如 HT图号等 */
      fieldValueList: g.fieldValueList ?? [],
      /** 扩展字段 key-value 映射，方便直接取值（如 fieldValues['HT图号']） */
      fieldValues: Object.fromEntries((g.fieldValueList ?? []).map((f: any) => [f.name, f.value ?? ''])),
    }));
  }
}
