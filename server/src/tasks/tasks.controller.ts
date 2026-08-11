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

  /** 手动触发一次数据同步（刷新按钮调用），等待完成后返回耗时 */
  @Post('sync')
  syncNow() {
    return this.tasks.syncNow();
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
}
