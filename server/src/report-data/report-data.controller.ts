import { Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReportDataService } from './report-data.service';
import { KgdAuthService } from '../kgd/kgd-auth.service';
import { KgdClientService } from '../kgd/kgd-client.service';
import { CraftsService } from '../crafts/crafts.service';
import { ApiKeyGuard } from './api-key.guard';

/**
 * 统一开放接口（日报数据源 + 浏览器扩展 + 快工单 OpenAPI 全量映射共用一套）：
 * - 只读数据（GET 系列）：AstrBot 机器人插件、产品编码管理系统等外部服务消费
 * - 透传写接口（POST 系列）：浏览器扩展、外部系统等调用，由本系统统一登录并透传快工单
 * - 快工单 OpenAPI 全部 28 个业务接口均已在此映射（含仓库管理相关：其他出入库单/成品入库单/供应商/合同/上传附件）
 * 鉴权统一：Header `X-API-Key`（配置项 PLUGIN_API_KEY），无登录环节。
 * 响应统一：成功 { success: true, data }，失败 { success: false, msg }（与快工单 OpenAPI 风格一致）。
 */
@UseGuards(ApiKeyGuard)
@Controller('report-data')
export class ReportDataController {
  constructor(
    private readonly reportData: ReportDataService,
    private readonly kgdAuth: KgdAuthService,
    private readonly kgdClient: KgdClientService,
    private readonly craftsService: CraftsService,
  ) {}

  /** 统一成功/失败包装，与快工单 OpenAPI { success, data } 风格保持一致 */
  private wrap<T>(fn: () => Promise<T>): Promise<{ success: boolean; data?: T; msg?: string }> {
    return fn()
      .then((data) => ({ success: true, data }))
      .catch((e) => ({ success: false, msg: (e as Error).message }));
  }

  /** 指定日期报工明细（created_at 归属，等价插件 fetch_day_reports） */
  @Get('day-reports')
  dayReports(@Query('day') day: string) {
    return this.wrap(() => this.reportData.getDayReports(day));
  }

  /** 按状态查任务列表，status 支持逗号分隔多值（1=未开始 2=进行中） */
  @Get('tasks')
  tasks(@Query('status') status?: string) {
    const statuses = (status ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return this.wrap(() =>
      Promise.all(statuses.map((s) => this.reportData.getTasks(s))).then((parts) => parts.flat()),
    );
  }

  /** 按加工单号+工序查合并任务详情（等价插件 fetch_task） */
  @Get('task')
  task(@Query('code') code: string, @Query('craft') craft: string) {
    return this.wrap(() =>
      this.reportData.getTask(decodeURIComponent(code ?? ''), decodeURIComponent(craft ?? '')),
    );
  }

  /** 用户列表（含部门路径，供插件建立南/北线索引） */
  @Get('users')
  users() {
    return this.wrap(() => this.reportData.getUsers());
  }

  /** 加工单交期映射 {code: YYYY-MM-DD}（读本地缓存，查询前先即时同步） */
  @Get('bills')
  bills(@Query('codes') codes?: string) {
    return this.wrap(() =>
      this.reportData.getDeliveryDates((codes ?? '').split(',').map((c) => c.trim())),
    );
  }

  /**
   * 加工单列表 + 状态 + 工序进度链（读本地缓存，查询前先即时同步）。
   * 插件据此渲染「加工单进行状态」：未开始 -> 未编程；已开始 -> 逐工序进度。
   */
  @Get('bill-status')
  billStatus() {
    return this.wrap(() => this.reportData.getBillStatus());
  }

  /**
   * 商品列表（读本地缓存 kgd_goods_cache，查询前后台触发即时同步（30 秒节流），缓存为空时实时拉取兜底）。
   * 筛选参数：
   * - keyword：商品名/编号/规格模糊查询
   * - updatedAtStart / updatedAtEnd：更新时间窗口（`YYYY-MM-DD HH:mm:ss`）
   * - supplierName：供应商名称/简拼；createUserName：创建人名称/简拼
   * - categoryName：商品分类名称
   * - source：商品来源（1=自产 2=外协加工 3=外购）
   * - isEnable：是否启用（1=启用 2=未启用）
   * 注：扩展需要的「快工单原样透传」见 POST /goods/list。
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
    return this.wrap(() =>
      this.reportData.getGoods(
        keyword,
        updatedAtStart,
        updatedAtEnd,
        supplierName,
        createUserName,
        categoryName,
        source,
        isEnable,
      ),
    );
  }

  /**
   * 商品库存（读本地缓存，查询前后台刷新）。
   * 数据源为公版 Web /api/goods_stock/list（OpenAPI 无库存接口）；一条记录 = 商品×仓库。
   * 筛选参数：
   * - keyword：商品名/编号/规格模糊查询
   * - wareName：仓库名称模糊查询
   * - source：商品来源（1=自产 2=外协加工 3=外购）
   * - isEnable：是否启用（1=启用 2=未启用）
   */
  @Get('goods-stock')
  goodsStock(
    @Query('keyword') keyword?: string,
    @Query('wareName') wareName?: string,
    @Query('source') source?: string,
    @Query('isEnable') isEnable?: string,
  ) {
    return this.wrap(() => this.reportData.getGoodsStock(keyword, wareName, source, isEnable));
  }

  /**
   * 不良品项字典（code 编号 / name 名称）。
   * 数据源：公版 Web /api/waste_item/list → 本地 kgd_waste_item 表缓存（内存 5 分钟 + 数据库 24h），
   * 公版不可用时降级返回本地缓存。报工提交不良品时 waste_item_code 需传编号。
   */
  @Get('waste-items')
  wasteItems() {
    return this.wrap(() => this.craftsService.getWasteItems());
  }

  /**
   * 编辑加工单（透传快工单 /open_api/produce_bill/edit）。
   * Body 必填：id(integer)、num(string)、craft_list(array)，其余字段见快工单开放接口文档。
   * 返回 { id, code }（快工单侧编辑成功后的加工单信息）。
   */
  @Post('bill')
  editBill(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.editBill(body));
  }

  // ===== 工序 =====

  /**
   * 工序列表（透传 /open_api/pub_craft/list）。
   * 支持 pageNo/pageSize/name 等过滤参数。
   */
  @Get('crafts')
  crafts(@Query() query: Record<string, unknown>) {
    return this.wrap(() => this.reportData.getCrafts(query));
  }

  /** 工序新增（透传 /open_api/pub_craft/add，必填 name） */
  @Post('crafts/add')
  addCraft(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.addCraft(body));
  }

  /** 工序编辑（透传 /open_api/pub_craft/edit，必填 id） */
  @Post('crafts/edit')
  editCraft(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.editCraft(body));
  }

  // ===== 商品（新增/编辑，列表见上方 GET /goods） =====

  /** 商品新增（透传 /open_api/goods/add，必填 name） */
  @Post('goods/add')
  addGoods(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.addGoods(body));
  }

  /** 商品编辑（透传 /open_api/goods/edit，必填 id+name） */
  @Post('goods/edit')
  editGoods(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.editGoods(body));
  }

  // ===== 加工单（列表/新增/状态，编辑见上方 POST /bill） =====

  /**
   * 加工单列表（实时拉取 /open_api/produce_bill/list）。
   * 支持 code/goods_keyword/keyword/status/create_user_name/时间窗口等过滤。
   * 返回 { list, count }。
   */
  @Get('produce-bills')
  produceBills(@Query() query: Record<string, unknown>) {
    return this.wrap(() => this.reportData.getProduceBills(query));
  }

  /** 加工单新增（透传 /open_api/produce_bill/add，必填 goods_id+num） */
  @Post('produce-bills/add')
  addProduceBill(@Body() body: Record<string, unknown>) {
    return this.wrap(() => this.reportData.addProduceBill(body));
  }

  /**
   * 加工单状态修改（透传 /open_api/produce_bill/edit_status）。
   * Body：id(必填)、type(1=开始 2=撤回 3=完成 4=取消)、cancelReason(取消时可选)。
   */
  @Post('produce-bills/status')
  changeProduceBillStatus(@Body() body: { id: number; type: 1 | 2 | 3 | 4; cancelReason?: string }) {
    return this.wrap(() => this.reportData.changeProduceBillStatus(body));
  }

  /**
   * 加工单工序顺序（按真实工艺顺序排列，来源：公版 Web 接口 order_number 校准；读本地缓存，查询前先即时同步）。
   * `code` 为加工单号，支持逗号分隔多个；返回 [{ code, crafts: [{ taskId, craftName, order, status, statusName, ... }] }]。
   */
  @Get('craft-orders')
  craftOrders(@Query('code') code?: string) {
    return this.wrap(() => this.reportData.getCraftOrders((code ?? '').split(',')));
  }

  // ===== 生产任务（列表见上方 GET /tasks、/task） =====

  /**
   * 生产任务状态修改（透传 /open_api/produce_bill_craft/edit_status）。
   * Body：id(必填)、status(1=未开始 2=进行中 3=已完成 4=暂停)。
   */
  @Post('tasks/status')
  changeTaskStatus(@Body() body: { id: number; status: 1 | 2 | 3 | 4 }) {
    return this.wrap(() => this.reportData.changeTaskStatus(body));
  }

  // ===== 浏览器扩展（快工单合同导入建单）透传 =====

  /** 系统快工单账号信息（扩展连接测试展示：id/name/real_name/team 等） */
  @Get('user/info')
  userInfo() {
    return this.wrap(() =>
      this.kgdAuth.ensureSessionInfo().then((info) => {
        if (!info) throw new Error('系统快工单账号信息未就绪，请稍后重试');
        return info;
      }),
    );
  }

  /** 客户列表（透传 /open_api/customer/list，Body 支持 keyword/is_enable 等过滤，返回快工单原样数据） */
  @Post('customer/list')
  customerList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.reportData.listCustomers(body)).data);
  }

  /** 商品列表（透传 /open_api/goods/list，Body 支持 goods_keyword/pageNo/pageSize 等，返回快工单原样数据） */
  @Post('goods/list')
  goodsList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.reportData.listGoods(body)).data);
  }

  /** 创建合同（透传 /open_api/customer_contract/add，Body 为合同完整字段，返回快工单原样数据） */
  @Post('customer_contract/add')
  customerContractAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.reportData.addContract(body)).data);
  }

  // ===== 快工单 OpenAPI 全量映射（剩余接口透传） =====
  // 以下全部为「系统统一登录 + 原样透传快工单」，返回数组（快工单 data 字段）。

  /** 报工记录列表（透传 /open_api/report_work_record/list，Body 支持 pageNo/pageSize/时间窗口/加工单号过滤） */
  @Post('reports/list')
  reportList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listReportRecords(body)).data);
  }

  /** 新增报工记录（透传 /open_api/report_work_record/add，Body 为报工完整字段） */
  @Post('reports/add')
  reportAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addReportWorkRecord(body)).data);
  }

  /** 编辑报工记录（透传 /open_api/report_work_record/edit，仅可修改自己的未质检/未结算记录） */
  @Post('reports/edit')
  reportEdit(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.editReportWorkRecord(body)).data);
  }

  /** 用户列表（透传 /open_api/user/list 原样数据，Body 支持 keyword/pageNo/pageSize） */
  @Post('user/list')
  userList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listUsers(body)).data);
  }

  /** 客户新增（透传 /open_api/customer/add，Body 必填 name） */
  @Post('customer/add')
  customerAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addCustomer(body)).data);
  }

  /** 供应商列表（透传 /open_api/supplier/list，Body 支持 keyword/phone/pageNo/pageSize 等） */
  @Post('supplier/list')
  supplierList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listSuppliers(body)).data);
  }

  /** 供应商新增（透传 /open_api/supplier/add，Body 必填 name） */
  @Post('supplier/add')
  supplierAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addSupplier(body)).data);
  }

  /** 其他出库单列表（透传 /open_api/else_stock_out_bill/list，Body 支持时间窗口等过滤） */
  @Post('else-stock-out/list')
  elseStockOutList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listElseStockOutBills(body)).data);
  }

  /** 其他出库单新增（透传 /open_api/else_stock_out_bill/add，Body 为出库单完整字段） */
  @Post('else-stock-out/add')
  elseStockOutAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addElseStockOutBill(body)).data);
  }

  /** 其他入库单列表（透传 /open_api/else_stock_in_bill/list，Body 支持时间窗口等过滤） */
  @Post('else-stock-in/list')
  elseStockInList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listElseStockInBills(body)).data);
  }

  /** 其他入库单新增（透传 /open_api/else_stock_in_bill/add，Body 为入库单完整字段） */
  @Post('else-stock-in/add')
  elseStockInAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addElseStockInBill(body)).data);
  }

  /** 成品入库单列表（透传 /open_api/produce_stock_in_bill/list，Body 支持时间窗口等过滤） */
  @Post('produce-stock-in/list')
  produceStockInList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listProduceStockInBills(body)).data);
  }

  /** 成品入库单新增（透传 /open_api/produce_stock_in_bill/add，Body 为入库单完整字段） */
  @Post('produce-stock-in/add')
  produceStockInAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addProduceStockInBill(body)).data);
  }

  /** 合同列表（透传 /open_api/customer_contract/list，Body 支持 code/goods_keyword/时间窗口等过滤） */
  @Post('contract/list')
  contractList(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.listContracts(body)).data);
  }

  /** 合同新增（透传 /open_api/customer_contract/add，Body 为合同完整字段） */
  @Post('contract/add')
  contractAdd(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.addContract(body)).data);
  }

  /** 合同修改（透传 /open_api/customer_contract/edit，Body 必填 id + 待修改字段） */
  @Post('contract/edit')
  contractEdit(@Body() body: Record<string, unknown>) {
    return this.wrap(async () => (await this.kgdClient.editContract(body)).data);
  }

  /**
   * 上传附件（multipart/form-data，字段名 file；透传 /open_api/upload/file）。
   * 返回 { original_name, url, file_size }，url 可用于其他接口的附件类型字段写入。
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    return this.wrap(async () => {
      if (!file) throw new Error('缺少上传文件（multipart 字段名应为 file）');
      return this.kgdClient.uploadFile(file.buffer, file.originalname);
    });
  }
}
