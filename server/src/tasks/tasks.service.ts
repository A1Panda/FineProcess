import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdSyncService } from '../kgd/kgd-sync.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { JwtPayload } from '../auth/auth.service';

/** 快工单生产任务 -> 前端展示结构 */
export interface TaskView {
  id: number;
  produceBillId: number;
  produceBillCode: string;
  htNo: string | null;
  goodsName: string;
  goodsCode: string | null;
  /** 商品规格（如 500*500*50） */
  spec: string;
  craftName: string;
  craftCode: string | null;
  unitName: string;
  num: string;
  validNum: string;
  wasteNum: string;
  statusName: string;
  planStart: string | null;
  planEnd: string | null;
  workshopPathNames: string;
  produceLineNames: string;
  priceModeName: string;
  unitMoney: string;
  standardWorkingMinutes: string;
  /** 交期（来自加工单 delivery_date，无则空串） */
  deliveryDate: string | null;
  /** 该任务可报工人姓名（逗号分隔，快工单按工序配置），供报工时选择报工人 */
  reportableUserNames: string | null;
  /** 整张加工单的工序进度（同单按工艺顺序排列，含当前任务所在工序） */
  craftProgress: CraftProgress[];
}

/** 加工单内单道工序的进度信息 */
export interface CraftProgress {
  craftName: string;
  statusName: string;
  /** 1=未开始 2=进行中 3=已完成 4=已暂停（用于前端判断工序是否已开始） */
  status: number;
  /** 完成百分比 0-100（良品+不良 / 计划数） */
  percent: number;
  num: number;
  validNum: number;
  wasteNum: number;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly kgdClient: KgdClientService,
    private readonly sync: KgdSyncService,
    @InjectRepository(KgdTaskCache) private readonly taskCache: Repository<KgdTaskCache>,
    @InjectRepository(KgdBillCache) private readonly billCache: Repository<KgdBillCache>,
  ) {}

  private toView(t: KgdTaskCache, deliveryDate: string | null = null): TaskView {
    return {
      id: t.taskId,
      produceBillId: t.billId,
      produceBillCode: t.billCode,
      htNo: t.htNo,
      goodsName: t.goodsName,
      goodsCode: t.goodsCode ?? '',
      spec: t.goodsSpec ?? '',
      craftName: t.craftName,
      craftCode: t.craftCode,
      unitName: t.unitName,
      num: t.num,
      validNum: t.validNum,
      wasteNum: t.wasteNum,
      statusName: t.statusName,
      planStart: null,
      planEnd: null,
      workshopPathNames: t.workshopPathNames,
      produceLineNames: t.produceLineNames,
      priceModeName: '',
      unitMoney: '',
      standardWorkingMinutes: '',
      deliveryDate,
      reportableUserNames: t.reportableUserNames,
      craftProgress: [],
    };
  }

  /**
   * 当前工人的任务列表：从本地缓存读取，支持分页。
   * all=true 时不做人员过滤，返回该工序全部任务（工序操作页使用）。
   * 工序链过滤：同一加工单内按 taskId 升序为工艺顺序（编程为第一步），
   * 后序工序仅当前序工序"已开始且有报工数据"时才会返回。
   */
  async getMyTasks(
    user: JwtPayload,
    options: { status?: number | number[]; craftName?: string; keyword?: string } = {},
    all = false,
    page = 1,
    pageSize = 20,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));

    // 1) 基础条件查询（不 join、不分页），仅取轻量字段用于链判断
    const base = this.taskCache.createQueryBuilder('t');
    if (!all) base.andWhere('t.reportableUserNames LIKE :name', { name: `%${user.name}%` });
    // status 支持多值（如 '1,2' 表示未开始+进行中），单值时保持精确匹配
    if (options.status && Array.isArray(options.status)) {
      base.andWhere(
        options.status.length === 1 ? 't.status = :s1' : 't.status IN (:...status)',
        options.status.length === 1 ? { s1: options.status[0] } : { status: options.status },
      );
    } else if (options.status !== undefined) {
      base.andWhere('t.status = :status', { status: options.status });
    }
    if (options.craftName) base.andWhere('t.craftName = :craftName', { craftName: options.craftName });
    // 模糊搜索：HT图号 / 产品名（转义 LIKE 通配符）
    const kw = (options.keyword ?? '').trim();
    if (kw) {
      const esc = kw.replace(/[\\%_]/g, (m) => `\\${m}`);
      base.andWhere('(t.htNo LIKE :kw OR t.goodsName LIKE :kw)', { kw: `%${esc}%` });
    }
    const allRows = await base
      .select(['t.taskId', 't.billCode', 't.status', 't.validNum', 't.wasteNum', 't.endTime'])
      .getMany();

    // 2) 工序链锁定：后序工序的前序未"开始且有报工"则隐藏
    const locked = await this.computeLockedIds(allRows);
    let visible = allRows.filter((r) => !locked.has(Number(r.taskId)));
    // 已完成视图（status 单值 3）：按完成时间倒序（最新完成在前，空值排最后），保证跨页全局有序
    const isDoneView = options.status === 3 || (Array.isArray(options.status) && options.status.join(',') === '3');
    if (isDoneView) {
      visible = visible.sort((a, b) => {
        const ta = a.endTime ?? '';
        const tb = b.endTime ?? '';
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return tb.localeCompare(ta);
      });
    }
    const visibleIds = visible.map((r) => r.taskId);
    const total = visibleIds.length;

    // 3) 分页（已完成视图已在分页前按完成时间全局排序）
    const slice = visibleIds.slice((pageNum - 1) * size, pageNum * size);
    if (!slice.length) return { list: [], total, page: pageNum, pageSize: size };

    const qb = this.taskCache.createQueryBuilder('t').where('t.taskId IN (:...ids)', { ids: slice });
    // 关联键用加工单编号（task.bill_id 始终为 0，无法关联）
    // 排序键用 addSelect 计算列，避免 TypeORM 无法解析 CASE 表达式；
    // join 列不自定义别名，否则分页 distinctAlias 子查询列名对不上
    const q = qb.leftJoin(KgdBillCache, 'b', 'b.code = t.billCode').addSelect('b.deliveryDate');
    if (isDoneView) {
      // 已完成视图：按完成时间倒序，最新完成在最前
      q.orderBy('t.endTime', 'DESC').addOrderBy('t.billCode', 'ASC');
    } else {
      // 非已完成：按交期从早到晚，无交期排最后
      q.addSelect(
        `CASE WHEN b.deliveryDate IS NULL OR b.deliveryDate = '' THEN 1 ELSE 0 END`,
        'deliveryNull',
      )
        .orderBy('deliveryNull', 'ASC')
        .addOrderBy('b.deliveryDate', 'ASC')
        .addOrderBy('t.status', 'ASC')
        .addOrderBy('t.htNo', 'ASC')
        .addOrderBy('t.billCode', 'ASC');
    }
    const { entities, raw } = await q.getRawAndEntities();
    const list = entities.map((t, i) => this.toView(t, raw[i]?.b_delivery_date ?? null));
    // 附加整单工序进度：按分页内加工单编号批量加载工序链
    const pageCodes = [...new Set(entities.map((t) => t.billCode))];
    const chains = await this.loadChains(pageCodes);
    for (const v of list) {
      v.craftProgress = this.buildCraftProgress(chains.get(v.produceBillCode) ?? []);
    }
    return { list, total, page: pageNum, pageSize: size };
  }

  /** 批量加载加工单的完整工序链（同单按 taskId 升序 = 工艺顺序） */
  private async loadChains(billCodes: string[]) {
    const map = new Map<string, KgdTaskCache[]>();
    for (let i = 0; i < billCodes.length; i += 500) {
      const chunk = billCodes.slice(i, i + 500);
      const rows = await this.taskCache
        .createQueryBuilder('t')
        .select([
          't.taskId',
          't.billCode',
          't.craftName',
          't.status',
          't.statusName',
          't.num',
          't.validNum',
          't.wasteNum',
        ])
        .where('t.billCode IN (:...codes)', { codes: chunk })
        .getMany();
      for (const r of rows) {
        const arr = map.get(r.billCode) ?? [];
        arr.push(r);
        map.set(r.billCode, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => Number(a.taskId) - Number(b.taskId));
    return map;
  }

  /** 生成加工单工序进度：同单任务按工艺顺序，每道工序完成百分比 = 良品+不良 / 计划数 */
  private buildCraftProgress(chain: KgdTaskCache[]): CraftProgress[] {
    return chain.map((c) => {
      const num = Number(c.num) || 0;
      const done = Number(c.validNum) + Number(c.wasteNum);
      const percent = num > 0 ? Math.min(100, Math.round((done / num) * 100)) : 0;
      return {
        craftName: c.craftName,
        statusName: c.statusName,
        status: Number(c.status),
        percent,
        num,
        validNum: Number(c.validNum) || 0,
        wasteNum: Number(c.wasteNum) || 0,
      };
    });
  }

  /** 计算被锁定的工序 taskId 集合：
   * - 后序工序：前序未"开始且有报工"则锁定隐藏
   * - 第一步工序：若该加工单工序链内本身就是"编程"，始终显示；
   *   否则第一步的前置是加工单级"编程"（开始加工单=编程完成），需加工单已开始（status>=2）才显示 */
  private async computeLockedIds(
    rows: Array<{ taskId: number | string; billCode: string; status?: number | string }>,
  ): Promise<Set<number>> {
    const locked = new Set<number>();
    const billCodes = [...new Set(rows.map((r) => r.billCode))];
    if (!billCodes.length) return locked;
    const chains = await this.loadChains(billCodes);
    const billStatus = await this.loadBillStatus(billCodes);
    for (const row of rows) {
      const chain = chains.get(row.billCode);
      if (!chain || !chain.length) continue;
      const idx = chain.findIndex((c) => c.taskId === Number(row.taskId));
      if (idx < 0) continue;
      if (idx === 0) {
        // 链内无"编程"工序时，第一步由加工单状态门控（加工单未开始=编程未做，隐藏）
        const chainHasBianCheng = chain.some((c) => c.craftName === '编程');
        const billStarted = Number(billStatus.get(row.billCode) ?? 1) >= 2;
        if (!chainHasBianCheng && !billStarted) locked.add(Number(row.taskId));
        continue;
      }
      if (!this.isChainUnlocked(chain[idx - 1])) locked.add(Number(row.taskId));
    }
    return locked;
  }

  /** 批量加载加工单状态（code -> status），用于无编程工序任务时的第一步门控 */
  private async loadBillStatus(billCodes: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (let i = 0; i < billCodes.length; i += 500) {
      const chunk = billCodes.slice(i, i + 500);
      const rows = await this.billCache
        .createQueryBuilder('b')
        .select(['b.code', 'b.status'])
        .where('b.code IN (:...codes)', { codes: chunk })
        .getMany();
      for (const r of rows) map.set(r.code, Number(r.status));
    }
    return map;
  }

  /** 前序工序解锁条件：已开始（status>=2，含进行中/已暂停/已完成）且产生过报工数据 */
  private isChainUnlocked(t: KgdTaskCache): boolean {
    const started = Number(t.status) >= 2;
    const hasReport = Number(t.validNum) > 0 || Number(t.wasteNum) > 0;
    return started && hasReport;
  }

  /** 立即同步一次快工单数据（手动刷新触发），等待完成后返回耗时 */
  async syncNow() {
    const start = Date.now();
    await this.sync.requestSync();
    return { ok: true, duration: Date.now() - start };
  }

  /** 首页统计：各状态数量 / 各工序未完成数量 / 编程未开始加工单数（与任务列表口径一致，排除被锁定的后序工序） */
  async getSummary(user: JwtPayload) {
    const userLike = `%${user.name}%`;
    // 取当前用户所有任务的轻量字段（含链判断所需信息）
    const rows = await this.taskCache
      .createQueryBuilder('t')
      .select(['t.taskId', 't.billCode', 't.craftName', 't.status', 't.validNum', 't.wasteNum'])
      .where('t.reportableUserNames LIKE :name', { name: userLike })
      .getMany();
    const locked = await this.computeLockedIds(rows);

    let unstarted = 0;
    let doing = 0;
    let done = 0;
    const craftCount: Record<string, number> = {};
    for (const r of rows) {
      if (locked.has(Number(r.taskId))) continue;
      const st = Number(r.status);
      if (st === 1) unstarted++;
      else if (st === 2) doing++;
      else if (st === 3) done++;
      if (st !== 3) craftCount[r.craftName] = (craftCount[r.craftName] ?? 0) + 1;
    }
    // 编程：未开始加工单数（加工单状态=1，与编程页面口径一致）
    const bianchengBillCount = await this.billCache.count({ where: { status: 1 } });
    return {
      statusCount: { unstarted, doing, done, total: unstarted + doing + done },
      craftCount,
      bianchengBillCount,
    };
  }

  /** 任务状态修改：1=未开始 2=进行中 3=已完成 4=暂停 */
  private async changeStatus(id: number, status: 1 | 2 | 3 | 4) {
    if (!Number.isInteger(id)) throw new BadRequestException('任务ID无效');
    return this.kgdClient.editTaskStatus(id, status);
  }

  /** 开工（进行中） */
  async start(id: number) {
    const r = await this.changeStatus(id, 2);
    // 直接更新本地缓存，前端可立即看到状态变化（无需等同步）
    await this.taskCache.update({ taskId: id }, { status: 2, statusName: '进行中' });
    this.sync.requestSync();
    return r;
  }

  /** 暂停 */
  async pause(id: number) {
    const r = await this.changeStatus(id, 4);
    await this.taskCache.update({ taskId: id }, { status: 4, statusName: '已暂停' });
    this.sync.requestSync();
    return r;
  }

  /** 完工（已完成） */
  async finish(id: number) {
    const r = await this.changeStatus(id, 3);
    await this.taskCache.update({ taskId: id }, { status: 3, statusName: '已完成' });
    this.sync.requestSync();
    return r;
  }

  /** 编程工序专用：按加工单编号查ID，然后修改加工单状态为"开始" */
  async startProduceBillByCode(code: string) {
    if (!code) throw new BadRequestException('加工单编号不能为空');
    const { data } = await this.kgdClient.listProduceBills({ code, pageSize: 1 });
    const bill = data?.[0];
    if (!bill?.id) throw new BadRequestException(`未找到加工单: ${code}`);
    const r = await this.kgdClient.editProduceBillStatus(bill.id, 1);
    // 直接更新本地缓存：开始后加工单进入进行中
    await this.billCache.update({ code }, { status: 2, statusName: '进行中' });
    this.sync.requestSync();
    return r;
  }

  /** 编程工序专用：按加工单编号查ID，然后把加工单撤回（2=撤回，回到未开始） */
  async cancelProduceBillByCode(code: string) {
    if (!code) throw new BadRequestException('加工单编号不能为空');
    const { data } = await this.kgdClient.listProduceBills({ code, pageSize: 1 });
    const bill = data?.[0];
    if (!bill?.id) throw new BadRequestException(`未找到加工单: ${code}`);
    const r = await this.kgdClient.editProduceBillStatus(bill.id, 2);
    // 直接更新本地缓存：撤回后加工单回到未开始
    await this.billCache.update({ code }, { status: 1, statusName: '未开始' });
    this.sync.requestSync();
    return r;
  }

  /** 编程工序专用：拉取未开始的加工单（从本地缓存 status=1） */
  async getUnstartedBills() {
    return this.getBillsByStatus(1);
  }

  /** 编程工序专用：拉取加工单状态为"进行中"的加工单（缓存 status=2） */
  async getInProgressBills() {
    return this.getBillsByStatus(2);
  }

  private async getBillsByStatus(status?: number) {
    const qb = this.billCache.createQueryBuilder('b');
    if (status !== undefined) qb.where('b.status = :status', { status });
    // 按交期（delivery_date）从早到晚排序，无交期的排最后
    // 排序键用 addSelect 计算列，避免 TypeORM 无法解析 CASE 表达式
    qb.addSelect(
      `CASE WHEN b.deliveryDate IS NULL OR b.deliveryDate = '' THEN 1 ELSE 0 END`,
      'deliveryNull',
    )
      .orderBy('deliveryNull', 'ASC')
      .addOrderBy('b.deliveryDate', 'ASC')
      .addOrderBy('b.htNo', 'ASC')
      .addOrderBy('b.code', 'ASC');
    const rows = await qb.getMany();
    const codes = rows.map((b) => b.code);
    const chains = await this.loadChains(codes);
    return rows.map((b) => {
      const chain = chains.get(b.code) ?? [];
      return {
        id: b.billId,
        produceBillId: b.billId,
        produceBillCode: b.code,
        htNo: b.htNo,
        goodsName: b.goodsName,
        num: b.num,
        unitName: b.unitName,
        statusName: b.statusName,
        workshopPathNames: '',
        craftName: '',
        deliveryDate: b.deliveryDate ?? '',
        /** 整张加工单的工序进度（编程页可看到后续每道工序完成情况） */
        craftProgress: this.buildCraftProgress(chain),
      };
    });
  }
}
