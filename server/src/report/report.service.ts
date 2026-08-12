import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdSyncService } from '../kgd/kgd-sync.service';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdReportCache } from './kgd-report-cache.entity';
import { JwtPayload } from '../auth/auth.service';

export interface ReportWorkDto {
  /** 生产任务ID */
  produceCraftId: number;
  /** 良品数 */
  validNum: number;
  /** 不良品数 */
  wasteNum: number;
  /** 是否完成任务 */
  isFinish: boolean;
  /** 备注 */
  remark?: string;
  /** 报工时长（分钟） */
  workingMinutes?: number;
  /** 报工人快工单用户ID（默认当前登录用户；代报工时指定） */
  reportUserId?: number;
  /** 报工人姓名（代报工时指定，用于本地记录） */
  reportUserName?: string;
  /** 开始时间 YYYY-MM-DD HH:mm */
  startTime?: string;
  /** 结束时间 YYYY-MM-DD HH:mm */
  endTime?: string;
  /** 不良品项 */
  wasteItems?: { wasteItemCode: string; num: number }[];
  /** 溯源码，多个以逗号连接 */
  traceabilityCodes?: string;
}

export interface EditReportWorkDto {
  /** 报工记录ID */
  id: number;
  /** 加工单编号（用于服务端归属校验与缓存重算） */
  billCode: string;
  /** 良品数 */
  validNum: number;
  /** 不良品数 */
  wasteNum: number;
  /** 备注 */
  remark?: string;
  /** 报工时长（分钟） */
  workingMinutes?: number;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly kgdClient: KgdClientService,
    private readonly sync: KgdSyncService,
    @InjectRepository(KgdTaskCache) private readonly taskCache: Repository<KgdTaskCache>,
    @InjectRepository(KgdReportCache) private readonly reportCache: Repository<KgdReportCache>,
  ) {}

  /** 报工：真实调用快工单，记录落本地 */
  async reportWork(user: JwtPayload, dto: ReportWorkDto) {
    // 报工人：默认当前登录用户，可代报指定
    const uid = dto.reportUserId ?? user.kgdUserId;
    const uname = dto.reportUserName ?? user.name;
    const payload: Record<string, unknown> = {
      produce_craft_id: dto.produceCraftId,
      report_user_id: String(uid),
      valid_num: String(dto.validNum),
      waste_num: String(dto.wasteNum),
      is_finish: dto.isFinish ? 1 : 2,
    };
    if (dto.remark) payload.remark = dto.remark;
    if (dto.workingMinutes !== undefined) payload.working_minutes = dto.workingMinutes;
    if (dto.startTime) payload.start_time = dto.startTime;
    if (dto.endTime) payload.end_time = dto.endTime;
    if (dto.wasteItems?.length) payload.report_waste_array = dto.wasteItems;
    if (dto.traceabilityCodes) payload.traceability_codes = dto.traceabilityCodes;

    const result = await this.kgdClient.addReportWorkRecord(payload);
    // 记录本地报工时间（快工单报工接口不返回创建时间，用于弹窗展示）
    await this.recordLocalReport({ kgdUserId: uid, name: uname } as JwtPayload, dto, result.data);
    // 报工成功后直接更新本地缓存，前端 reload 立即看到最新良品/不良品数（无需等同步）
    await this.updateTaskCacheAfterReport(dto);
    // 后台同步，用快工单真实数据校准缓存
    this.sync.requestSync();
    return {
      success: true,
      data: result.data,
      reportedAt: new Date().toISOString(),
    };
  }

  /** 修改报工记录：先校验归属（只能改自己的），再调用快工单并重算本地缓存 */
  async editReport(user: JwtPayload, dto: EditReportWorkDto) {
    // 服务端校验：该记录必须存在且属于当前登录用户
    const { data } = await this.kgdClient.listReportRecords({
      pageNo: 1,
      pageSize: 500,
      produce_bill_code: dto.billCode,
    });
    const rec = (data ?? []).find((r) => String(r.id) === String(dto.id));
    if (!rec) {
      throw new BadRequestException('报工记录不存在');
    }
    if (String(rec.report_user_id) !== String(user.kgdUserId)) {
      throw new ForbiddenException('只能修改自己的报工记录');
    }

    const payload: Record<string, unknown> = {
      id: dto.id,
      report_user_id: String(user.kgdUserId),
      valid_num: String(dto.validNum),
      waste_num: String(dto.wasteNum),
    };
    if (dto.remark) payload.remark = dto.remark;
    if (dto.workingMinutes !== undefined) payload.working_minutes = dto.workingMinutes;

    const result = await this.kgdClient.editReportWorkRecord(payload);
    // 同步更新本地记录（保留原始报工时间，仅刷新数量/工时/备注）
    await this.reportCache.update(
      { reportId: Number(dto.id) },
      {
        validNum: String(dto.validNum),
        wasteNum: String(dto.wasteNum),
        workingMinutes: dto.workingMinutes ?? 0,
        remark: dto.remark ?? null,
      },
    );
    // 按加工单重新汇总报工记录，立即刷新本地任务缓存（无需等同步）
    await this.recalcBillCache(dto.billCode);
    // 后台同步，用快工单真实数据最终校准
    this.sync.requestSync();
    return {
      success: true,
      data: result.data,
      updatedAt: new Date().toISOString(),
    };
  }

  /** 按加工单重新汇总各工序报工数，覆盖本地任务缓存 */
  private async recalcBillCache(billCode: string) {
    const { data } = await this.kgdClient.listReportRecords({
      pageNo: 1,
      pageSize: 500,
      produce_bill_code: billCode,
    });
    const recs = data ?? [];
    const tasks = await this.taskCache.findBy({ billCode });
    for (const task of tasks) {
      let valid = 0;
      let waste = 0;
      for (const r of recs) {
        if ((r.pub_craft?.name ?? '') === task.craftName) {
          valid += Number(r.valid_num) || 0;
          waste += Number(r.waste_num) || 0;
        }
      }
      task.validNum = String(valid);
      task.wasteNum = String(waste);
    }
    if (tasks.length) await this.taskCache.save(tasks);
  }

  /** 本地缓存立即累加本次报工数量；勾选完工时任务标记为已完成 */
  private async updateTaskCacheAfterReport(dto: ReportWorkDto) {
    const task = await this.taskCache.findOneBy({ taskId: dto.produceCraftId });
    if (!task) return;
    const valid = Math.max(0, Number(dto.validNum) || 0);
    const waste = Math.max(0, Number(dto.wasteNum) || 0);
    task.validNum = String((Number(task.validNum) || 0) + valid);
    task.wasteNum = String((Number(task.wasteNum) || 0) + waste);
    if (dto.isFinish) {
      task.status = 3;
      task.statusName = '已完成';
    }
    await this.taskCache.save(task);
  }

  /** 当前工人的报工记录 */
  getMyReports(user: JwtPayload) {
    return this.kgdClient.listReportRecords({ pageNo: 1, pageSize: 100, report_user_id: user.kgdUserId });
  }

  /** 按加工单编号查报工记录（读本地缓存：后台每 5 分钟同步 + 报工/修改后即时刷新） */
  async getReportsByBillCode(code: string) {
    let rows = await this.reportCache.find({
      where: { billCode: code },
      order: { reportId: 'DESC' },
    });
    // 兜底：本地尚无该单缓存时即时拉取一次写入本地，之后均走缓存
    if (!rows.length) {
      const { data } = await this.kgdClient.listReportRecords({
        pageNo: 1,
        pageSize: 200,
        produce_bill_code: code,
      });
      if (data?.length) {
        await this.reportCache.upsert(this.mapReportRows(data), ['reportId']);
        rows = await this.reportCache.find({
          where: { billCode: code },
          order: { reportId: 'DESC' },
        });
      }
    }
    const list = rows.map((r) => ({
      id: Number(r.reportId ?? 0),
      reportUser: r.reportUserName,
      reportUserId: r.reportUserId,
      craftName: r.craftName,
      unitName: r.unitName,
      planNum: r.planNum,
      validNum: r.validNum,
      wasteNum: r.wasteNum,
      workingMinutes: r.workingMinutes,
      validMoney: r.validMoney,
      priceModeName: r.priceModeName,
      remark: r.remark ?? '',
      reportTime: r.reportTime,
    }));
    return { code, list, total: list.length };
  }

  /** 快工单报工记录 → 本地缓存行（不含 reportTime，避免覆盖本地报工时间） */
  private mapReportRows(data: Record<string, any>[]): Partial<KgdReportCache>[] {
    return data.map((r) => ({
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
  }

  /** 报工成功后记录本地报工时间：优先取 add 接口直接返回的ID，否则按任务+用户反查最新一条 */
  private async recordLocalReport(user: JwtPayload, dto: ReportWorkDto, addData: unknown) {
    const task = await this.taskCache.findOneBy({ taskId: dto.produceCraftId });
    if (!task) return;
    const directId =
      (addData as any)?.id ?? (Array.isArray(addData) ? (addData[0]?.id ?? null) : null);
    const reportId = directId
      ? Number(directId)
      : await this.findLatestReportId(dto.produceCraftId, user.kgdUserId, dto);
    await this.reportCache.save(
      this.reportCache.create({
        reportId,
        billCode: task.billCode,
        craftName: task.craftName,
        reportUserId: String(user.kgdUserId),
        reportUserName: user.name ?? '',
        validNum: String(dto.validNum),
        wasteNum: String(dto.wasteNum),
        workingMinutes: dto.workingMinutes ?? 0,
        reportTime: this.formatTime(new Date()),
        remark: dto.remark ?? null,
      }),
    );
  }

  /** 反查刚创建的报工记录ID（同任务同用户、数量匹配且 id 最大） */
  private async findLatestReportId(
    craftId: number,
    userId: number | string,
    dto: ReportWorkDto,
  ): Promise<number | null> {
    try {
      const { data } = await this.kgdClient.listReportRecords({
        pageNo: 1,
        pageSize: 10,
        produce_bill_craft_id: craftId,
        report_user_id: userId,
      });
      const hit = (data ?? [])
        .filter(
          (r: Record<string, any>) =>
            String(r.valid_num) === String(dto.validNum) &&
            String(r.waste_num) === String(dto.wasteNum),
        )
        .sort((a: Record<string, any>, b: Record<string, any>) => Number(b.id) - Number(a.id))[0];
      return hit ? Number(hit.id) : null;
    } catch {
      return null;
    }
  }

  /** 格式化本地时间为 YYYY-MM-DD HH:mm:ss */
  private formatTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}
