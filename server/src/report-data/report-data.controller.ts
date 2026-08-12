import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportDataService } from './report-data.service';
import { ApiKeyGuard } from './api-key.guard';

/**
 * 日报数据源接口：供 AstrBot 机器人插件等外部服务调用。
 * 鉴权：Header `X-API-Key`（配置项 PLUGIN_API_KEY）。
 */
@UseGuards(ApiKeyGuard)
@Controller('report-data')
export class ReportDataController {
  constructor(private readonly reportData: ReportDataService) {}

  /** 指定日期报工明细（created_at 归属，等价插件 fetch_day_reports） */
  @Get('day-reports')
  dayReports(@Query('day') day: string) {
    return this.reportData.getDayReports(day);
  }

  /** 按状态查任务列表，status 支持逗号分隔多值（1=未开始 2=进行中） */
  @Get('tasks')
  tasks(@Query('status') status?: string) {
    const statuses = (status ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return Promise.all(statuses.map((s) => this.reportData.getTasks(s))).then((parts) => parts.flat());
  }

  /** 按加工单号+工序查合并任务详情（等价插件 fetch_task） */
  @Get('task')
  task(@Query('code') code: string, @Query('craft') craft: string) {
    return this.reportData.getTask(decodeURIComponent(code ?? ''), decodeURIComponent(craft ?? ''));
  }

  /** 用户列表（含部门路径，供插件建立南/北线索引） */
  @Get('users')
  users() {
    return this.reportData.getUsers();
  }

  /** 加工单交期映射 {code: YYYY-MM-DD}（读本地缓存，查询前先即时同步） */
  @Get('bills')
  bills(@Query('codes') codes?: string) {
    return this.reportData.getDeliveryDates((codes ?? '').split(',').map((c) => c.trim()));
  }
}
