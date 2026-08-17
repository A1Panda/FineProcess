import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** 当前工人任务列表；all=true 返回该工序全部任务（工序操作页）；支持 page/pageSize 分页、keyword 模糊搜索（HT图号/产品名） */
  @Get('mine')
  getMyTasks(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('craftName') craftName?: string,
    @Query('keyword') keyword?: string,
    @Query('all') all?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasks.getMyTasks(
      user,
      {
        // status 支持逗号分隔的多值过滤（如 1,2 = 未开始+进行中）
        status:
          status !== undefined
            ? status
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isInteger(n) && n > 0)
            : undefined,
        craftName,
        keyword,
      },
      all === 'true',
      page !== undefined ? Number(page) : 1,
      pageSize !== undefined ? Number(pageSize) : 20,
    );
  }

  /** 首页统计：各状态数量 / 各工序未完成数量 / 编程未开始加工单数 */
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.tasks.getSummary(user);
  }

  /** 手动触发一次数据同步（刷新按钮调用），等待完成后返回耗时。
   *  ?full=1 时强制全量同步（长按刷新）；
   *  ?days=N 时报工记录额外覆盖最近 N 天窗口（短按刷新默认 days=3，完善近期被修改/漏同步的报工） */
  @Post('sync')
  syncNow(@Query('full') full?: string, @Query('days') days?: string) {
    const reportWindowDays = days !== undefined ? Math.max(0, Number(days) || 0) : 0;
    return this.tasks.syncNow(full === '1' || full === 'true', reportWindowDays);
  }

  /** 从公版 Web 系统回填报工时间（OpenAPI 报工记录无时间戳，本地纯同步记录以此补齐报工时间） */
  @Post('sync-web-report-times')
  syncWebReportTimes() {
    return this.tasks.syncWebReportTimes();
  }

  /** 开工 */
  @Post(':id/start')
  start(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.start(id);
  }

  /** 暂停 */
  @Post(':id/pause')
  pause(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.pause(id);
  }

  /** 完工 */
  @Post(':id/finish')
  finish(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.finish(id);
  }

  /** 设置/清除任务的自定义目标完成日期（优先于加工单交期，用于日均加工量计算）。
   *  body: { date?: 'YYYY-MM-DD' }，date 传空/缺省表示清除 */
  @Post(':id/target-date')
  setTargetDate(@Param('id', ParseIntPipe) id: number, @Body() body: { date?: string }) {
    return this.tasks.setTargetDate(id, body?.date ?? null);
  }

  /** 编程工序专用：按加工单编号修改加工单状态为"开始" */
  @Post('produce-bill/:code/start')
  startProduceBill(@Param('code') code: string) {
    return this.tasks.startProduceBillByCode(code);
  }

  /** 编程工序专用：按加工单编号取消加工单 */
  @Post('produce-bill/:code/cancel')
  cancelProduceBill(@Param('code') code: string) {
    return this.tasks.cancelProduceBillByCode(code);
  }

  /** 编程工序专用：拉取未开始的加工单（从 produce_bill/list 查 status=1） */
  @Get('unstarted-bills')
  getUnstartedBills() {
    return this.tasks.getUnstartedBills();
  }

  /** 编程工序专用：拉取加工单状态为"进行中"的加工单（status=2） */
  @Get('in-progress-bills')
  getInProgressBills() {
    return this.tasks.getInProgressBills();
  }

  /** 管理员数据大屏：完工预测（进行中加工单近 7 天报工历史 + 按日均产量估算完成日期）。
   *  参数：keyword（单号/HT图号/产品名）、page/pageSize */
  @Get('bill-forecast')
  getBillForecast(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasks.getBillForecast({
      keyword,
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 20,
    });
  }

  /** 管理员数据大屏：工序产出趋势（近 N 天各工序每日良品/废品/报工次数）。
   *  参数：days（7~30，默认 7）、crafts（工序过滤，逗号分隔，缺省=全部） */
  @Get('craft-trend')
  getCraftTrend(@Query('days') days?: string, @Query('crafts') crafts?: string) {
    return this.tasks.getCraftTrend(
      days !== undefined ? Number(days) : 7,
      crafts ? crafts.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    );
  }

  /** 管理员数据大屏：报工统计（近 N 天按日/按工序/按报工人汇总良品与废品）。
   *  参数：days（7~30，默认 7） */
  @Get('report-stats')
  getReportStats(@Query('days') days?: string) {
    return this.tasks.getReportStats(days !== undefined ? Number(days) : 7);
  }

  /** 管理员数据大屏：报工记录明细（按报工时间倒序）。
   *  参数：limit（条数，默认 500，最多 1000）、today（true=只取今日全部） */
  @Get('recent-reports')
  getRecentReports(@Query('limit') limit?: string, @Query('today') today?: string) {
    return this.tasks.getRecentReports(
      limit !== undefined ? Number(limit) : 500,
      today === '1' || today === 'true',
    );
  }

  /** 管理员数据大屏：单工序多日报工（某加工单某工序近 N 天每日良品/废品/报工次数）。
   *  参数：billCode、craftName（必填）、days（7~30，默认 7） */
  @Get('craft-daily')
  getCraftDaily(
    @Query('billCode') billCode?: string,
    @Query('craftName') craftName?: string,
    @Query('days') days?: string,
  ) {
    return this.tasks.getCraftDaily(
      billCode ?? '',
      craftName ?? '',
      days !== undefined ? Number(days) : 7,
    );
  }

  /** 管理员数据大屏：加工单进度列表（全量 + 每单工序进度 + 逾期/临期标记）。
   *  参数：status 多值（逗号分隔）、keyword、sortBy（delivery/progress/remaining）、overdue、dueSoon、
   *        scope（done-today=今日已完成）、page/pageSize */
  @Get('bill-progress')
  getBillProgress(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('sortBy') sortBy?: string,
    @Query('overdue') overdue?: string,
    @Query('dueSoon') dueSoon?: string,
    @Query('scope') scope?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasks.getBillProgress({
      status:
        status !== undefined
          ? status
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isInteger(n) && n > 0)
          : undefined,
      keyword,
      sortBy,
      overdueOnly: overdue === 'true',
      dueSoonOnly: dueSoon === 'true',
      scope: scope === 'done-today' ? scope : undefined,
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 20,
    });
  }
}
