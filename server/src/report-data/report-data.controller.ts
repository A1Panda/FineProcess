import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  /**
   * 加工单列表 + 状态 + 工序进度链（读本地缓存，查询前先即时同步）。
   * 插件据此渲染「加工单进行状态」：未开始 -> 未编程；已开始 -> 逐工序进度。
   */
  @Get('bill-status')
  billStatus() {
    return this.reportData.getBillStatus();
  }

  /**
   * 商品列表（实时拉取快工单 /open_api/goods/list）。
   * 筛选参数：
   * - keyword：商品名/编号/规格模糊查询
   * - updatedAtStart / updatedAtEnd：更新时间窗口（`YYYY-MM-DD HH:mm:ss`）
   * - supplierName：供应商名称/简拼；createUserName：创建人名称/简拼
   * - categoryName：商品分类名称
   * - source：商品来源（1=自产 2=外协加工 3=外购）
   * - isEnable：是否启用（1=启用 2=未启用）
   */
  @Get('goods')
  goods(
    @Query('keyword') keyword?: string,
    @Query('updatedAtStart') updatedAtStart?: string,
    @Query('updatedAtEnd') updatedAtEnd?: string,
    @Query('supplierName') supplierName?: string,
    @Query('createUserName') createUserName?: string,
    @Query('categoryName') categoryName?: string,
    @Query('source') source?: string,
    @Query('isEnable') isEnable?: string,
  ) {
    return this.reportData.getGoods(
      keyword,
      updatedAtStart,
      updatedAtEnd,
      supplierName,
      createUserName,
      categoryName,
      source,
      isEnable,
    );
  }

  /**
   * 编辑加工单（透传快工单 /open_api/produce_bill/edit）。
   * Body 必填：id(integer)、num(string)、craft_list(array)，其余字段见快工单开放接口文档。
   * 返回 { id, code }（快工单侧编辑成功后的加工单信息）。
   */
  @Post('bill')
  editBill(@Body() body: Record<string, unknown>) {
    return this.reportData.editBill(body);
  }

  // ===== 工序 =====

  /**
   * 工序列表（透传 /open_api/pub_craft/list）。
   * 支持 pageNo/pageSize/name 等过滤参数。
   */
  @Get('crafts')
  crafts(@Query() query: Record<string, unknown>) {
    return this.reportData.getCrafts(query);
  }

  /** 工序新增（透传 /open_api/pub_craft/add，必填 name） */
  @Post('crafts/add')
  addCraft(@Body() body: Record<string, unknown>) {
    return this.reportData.addCraft(body);
  }

  /** 工序编辑（透传 /open_api/pub_craft/edit，必填 id） */
  @Post('crafts/edit')
  editCraft(@Body() body: Record<string, unknown>) {
    return this.reportData.editCraft(body);
  }

  // ===== 商品（新增/编辑，列表见上方 GET /goods） =====

  /** 商品新增（透传 /open_api/goods/add，必填 name） */
  @Post('goods/add')
  addGoods(@Body() body: Record<string, unknown>) {
    return this.reportData.addGoods(body);
  }

  /** 商品编辑（透传 /open_api/goods/edit，必填 id+name） */
  @Post('goods/edit')
  editGoods(@Body() body: Record<string, unknown>) {
    return this.reportData.editGoods(body);
  }

  // ===== 加工单（列表/新增/状态，编辑见上方 POST /bill） =====

  /**
   * 加工单列表（实时拉取 /open_api/produce_bill/list）。
   * 支持 code/goods_keyword/keyword/status/create_user_name/时间窗口等过滤。
   * 返回 { list, count }。
   */
  @Get('produce-bills')
  produceBills(@Query() query: Record<string, unknown>) {
    return this.reportData.getProduceBills(query);
  }

  /** 加工单新增（透传 /open_api/produce_bill/add，必填 goods_id+num） */
  @Post('produce-bills/add')
  addProduceBill(@Body() body: Record<string, unknown>) {
    return this.reportData.addProduceBill(body);
  }

  /**
   * 加工单状态修改（透传 /open_api/produce_bill/edit_status）。
   * Body：id(必填)、type(1=开始 2=撤回 3=完成 4=取消)、cancelReason(取消时可选)。
   */
  @Post('produce-bills/status')
  changeProduceBillStatus(@Body() body: { id: number; type: 1 | 2 | 3 | 4; cancelReason?: string }) {
    return this.reportData.changeProduceBillStatus(body);
  }

  // ===== 生产任务（列表见上方 GET /tasks、/task） =====

  /**
   * 生产任务状态修改（透传 /open_api/produce_bill_craft/edit_status）。
   * Body：id(必填)、status(1=未开始 2=进行中 3=已完成 4=暂停)。
   */
  @Post('tasks/status')
  changeTaskStatus(@Body() body: { id: number; status: 1 | 2 | 3 | 4 }) {
    return this.reportData.changeTaskStatus(body);
  }
}
