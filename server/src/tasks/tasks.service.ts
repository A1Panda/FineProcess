import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdSyncService } from '../kgd/kgd-sync.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdReportCache } from '../report/kgd-report-cache.entity';
import { User } from '../auth/users.entity';
import { JwtPayload } from '../auth/auth.service';

/** 临期提醒天数：交期距今天 <= 该值视为临期（含今天到期） */
const BILL_DUE_SOON_DAYS = 3;

/** 取今天日期 'YYYY-MM-DD'（本地时区） */
function fmtToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
  /** 自定义目标完成日期（人工设置，优先于 deliveryDate 用于日均计算；无则空串） */
  targetDate: string | null;
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

/** 加工单进度统计快照（管理员数据大屏顶部统计条） */
export interface BillProgressStats {
  /** 未编程（未开始 status=1）加工单数 */
  unprogrammed: number;
  /** 加工单总数（当前关键词范围） */
  total: number;
  /** 进行中加工单数 */
  inProgress: number;
  /** 已逾期（未完成且交期已过） */
  overdue: number;
  /** 临期（3 天内到期） */
  dueSoon: number;
}

/** 工序产出趋势：单工序单日产量快照 */
export interface CraftTrendPoint {
  date: string;
  /** 当日良品数 */
  valid: number;
  /** 当日废品数 */
  waste: number;
  /** 当日报工次数 */
  cnt: number;
}

/** 工序产出趋势：单工序汇总（近 N 天） */
export interface CraftTrendItem {
  name: string;
  points: CraftTrendPoint[];
  totals: {
    valid: number;
    waste: number;
    cnt: number;
    /** 合格率（良品/(良品+废品)，无废品数据为 100） */
    passRate: number;
  };
}

/** 报工统计：窗口内单日产出 */
export interface ReportStatsDay {
  date: string;
  valid: number;
  waste: number;
  cnt: number;
}

/** 报工统计：单条产线（报工人所属部门/分组）汇总 */
export interface ReportStatsLine {
  /** 产线/分组名（如 生产部/南线、包装部/打磨/A组） */
  line: string;
  valid: number;
  waste: number;
  cnt: number;
  /** 一次合格率（良品/(良品+废品)，无废品数据为 100） */
  passRate: number;
}

/** 报工统计：按工序汇总（含该工序下各产线细分） */
export interface ReportStatsCraft {
  name: string;
  valid: number;
  waste: number;
  cnt: number;
  passRate: number;
  /** 该工序下各产线汇总（按良品降序） */
  lines: ReportStatsLine[];
}

/** 报工统计：按报工人汇总行（含所属产线/分组） */
export interface ReportStatsRow {
  name: string;
  /** 报工人所属产线/分组（department_path_names，查不到为 未分组） */
  line: string;
  valid: number;
  waste: number;
  cnt: number;
  /** 一次合格率（良品/(良品+废品)，无废品数据为 100） */
  passRate: number;
}

/** 报工统计：近 N 天按日/按工序（含产线）/按报工人汇总 */
export interface ReportStatsResult {
  days: number;
  startDate: string;
  endDate: string;
  daily: ReportStatsDay[];
  crafts: ReportStatsCraft[];
  users: ReportStatsRow[];
  generatedAt: string;
}

/** 单工序多日报工：某加工单某工序近 N 天每日良品/废品/报工次数 */
export interface CraftDailyResult {
  billCode: string;
  craftName: string;
  days: number;
  startDate: string;
  endDate: string;
  daysList: string[];
  points: CraftTrendPoint[];
  totals: { valid: number; waste: number; cnt: number; passRate: number };
  generatedAt: string;
}

/** 完工预测：工序明细（一道工序把整单数量做一遍 = 1 件次） */
export interface BillForecastCraft {
  name: string;
  /** 1=未开始 2=进行中 3=已完成 */
  status: number;
  statusName: string;
  /** 该工序计划数 */
  plan: number;
  /** 该工序已完成数 */
  valid: number;
  /** 近 7 天该工序报工总量 */
  weekValid: number;
  /** 近 7 天该工序有报工的天数 */
  weekActive: number;
  /** 该工序日均件次（近 7 天报工 / 有报工天数），仅作展示 */
  daily: number;
  /** 该工序预计还需天数（未完成且最近有报工才有值），null=无法按工序估算 */
  etaDays: number | null;
}

/** 工序明细的基础字段（周报工/日均/预估由后端按报工记录补充） */
type BillForecastCraftBase = Omit<BillForecastCraft, 'weekValid' | 'weekActive' | 'daily' | 'etaDays'>;

/** 完工预测：进行中加工单行（近 7 天报工历史 + 按工序件次估算完成日期） */
export interface BillForecastRow {
  code: string;
  htNo: string | null;
  goodsName: string;
  spec: string;
  num: number;
  unitName: string;
  status: number;
  statusName: string;
  deliveryDate: string | null;
  /** 累计已完成件次（各工序良品之和，全部历史） */
  reported: number;
  /** 剩余件次 = 总件次 - 已完成件次 */
  remaining: number;
  /** 完成百分比（已完成件次 / 总件次，0-100） */
  progressPercent: number;
  /** 近 7 天每日报工（件次） */
  weekDays: { date: string; valid: number }[];
  /** 近 7 天每日报工明细（按工序拆分，仅含当日有报工的工序） */
  weekDaysDetail: { date: string; crafts: { name: string; valid: number }[] }[];
  /** 近 7 天报工总量（件次） */
  weekTotal: number;
  /** 有报工的天数 */
  activeDays: number;
  /** 日均件次（近 7 天总量 / 有报工天数），仅作展示 */
  dailyAvg: number;
  /** 预计还需天数（按最近报工日速度），无数据为 null */
  etaDays: number | null;
  /** 预计完成日期（YYYY-MM-DD），无数据为 null */
  etaDate: string | null;
  /** 预计完成日晚于交期 = 预计逾期 */
  overrunDelivery: boolean;
  /** 工序明细（按工艺顺序） */
  crafts: BillForecastCraft[];
  /** 剩余工序数（未完成） */
  remainingCrafts: number;
  /** 已完成工序数 */
  doneCrafts: number;
}

/** 完工预测统计快照 */
export interface BillForecastStats {
  /** 进行中加工单总数 */
  total: number;
  /** 有报工数据可估算的单数 */
  withData: number;
  /** 近 7 天报工总量（全部进行中单） */
  weekReported: number;
  /** 预计逾期风险单数 */
  risk: number;
}

/** 加工单进度行（管理员数据大屏） */
export interface BillProgressRow {
  code: string;
  htNo: string | null;
  goodsName: string;
  spec: string;
  num: number;
  unitName: string;
  status: number;
  statusName: string;
  deliveryDate: string | null;
  /** 是否已逾期（未完成且交期早于今天） */
  overdue: boolean;
  /** 是否临期（3 天内到期） */
  dueSoon: boolean;
  /** 距交期天数：负数=已逾期天数，0=今天到期，null=无交期 */
  dueInDays: number | null;
  /** 总工序数 */
  totalCrafts: number;
  /** 已完成工序数 */
  doneCrafts: number;
  /** 整体进度：各工序完成百分比平均（0-100） */
  progressPercent: number;
  crafts: CraftProgress[];
}

@Injectable()
export class TasksService {
  constructor(
    private readonly kgdClient: KgdClientService,
    private readonly sync: KgdSyncService,
    @InjectRepository(KgdTaskCache) private readonly taskCache: Repository<KgdTaskCache>,
    @InjectRepository(KgdBillCache) private readonly billCache: Repository<KgdBillCache>,
    @InjectRepository(KgdReportCache) private readonly reportCache: Repository<KgdReportCache>,
    @InjectRepository(User) private readonly users: Repository<User>,
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
      targetDate: t.targetDate ?? null,
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
    // 排除加工单已暂停（快工单 status=5）的任务：快工单暂停加工单不会暂停其任务（任务仍是 1/2），
    // 需按加工单状态过滤，否则暂停单会一直显示在未开工/进行中列表
    base
      .leftJoin(KgdBillCache, 'b', 'b.code = t.billCode')
      .andWhere('(b.status IS NULL OR b.status <> 5)');
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

  /** 批量加载加工单的完整工序链（同单按工艺编码升序 = 工艺顺序，无编码按 taskId 兜底） */
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
        const arr = map.get(r.billCode) ?? [];
        arr.push(r);
        map.set(r.billCode, arr);
      }
    }
    for (const arr of map.values())
      arr.sort((a, b) => {
        const sa = a.craftSeq != null ? Number(a.craftSeq) : Number(a.taskId);
        const sb = b.craftSeq != null ? Number(b.craftSeq) : Number(b.taskId);
        return sa - sb;
      });
    return map;
  }

  /** 生成加工单工序进度：同单任务按工艺顺序，每道工序完成百分比 = 良品 / 计划数（不良品需返工不算产出，与自动完工/完工预测口径一致） */
  private buildCraftProgress(chain: KgdTaskCache[]): CraftProgress[] {
    return chain.map((c) => {
      const num = Number(c.num) || 0;
      const valid = Number(c.validNum) || 0;
      const waste = Number(c.wasteNum) || 0;
      // 累计良品达到计划数 → 显示层自动标记完成（即使快工单状态未同步，如远程拒绝自动完工）
      const autoDone = num > 0 && valid >= num && Number(c.status) !== 3;
      const status = autoDone ? 3 : Number(c.status);
      const percent = num > 0 ? Math.min(100, Math.round((valid / num) * 100)) : 0;
      return {
        craftName: c.craftName,
        statusName: autoDone ? '已完成' : c.statusName,
        status,
        percent,
        num,
        validNum: valid,
        wasteNum: waste,
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

  /** 立即同步一次快工单数据（手动刷新触发），等待完成后返回耗时。
   *  forceFull=false（默认）：增量/活动状态同步（加工单只拉未开始+进行中，任务只拉活动状态，约 0.6s）
   *  forceFull=true：全量同步 + 全量对账（清理远程已删除的记录，约 10-13s），用于长按刷新
   *  reportWindowDays>0：报工记录额外覆盖最近 N 天窗口（短按刷新，完善近期被修改/漏同步的报工） */
  async syncNow(forceFull = false, reportWindowDays = 0) {
    const start = Date.now();
    await this.sync.requestSync(forceFull, reportWindowDays);
    return { ok: true, full: forceFull, duration: Date.now() - start };
  }

  /** 从公版 Web 系统回填报工时间（OpenAPI 记录无时间戳，纯同步记录在此补齐） */
  syncWebReportTimes() {
    return this.sync.syncWebReportTimes();
  }

  /** 首页统计：各状态数量 / 各工序未完成数量 / 编程未开始加工单数（与任务列表口径一致，排除被锁定的后序工序） */
  async getSummary(user: JwtPayload) {
    const userLike = `%${user.name}%`;
    // 取当前用户所有任务的轻量字段（含链判断所需信息）；排除加工单已暂停（status=5）的任务，与任务列表口径一致
    const rows = await this.taskCache
      .createQueryBuilder('t')
      .leftJoin(KgdBillCache, 'b', 'b.code = t.billCode')
      .select(['t.taskId', 't.billCode', 't.craftName', 't.status', 't.validNum', 't.wasteNum'])
      .where('t.reportableUserNames LIKE :name', { name: userLike })
      .andWhere('(b.status IS NULL OR b.status <> 5)')
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
        /** 商品规格（如 97.2*50.04*9.5），编程页卡片加工单号后展示 */
        spec: b.goodsSpec ?? '',
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

  /**
   * 管理员数据大屏：加工单进度列表（全量加工单 + 每单工序进度 + 逾期/临期标记）。
   * - status：多值过滤（逗号分隔），缺省=全部状态
   * - keyword：单号 / HT图号 / 产品名模糊搜索
   * - sortBy：delivery（默认，逾期/临期优先 + 交期从早到晚）| progress（进度升序）| remaining（剩余工序数降序）
   * - overdueOnly：只看已逾期加工单
   * - 数据取自本地缓存（kgd_bill_cache + kgd_task_cache），秒级响应；整体进度 = 各工序完成百分比平均
   */
  async getBillProgress(
    options: {
      status?: number[];
      keyword?: string;
      sortBy?: string;
      overdueOnly?: boolean;
      /** 只看临期（3 天内到期）加工单 */
      dueSoonOnly?: boolean;
      /** 特殊筛选：done-today=今日已完成（未编程=未开始 status=1，走 status 参数） */
      scope?: 'done-today';
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ list: BillProgressRow[]; total: number; stats: BillProgressStats; page: number; pageSize: number }> {
    const pageNum = Math.max(1, Number(options.page) || 1);
    const size = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const kw = (options.keyword ?? '').trim();
    const today = fmtToday();

    // 1) 基础过滤：状态 + 关键词（默认排除已取消 status=4；已完成但无任何报工记录的单视为异常，一并排除）
    const qb = this.billCache.createQueryBuilder('b');
    if (options.status?.length) qb.andWhere('b.status IN (:...status)', { status: options.status });
    else qb.andWhere('b.status <> 4');
    qb.andWhere(
      'NOT (b.status = 3 AND NOT EXISTS (SELECT 1 FROM kgd_report_cache r WHERE r.bill_code = b.code))',
    );
    // 特殊筛选：今日已完成（status=3 且工序 end_time 在今天）；未编程=未开始(status=1)由 status 参数承载
    if (options.scope === 'done-today') {
      const todayStart = `${today} 00:00:00`;
      const todayEnd = `${this.daysAhead(today, 1)} 00:00:00`;
      qb.andWhere(
        "b.status = 3 AND EXISTS (SELECT 1 FROM kgd_task_cache t WHERE t.bill_code = b.code AND t.end_time IS NOT NULL AND t.end_time <> '' AND t.end_time >= :todayStart AND t.end_time < :todayEnd)",
        { todayStart, todayEnd },
      );
    }
    if (kw) qb.andWhere('(b.code LIKE :kw OR b.htNo LIKE :kw OR b.goodsName LIKE :kw)', { kw: `%${kw}%` });
    const bills = await qb.getMany();

    // 2) 统计快照（仅随关键词，不随状态筛选/分页）：未编程 / 总单 / 进行中 / 已逾期 / 临期
    const soonDate = this.daysAhead(today, BILL_DUE_SOON_DAYS);
    const statsQb = this.billCache.createQueryBuilder('b');
    statsQb.andWhere('b.status <> 4');
    statsQb.andWhere(
      'NOT (b.status = 3 AND NOT EXISTS (SELECT 1 FROM kgd_report_cache r WHERE r.bill_code = b.code))',
    );
    if (kw) statsQb.andWhere('(b.code LIKE :kw OR b.htNo LIKE :kw OR b.goodsName LIKE :kw)', { kw: `%${kw}%` });
    const statsRow = (await statsQb
      .select('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN b.status = 1 THEN 1 ELSE 0 END)', 'unprogrammed')
      .addSelect('SUM(CASE WHEN b.status = 2 THEN 1 ELSE 0 END)', 'inProgress')
      .addSelect(
        `SUM(CASE WHEN b.status IN (1,2) AND b.deliveryDate IS NOT NULL AND b.deliveryDate <> '' AND SUBSTRING(b.deliveryDate,1,10) < '${today}' THEN 1 ELSE 0 END)`,
        'overdue',
      )
      .addSelect(
        `SUM(CASE WHEN b.status IN (1,2) AND b.deliveryDate IS NOT NULL AND b.deliveryDate <> '' AND SUBSTRING(b.deliveryDate,1,10) BETWEEN '${today}' AND '${soonDate}' THEN 1 ELSE 0 END)`,
        'dueSoon',
      )
      .getRawOne()) as any;
    const stats: BillProgressStats = {
      unprogrammed: Number(statsRow?.unprogrammed ?? 0),
      total: Number(statsRow?.total ?? 0),
      inProgress: Number(statsRow?.inProgress ?? 0),
      overdue: Number(statsRow?.overdue ?? 0),
      dueSoon: Number(statsRow?.dueSoon ?? 0),
    };

    // 3) 工序链 + 组装行
    const chains = await this.loadChains(bills.map((b) => b.code));
    const rows = bills.map((b) => {
      const crafts = this.buildCraftProgress(chains.get(b.code) ?? []);
      const doneCrafts = crafts.filter((c) => c.status === 3).length;
      const progressPercent = crafts.length
        ? Math.round(crafts.reduce((s, c) => s + c.percent, 0) / crafts.length)
        : 0;
      const dueInDays = this.daysUntil(b.deliveryDate, today);
      const active = b.status === 1 || b.status === 2;
      const overdue = active && dueInDays !== null && dueInDays < 0;
      const dueSoon = active && dueInDays !== null && dueInDays >= 0 && dueInDays <= BILL_DUE_SOON_DAYS;
      return {
        code: b.code,
        htNo: b.htNo,
        goodsName: b.goodsName,
        spec: b.goodsSpec ?? '',
        num: b.num,
        unitName: b.unitName,
        status: b.status,
        statusName: b.statusName,
        deliveryDate: b.deliveryDate,
        overdue,
        dueSoon,
        dueInDays,
        totalCrafts: crafts.length,
        doneCrafts,
        progressPercent,
        crafts,
      };
    });

    // 4) 过滤 + 排序 + 分页
    let list = options.overdueOnly ? rows.filter((r) => r.overdue) : options.dueSoonOnly ? rows.filter((r) => r.dueSoon) : rows;
    const sortBy = options.sortBy ?? 'delivery';
    list.sort((a, b) => {
      if (sortBy === 'progress') {
        return a.progressPercent - b.progressPercent || this.compareDelivery(a, b);
      }
      if (sortBy === 'remaining') {
        const ra = a.totalCrafts - a.doneCrafts;
        const rb = b.totalCrafts - b.doneCrafts;
        return rb - ra || this.compareDelivery(a, b);
      }
      // 默认 delivery：逾期 / 临期优先，再按交期从早到晚
      const pa = a.overdue ? 0 : a.dueSoon ? 1 : 2;
      const pb = b.overdue ? 0 : b.dueSoon ? 1 : 2;
      return pa - pb || this.compareDelivery(a, b);
    });
    const total = list.length;
    return { list: list.slice((pageNum - 1) * size, pageNum * size), total, stats, page: pageNum, pageSize: size };
  }

  /**
   * 管理员数据大屏：完工预测（进行中加工单的近 7 天报工历史 + 按工序件次估算完成日期）。
   * - 数据取自本地缓存：bill_cache(status=2) + task_cache(工序链) + report_cache（报工时间按公版回填）
   * - 件次口径：每道工序都要把整单数量做一遍，总件次 = Σ 各工序计划数；剩余件次 = Σ(计划数-已完成数)
   * - 预计完成：整单口径 ceil(剩余件次/整单日均件次) 与 各未完成工序的瓶颈口径 ceil(剩余/该工序日均) 取大
   *   （工序为顺序加工，完工时间由最慢工序决定；逐工序估算可暴露瓶颈）
   * - 排序：可估算的单按预计完成日期从近到远，无报工数据的排最后
   */
  async getBillForecast(
    options: { keyword?: string; page?: number; pageSize?: number } = {},
  ): Promise<{ list: BillForecastRow[]; total: number; stats: BillForecastStats; page: number; pageSize: number }> {
    const pageNum = Math.max(1, Number(options.page) || 1);
    const size = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const kw = (options.keyword ?? '').trim();
    const today = fmtToday();
    const weekStart = this.daysAhead(today, -6);

    // 1) 进行中加工单（status=2）
    const qb = this.billCache.createQueryBuilder('b').where('b.status = 2');
    if (kw) qb.andWhere('(b.code LIKE :kw OR b.htNo LIKE :kw OR b.goodsName LIKE :kw)', { kw: `%${kw}%` });
    const bills = await qb.getMany();
    const codes = bills.map((b) => b.code);
    if (!codes.length) {
      return {
        list: [],
        total: 0,
        stats: { total: 0, withData: 0, weekReported: 0, risk: 0 },
        page: pageNum,
        pageSize: size,
      };
    }

    // 2) 工序链（kgd_task_cache，按工艺顺序）：每道工序都要把整单数量做一遍
    const tasks = await this.taskCache.find({
      where: { billCode: In(codes) },
      order: { billCode: 'ASC', craftSeq: 'ASC' },
      select: { billCode: true, craftName: true, craftSeq: true, num: true, validNum: true, status: true, statusName: true },
    });
    const craftMap = new Map<string, BillForecastCraftBase[]>();
    for (const t of tasks) {
      const arr = craftMap.get(t.billCode) ?? [];
      arr.push({
        name: t.craftName,
        status: t.status,
        statusName: t.statusName,
        plan: Number(t.num) || 0,
        valid: Number(t.validNum) || 0,
      });
      craftMap.set(t.billCode, arr);
    }

    // 3) 全部历史报工累计（按单，工序数据缺失时兜底）
    const allRows = (await this.reportCache
      .createQueryBuilder('r')
      .select('r.bill_code', 'code')
      .addSelect('SUM(CAST(r.valid_num AS DECIMAL(20,2)))', 'valid')
      .where('r.bill_code IN (:...codes)', { codes })
      .groupBy('r.bill_code')
      .getRawMany()) as Array<{ code: string; valid: string }>;
    const reportedMap = new Map(allRows.map((r) => [r.code, Number(r.valid) || 0]));

    // 4) 近 7 天每日报工（按单×工序，件次口径）
    const weekRows = (await this.reportCache
      .createQueryBuilder('r')
      .select('r.bill_code', 'code')
      .addSelect('r.craft_name', 'craftName')
      .addSelect('SUBSTRING(r.report_time, 1, 10)', 'day')
      .addSelect('SUM(CAST(r.valid_num AS DECIMAL(20,2)))', 'valid')
      .where('r.bill_code IN (:...codes)', { codes })
      .andWhere('r.report_time >= :start', { start: `${weekStart} 00:00:00` })
      .groupBy('r.bill_code')
      .addGroupBy('r.craft_name')
      .addGroupBy('SUBSTRING(r.report_time, 1, 10)')
      .getRawMany()) as Array<{ code: string; craftName: string; day: string; valid: string }>;
    const weekMap = new Map<string, Map<string, number>>();
    // code -> craftName -> day -> valid
    const craftWeekMap = new Map<string, Map<string, Map<string, number>>>();
    for (const r of weekRows) {
      const billDays = weekMap.get(r.code) ?? new Map<string, number>();
      billDays.set(r.day, (billDays.get(r.day) ?? 0) + (Number(r.valid) || 0));
      weekMap.set(r.code, billDays);
      const craftDays = craftWeekMap.get(r.code) ?? new Map<string, Map<string, number>>();
      const cd = craftDays.get(r.craftName) ?? new Map<string, number>();
      cd.set(r.day, (cd.get(r.day) ?? 0) + (Number(r.valid) || 0));
      craftDays.set(r.craftName, cd);
      craftWeekMap.set(r.code, craftDays);
    }
    const daysList: string[] = [];
    for (let i = 0; i < 7; i++) daysList.push(this.daysAhead(weekStart, i));

    // 5) 组装每单：工序链 + 报工历史 + 预计完成日期（件次口径，瓶颈工序优先）
    const list: BillForecastRow[] = bills.map((b) => {
      const num = b.num || 0;
      const crafts = craftMap.get(b.code) ?? [];
      // 无工序数据时按单道工序兜底（plan=整单数量）
      const effCrafts: BillForecastCraftBase[] = crafts.length
        ? crafts
        : [{ name: '', status: b.status, statusName: b.statusName, plan: num, valid: reportedMap.get(b.code) ?? 0 }];
      const craftWeek = craftWeekMap.get(b.code) ?? new Map<string, Map<string, number>>();
      // 每道工序的周报工 + 日均 + 预估天数（工序间为顺序加工，完工由"最慢的工序"决定）
      const craftEtas: number[] = [];
      // 第一遍：各工序周报工统计 + 最近报工日速度
      const withSpeed = effCrafts.map((c) => {
        const craftDays = craftWeek.get(c.name) ?? new Map<string, number>();
        const weekValid = Array.from(craftDays.values()).reduce((s, v) => s + v, 0);
        const weekActive = Array.from(craftDays.values()).filter((v) => v > 0).length;
        const daily = weekActive ? weekValid / weekActive : 0;
        return { c, weekValid, weekActive, daily, recentSpeed: this.recentDaySpeed(craftDays) };
      });
      // 参照速度：同单报工≥3天的稳定工序的最近报工日速度均值（刚开工工序借用，防 1 天数据误判产能）
      const stableSpeeds = withSpeed.filter((x) => x.weekActive >= 3 && x.recentSpeed > 0).map((x) => x.recentSpeed);
      const refSpeed = stableSpeeds.length ? stableSpeeds.reduce((s, v) => s + v, 0) / stableSpeeds.length : 0;
      const craftsDetail: BillForecastCraft[] = withSpeed.map((x) => {
        // 速度选取：本工序报工≥3天用自己的最近报工日速度；不足3天借用同单稳定工序均值；无参照退回自己的速度
        const speed = x.weekActive >= 3 ? x.recentSpeed : refSpeed > 0 ? refSpeed : x.recentSpeed;
        const remain = Math.max(0, x.c.plan - x.c.valid);
        let etaDays: number | null = null;
        if (x.c.status !== 3 && remain > 0 && speed > 0) {
          etaDays = Math.ceil(remain / speed);
          craftEtas.push(etaDays);
        }
        return { ...x.c, weekValid: x.weekValid, weekActive: x.weekActive, daily: Math.round(x.daily * 10) / 10, etaDays };
      });
      const totalWork = craftsDetail.reduce((s, c) => s + c.plan, 0);
      const doneWork = craftsDetail.reduce((s, c) => s + c.valid, 0);
      const reported = doneWork;
      const remaining = Math.max(0, totalWork - doneWork);
      const progressPercent = totalWork > 0 ? Math.min(100, Math.round((doneWork / totalWork) * 100)) : 0;
      const remainingCrafts = craftsDetail.filter((c) => c.status !== 3).length;
      const doneCrafts = craftsDetail.filter((c) => c.status === 3).length;
      const weekDays = daysList.map((d) => ({ date: d, valid: weekMap.get(b.code)?.get(d) ?? 0 }));
      // 每日按工序拆分（仅保留当日有报工的工序），供前端点击日期查看
      const weekDaysDetail = daysList.map((d) => {
        const crafts: { name: string; valid: number }[] = [];
        for (const [cname, cdays] of craftWeek) {
          const v = cdays.get(d) ?? 0;
          if (v > 0) crafts.push({ name: cname || '未命名工序', valid: v });
        }
        return { date: d, crafts };
      });
      const weekTotal = weekDays.reduce((s, d) => s + d.valid, 0);
      const activeDays = weekDays.filter((d) => d.valid > 0).length;
      const dailyAvg = activeDays ? Math.round((weekTotal / activeDays) * 10) / 10 : 0;
      // 整单预估用"最近报工日速度"（当前实际节奏），日均件次仅作展示
      const recentSpeed = this.recentDaySpeed(weekMap.get(b.code) ?? new Map<string, number>());
      let etaDays: number | null = null;
      let etaDate: string | null = null;
      if (recentSpeed > 0) {
        // 整单口径 + 各工序瓶颈口径取大，避免低估最慢工序的耗时
        const aggDays = remaining > 0 ? Math.ceil(remaining / recentSpeed) : 0;
        const craftMax = craftEtas.length ? Math.max(...craftEtas) : 0;
        etaDays = Math.max(aggDays, craftMax);
        etaDate = this.daysAhead(today, etaDays);
      }
      const deliveryDate = b.deliveryDate ?? null;
      const overrunDelivery = !!etaDate && !!deliveryDate && etaDate > deliveryDate.slice(0, 10);
      return {
        code: b.code,
        htNo: b.htNo,
        goodsName: b.goodsName,
        spec: b.goodsSpec ?? '',
        num,
        unitName: b.unitName,
        status: b.status,
        statusName: b.statusName,
        deliveryDate,
        reported,
        remaining,
        progressPercent,
        weekDays,
        weekDaysDetail,
        weekTotal,
        activeDays,
        dailyAvg,
        etaDays,
        etaDate,
        overrunDelivery,
        crafts: craftsDetail,
        remainingCrafts,
        doneCrafts,
      };
    });

    // 6) 排序 + 统计 + 分页
    list.sort((a, b) => {
      if (a.etaDate && b.etaDate) return a.etaDate < b.etaDate ? -1 : a.etaDate > b.etaDate ? 1 : a.code.localeCompare(b.code);
      if (a.etaDate) return -1;
      if (b.etaDate) return 1;
      return a.code.localeCompare(b.code);
    });
    const stats: BillForecastStats = {
      total: list.length,
      withData: list.filter((b) => b.etaDate).length,
      weekReported: list.reduce((s, b) => s + b.weekTotal, 0),
      risk: list.filter((b) => b.overrunDelivery).length,
    };
    return { list: list.slice((pageNum - 1) * size, pageNum * size), total: list.length, stats, page: pageNum, pageSize: size };
  }

  /**
   * 管理员数据大屏：工序产出趋势（近 N 天各工序每日良品/废品/报工次数）。
   * - days：统计天数（7~30，默认 7）
   * - craftNames：工序过滤（空=全部）
   * - 数据取自 kgd_report_cache.report_time（公版回填时间）；系统报工无工时字段
   *   （working_minutes 全为 0），故用"报工次数"反映每日工作强度
   */
  async getCraftTrend(days = 7, craftNames?: string[]) {
    const n = Math.min(30, Math.max(7, Number(days) || 7));
    const today = fmtToday();
    const start = this.daysAhead(today, -(n - 1));
    const qb = this.reportCache
      .createQueryBuilder('r')
      .select('r.craft_name', 'craftName')
      .addSelect('SUBSTRING(r.report_time, 1, 10)', 'day')
      .addSelect('SUM(CAST(r.valid_num AS DECIMAL(20,2)))', 'valid')
      .addSelect('SUM(CAST(r.waste_num AS DECIMAL(20,2)))', 'waste')
      .addSelect('COUNT(*)', 'cnt')
      .where("r.report_time <> '' AND r.report_time >= :start AND r.report_time < :end", {
        start: `${start} 00:00:00`,
        end: `${this.daysAhead(today, 1)} 00:00:00`,
      })
      .groupBy('r.craft_name')
      .addGroupBy('SUBSTRING(r.report_time, 1, 10)');
    if (craftNames?.length) qb.andWhere('r.craft_name IN (:...names)', { names: craftNames });
    const rows = (await qb.getRawMany()) as Array<{
      craftName: string;
      day: string;
      valid: string;
      waste: string;
      cnt: string;
    }>;

    // 按 工序+日期 聚合为连续 N 天序列
    const daysList: string[] = [];
    for (let i = 0; i < n; i++) daysList.push(this.daysAhead(start, i));
    const byCraft = new Map<string, Map<string, CraftTrendPoint>>();
    for (const r of rows) {
      const name = r.craftName || '未知工序';
      if (!byCraft.has(name)) byCraft.set(name, new Map());
      byCraft.get(name)!.set(r.day, {
        date: r.day,
        valid: Number(r.valid) || 0,
        waste: Number(r.waste) || 0,
        cnt: Number(r.cnt) || 0,
      });
    }

    const crafts: CraftTrendItem[] = [...byCraft.entries()].map(([name, m]) => {
      let valid = 0;
      let waste = 0;
      let cnt = 0;
      const points: CraftTrendPoint[] = daysList.map((d) => {
        const p = m.get(d) ?? { date: d, valid: 0, waste: 0, cnt: 0 };
        valid += p.valid;
        waste += p.waste;
        cnt += p.cnt;
        return p;
      });
      const total = valid + waste;
      return {
        name,
        points,
        totals: {
          valid,
          waste,
          cnt,
          passRate: total > 0 ? Math.round((valid / total) * 1000) / 10 : 100,
        },
      };
    });
    crafts.sort((a, b) => b.totals.valid - a.totals.valid);

    return { days: n, startDate: start, endDate: today, daysList, crafts, generatedAt: new Date().toISOString() };
  }

  /**
   * 管理员数据大屏：报工统计（近 N 天按日/按工序/按报工人汇总良品与废品）。
   * - days：统计天数（7~30，默认 7）
   * - 数据取自 kgd_report_cache.report_time（公版回填时间）；系统报工无工时字段
   *   （working_minutes 全为 0），故用"报工次数"反映每日工作强度
   */
  async getReportStats(days = 7): Promise<ReportStatsResult> {
    const n = Math.min(30, Math.max(7, Number(days) || 7));
    const today = fmtToday();
    const start = this.daysAhead(today, -(n - 1));

    // 一次查询按 工序+报工人+日 聚合，再本地归并出三张视图，避免三趟扫描
    const rows = (await this.reportCache
      .createQueryBuilder('r')
      .select("COALESCE(r.craft_name, '')", 'craftName')
      .addSelect("COALESCE(r.report_user_name, '')", 'userName')
      .addSelect('SUBSTRING(r.report_time, 1, 10)', 'day')
      .addSelect('SUM(CAST(r.valid_num AS DECIMAL(20,2)))', 'valid')
      .addSelect('SUM(CAST(r.waste_num AS DECIMAL(20,2)))', 'waste')
      .addSelect('COUNT(*)', 'cnt')
      .where("r.report_time <> '' AND r.report_time >= :start AND r.report_time < :end", {
        start: `${start} 00:00:00`,
        end: `${this.daysAhead(today, 1)} 00:00:00`,
      })
      .groupBy('r.craft_name')
      .addGroupBy('r.report_user_name')
      .addGroupBy('SUBSTRING(r.report_time, 1, 10)')
      .getRawMany()) as Array<{
      craftName: string;
      userName: string;
      day: string;
      valid: string;
      waste: string;
      cnt: string;
    }>;

    const dayMap = new Map<string, ReportStatsDay>();
    const craftMap = new Map<string, ReportStatsCraft>();
    const userMap = new Map<string, ReportStatsRow>();

    // 报工人 → 产线/分组（users.department_path_names，如 生产部/南线），查不到归 未分组
    const userRows = await this.users.find({ select: { name: true, departmentPathNames: true } });
    const lineOf = new Map<string, string>();
    for (const u of userRows) {
      if (u.name) lineOf.set(u.name, u.departmentPathNames || '');
    }

    for (const r of rows) {
      const valid = Number(r.valid) || 0;
      const waste = Number(r.waste) || 0;
      const cnt = Number(r.cnt) || 0;
      const d = r.day || '';
      if (d) {
        const cur = dayMap.get(d) ?? { date: d, valid: 0, waste: 0, cnt: 0 };
        cur.valid += valid;
        cur.waste += waste;
        cur.cnt += cnt;
        dayMap.set(d, cur);
      }
      const cname = r.craftName || '未知工序';
      const line = lineOf.get(r.userName) || '未分组';
      let c = craftMap.get(cname);
      if (!c) {
        c = { name: cname, valid: 0, waste: 0, cnt: 0, passRate: 100, lines: [] };
        craftMap.set(cname, c);
      }
      c.valid += valid;
      c.waste += waste;
      c.cnt += cnt;
      // 工序下按产线细分
      let ln = c.lines.find((l) => l.line === line);
      if (!ln) {
        ln = { line, valid: 0, waste: 0, cnt: 0, passRate: 100 };
        c.lines.push(ln);
      }
      ln.valid += valid;
      ln.waste += waste;
      ln.cnt += cnt;
      const uname = r.userName || '未署名';
      const u = userMap.get(uname) ?? { name: uname, line: lineOf.get(uname) || '未分组', valid: 0, waste: 0, cnt: 0, passRate: 100 };
      u.valid += valid;
      u.waste += waste;
      u.cnt += cnt;
      userMap.set(uname, u);
    }

    const pass = (v: number, w: number) => (v + w > 0 ? Math.round((v / (v + w)) * 1000) / 10 : 100);

    // 补齐窗口内每一天（无报工的天显示 0）
    const daily: ReportStatsDay[] = [];
    for (let i = 0; i < n; i++) {
      const date = this.daysAhead(start, i);
      daily.push(dayMap.get(date) ?? { date, valid: 0, waste: 0, cnt: 0 });
    }

    const crafts = [...craftMap.values()].map((c) => ({
      ...c,
      passRate: pass(c.valid, c.waste),
      lines: c.lines
        .map((l) => ({ ...l, passRate: pass(l.valid, l.waste) }))
        .sort((a, b) => b.valid - a.valid),
    }));
    crafts.sort((a, b) => b.valid - a.valid);

    const users = [...userMap.values()].map((u) => ({ ...u, passRate: pass(u.valid, u.waste) }));
    users.sort((a, b) => b.valid - a.valid);

    return { days: n, startDate: start, endDate: today, daily, crafts, users, generatedAt: new Date().toISOString() };
  }

  /**
   * 管理员数据大屏：单工序多日报工（某加工单某工序近 N 天每日良品/废品/报工次数）。
   * - days：统计天数（7~30，默认 7）
   * - 数据取自 kgd_report_cache（bill_code + craft_name + report_time）
   */
  async getCraftDaily(billCode: string, craftName: string, days = 7): Promise<CraftDailyResult> {
    const n = Math.min(30, Math.max(7, Number(days) || 7));
    const today = fmtToday();
    const start = this.daysAhead(today, -(n - 1));
    const rows = (await this.reportCache
      .createQueryBuilder('r')
      .select('SUBSTRING(r.report_time, 1, 10)', 'day')
      .addSelect('SUM(CAST(r.valid_num AS DECIMAL(20,2)))', 'valid')
      .addSelect('SUM(CAST(r.waste_num AS DECIMAL(20,2)))', 'waste')
      .addSelect('COUNT(*)', 'cnt')
      .where("r.bill_code = :billCode AND r.craft_name = :craftName AND r.report_time <> '' AND r.report_time >= :start AND r.report_time < :end", {
        billCode,
        craftName,
        start: `${start} 00:00:00`,
        end: `${this.daysAhead(today, 1)} 00:00:00`,
      })
      .groupBy('SUBSTRING(r.report_time, 1, 10)')
      .getRawMany()) as Array<{ day: string; valid: string; waste: string; cnt: string }>;

    const byDay = new Map<string, CraftTrendPoint>();
    for (const r of rows) {
      byDay.set(r.day, {
        date: r.day,
        valid: Number(r.valid) || 0,
        waste: Number(r.waste) || 0,
        cnt: Number(r.cnt) || 0,
      });
    }

    const daysList: string[] = [];
    let valid = 0;
    let waste = 0;
    let cnt = 0;
    const points: CraftTrendPoint[] = [];
    for (let i = 0; i < n; i++) {
      const date = this.daysAhead(start, i);
      daysList.push(date);
      const p = byDay.get(date) ?? { date, valid: 0, waste: 0, cnt: 0 };
      valid += p.valid;
      waste += p.waste;
      cnt += p.cnt;
      points.push(p);
    }
    const total = valid + waste;
    return {
      billCode,
      craftName,
      days: n,
      startDate: start,
      endDate: today,
      daysList,
      points,
      totals: { valid, waste, cnt, passRate: total > 0 ? Math.round((valid / total) * 1000) / 10 : 100 },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 设置/清除任务的自定义目标完成日期（优先于加工单交期，用于日均加工量计算）。
   * - date：YYYY-MM-DD；传空串/null 表示清除（恢复使用加工单交期）
   */
  async setTargetDate(taskId: number, date: string | null): Promise<{ taskId: number; targetDate: string | null }> {
    const task = await this.taskCache.findOneBy({ taskId });
    if (!task) throw new BadRequestException('任务不存在');
    const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    await this.taskCache.update({ taskId }, { targetDate });
    return { taskId, targetDate };
  }

  /** 交期从早到晚比较（无交期排最后） */
  private compareDelivery(a: BillProgressRow, b: BillProgressRow): number {
    const da = a.deliveryDate || '9999-99-99';
    const db = b.deliveryDate || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : a.code.localeCompare(b.code);
  }

  /** 'YYYY-MM-DD' 相对 today 的天数：负数=已过期，null=无法解析 */
  private daysUntil(delivery: string | null | undefined, today: string): number | null {
    const d = (delivery ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  }

  /** 'YYYY-MM-DD' 向后推 n 天 */
  private daysAhead(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 最近报工日速度：日期 Map 中取最近一个有报工日期的件次（当前实际节奏），无报工返回 0 */
  private recentDaySpeed(dayMap: Map<string, number>): number {
    let bestDay = '';
    let best = 0;
    for (const [day, v] of dayMap) {
      if (v > 0 && day > bestDay) {
        bestDay = day;
        best = v;
      }
    }
    return best;
  }
}
