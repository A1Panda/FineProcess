import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ReportService } from './report.service';
import type { EditReportWorkDto, ReportWorkDto } from './report.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@UseGuards(JwtAuthGuard)
@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /** 报工 */
  @Post()
  reportWork(@CurrentUser() user: JwtPayload, @Body() dto: ReportWorkDto) {
    return this.reportService.reportWork(user, dto);
  }

  /** 我的报工记录 */
  @Get()
  myReports(@CurrentUser() user: JwtPayload) {
    return this.reportService.getMyReports(user);
  }

  /** 修改报工记录（仅限修改自己的报工） */
  @Put(':id')
  editReport(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: EditReportWorkDto) {
    return this.reportService.editReport(user, { ...dto, id: Number(id) });
  }

  /** 删除报工记录（仅限删除自己的报工） */
  @Delete(':id')
  deleteReport(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('billCode') billCode: string,
  ) {
    return this.reportService.deleteReport(user, Number(id), billCode);
  }

  /** 按加工单编号查报工记录 */
  @Get('bill/:code')
  reportsByBillCode(@Param('code') code: string) {
    return this.reportService.getReportsByBillCode(decodeURIComponent(code));
  }
}
