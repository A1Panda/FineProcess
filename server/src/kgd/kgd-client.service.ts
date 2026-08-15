import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { KgdAuthService } from './kgd-auth.service';
import { KgdToken } from './kgd-token.entity';

/** 快工单公版 Web 接口请求签名固定盐（前端 bundle 中提取） */
const WEB_SIGN_SALT = '81ad0be7fd53914f8cf8193c1886f635';
const WEB_CHANNEL = 1; // 公版 WEB 端 channel

/** 格式化为 'YYYY-MM-DD HH:mm:ss'（公版接口 created_at 窗口过滤格式） */
function fmtDateTimeWeb(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 快工单 OpenAPI 统一封装：自动注入 X-TOKEN，集中处理返回结构 */
@Injectable()
export class KgdClientService {
  private readonly logger = new Logger(KgdClientService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: KgdAuthService,
    @InjectRepository(KgdToken) private readonly tokens: Repository<KgdToken>,
  ) {
    const baseUrl = this.config.get<string>('kgd.baseUrl');
    this.http = axios.create({ baseURL: baseUrl, timeout: 30_000 });
    this.http.interceptors.request.use((cfg) => {
      cfg.headers = cfg.headers ?? {};
      cfg.headers['X-TOKEN'] = this.auth.getUserToken();
      return cfg;
    });
    // 凭证失效（"请登录"）时自动刷新并重试一次，避免长期复用已失效的缓存 token
    this.http.interceptors.response.use(async (resp) => {
      const body = resp.data;
      if (
        body &&
        body.success === false &&
        /请登录|未登录|登录已失效|登录过期|无效|token/i.test(body.msg ?? '')
      ) {
        const cfg = resp.config;
        if (!cfg.headers['X-KGD-RETRIED']) {
          cfg.headers['X-KGD-RETRIED'] = '1';
          await this.auth.refreshNow();
          cfg.headers['X-TOKEN'] = this.auth.getUserToken();
          return this.http.request(cfg);
        }
      }
      return resp;
    });
  }

  /** 统一解析快工单响应，失败抛错 */
  private unwrap<T>(resp: { data: { success?: boolean; data?: T; count?: number; msg?: string } }): {
    data: T;
    count?: number;
  } {
    const body = resp.data;
    if (body.success === false) {
      throw new Error(`快工单接口错误: ${body.msg ?? '未知错误'}`);
    }
    return { data: body.data as T, count: body.count };
  }

  private async post<T>(url: string, payload: Record<string, unknown>): Promise<{ data: T; count?: number }> {
    const resp = await this.http.post(url, payload);
    return this.unwrap<T>(resp);
  }

  // ===== 工序 =====

  /** 工序列表 */
  listCrafts(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/pub_craft/list', { pageNo: 1, pageSize: 100, ...params });
  }

  /** 工序新增 */
  addCraft(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/pub_craft/add', payload);
  }

  /** 工序编辑 */
  editCraft(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/pub_craft/edit', payload);
  }

  // ===== 商品 =====

  /** 商品列表（支持 goods_keyword / supplier_name / category_name / source / updated_at 等过滤） */
  listGoods(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/goods/list', { pageNo: 1, pageSize: 20, ...params });
  }

  /** 商品新增 */
  addGoods(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/goods/add', payload);
  }

  /** 商品编辑 */
  editGoods(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/goods/edit', payload);
  }

  // ===== 生产任务 =====

  /** 生产任务列表（按 reportable_user_name 过滤后即为"该工人的任务"） */
  listTasks(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/produce_bill_craft/list', params);
  }

  /** 生产任务状态修改：1=未开始 2=进行中 3=已完成 4=暂停 */
  editTaskStatus(id: number, status: 1 | 2 | 3 | 4) {
    return this.post<any[]>('/open_api/produce_bill_craft/edit_status', { id, status });
  }

  // ===== 报工 =====

  /** 新增报工记录 */
  addReportWorkRecord(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/report_work_record/add', payload);
  }

  /** 修改报工记录（仅可修改自己的，未质检/未结算的记录） */
  editReportWorkRecord(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/report_work_record/edit', payload);
  }

  /** 删除报工记录（OpenAPI 无删除接口，走公版 Web /api/report_work_record/del） */
  async deleteReportWorkRecord(id: number): Promise<{ data: any[] }> {
    const body = await this.webPost('/api/report_work_record/del', { id });
    if (!body?.success) {
      throw new Error(`快工单接口错误: ${body?.msg ?? '删除报工失败'}`);
    }
    return { data: body.data ?? [] };
  }

  /** 报工记录列表 */
  listReportRecords(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/report_work_record/list', params);
  }

  // ===== 加工单 =====

  /** 加工单列表 */
  listProduceBills(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/produce_bill/list', { pageNo: 1, pageSize: 50, ...params });
  }

  /** 加工单新增 */
  addProduceBill(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/produce_bill/add', payload);
  }

  /** 加工单状态修改：1=开始 2=撤回 3=完成 4=取消 */
  editProduceBillStatus(id: number, type: 1 | 2 | 3 | 4, cancelReason?: string) {
    const payload: Record<string, unknown> = { id: String(id), type };
    if (cancelReason) payload.cancel_reason = cancelReason;
    return this.post<any[]>('/open_api/produce_bill/edit_status', payload);
  }

  /** 编辑加工单（Body 结构见快工单开放接口文档：id/num/craft_list 等） */
  editProduceBill(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/produce_bill/edit', payload);
  }

  // ===== 公版 Web 系统（真实工艺顺序 order_number 数据源） =====

  /** 公版请求签名：MD5(时间戳 + 固定盐) */
  private webSign(timestamp: string): string {
    return crypto.createHash('md5').update(timestamp + WEB_SIGN_SALT).digest('hex');
  }

  /**
   * 公版系统登录：凭证以数据库为唯一事实源，生产/开发多实例共享同一账号。
   * 实测公版为单会话模式——每次登录生成新 web_token，旧 token 立即失效（返回"请登录"）；
   * 两实例各自定时登录会互相顶号。因此：
   * - 内存缓存 6 小时（减少读库）
   * - 内存未命中 → 读数据库复用其他实例写入的 token（不重新登录）
   * - 数据库也没有 → 才登录并写库；token 失效由 webPost 拦截重登
   */
  private webAuth: { token: string; enterpriseId: string; at: number } | null = null;
  private readonly WEB_AUTH_CACHE_MS = 6 * 60 * 60 * 1000; // 内存缓存时长：6 小时
  private async loginWeb(): Promise<{ token: string; enterpriseId: string }> {
    if (this.webAuth && Date.now() - this.webAuth.at < this.WEB_AUTH_CACHE_MS) {
      return this.webAuth;
    }
    // 数据库共享复用：读库拿到其他实例登录的 token 直接用（唯一的 token，不再各自登录互顶）
    const cached = await this.tokens.findOneBy({ id: 1 });
    if (cached?.webToken) {
      this.webAuth = { token: cached.webToken, enterpriseId: cached.webEnterpriseId ?? '', at: Date.now() };
      return this.webAuth;
    }
    const mobile = this.config.get<string>('kgd.webMobile') ?? '';
    const pwd = this.config.get<string>('kgd.webPassword') ?? '';
    if (!mobile || !pwd) throw new Error('未配置公版系统账号（KGD_WEB_MOBILE / KGD_WEB_PASSWORD）');
    const ts = String(Math.floor(Date.now() / 1000));
    const resp = await this.http.post('/api/user/login_by_pwd', {
      mobile,
      pwd,
      channel: WEB_CHANNEL,
      timestamp: ts,
      sign: this.webSign(ts),
      token: '',
      enterprise_id: '',
    });
    const body = resp.data;
    if (!body?.success || !body.data?.web_token) {
      throw new Error(`公版系统登录失败: ${body?.msg ?? '未知错误'}`);
    }
    const token = body.data.web_token;
    const enterpriseId = String(body.data.enterprise_id ?? '');
    // 登录成功后持久化：行存在则只更新公版凭证列；不存在则补全必填列新建
    // （不能用部分列 upsert：行缺失时 MySQL 走 INSERT，缺 NOT NULL 无默认值的 access_token 会报错）
    const row = await this.tokens.findOneBy({ id: 1 });
    if (row) {
      await this.tokens.update({ id: 1 }, { webToken: token, webEnterpriseId: enterpriseId });
    } else {
      await this.tokens.save(
        this.tokens.create({ id: 1, accessToken: '', userToken: '', webToken: token, webEnterpriseId: enterpriseId }),
      );
    }
    this.webAuth = { token, enterpriseId, at: Date.now() };
    return this.webAuth;
  }

  /**
   * 公版 Web 请求统一封装：自动注入 timestamp/sign/channel/token/enterprise_id。
   * token 失效（"请登录"等）时清内存缓存重新登录后重试一次，避免共享 token 过期后所有公版功能连续失败
   */
  private async webPost(path: string, params: Record<string, unknown>): Promise<any> {
    const body = await this.doWebPost(path, params);
    if (!body?.success && /请登录|未登录|登录已失效|登录过期/i.test(body?.msg ?? '')) {
      this.logger.warn(`公版 ${path} 提示未登录（token 失效），重新登录后重试`);
      // 清内存缓存 + 清数据库失效 token，强制下一次登录写新 token（否则 loginWeb 仍会复用失效 token）
      this.webAuth = null;
      await this.tokens.update({ id: 1 }, { webToken: '', webEnterpriseId: '' });
      return this.doWebPost(path, params);
    }
    return body;
  }

  private async doWebPost(path: string, params: Record<string, unknown>): Promise<any> {
    const { token, enterpriseId } = await this.loginWeb();
    const ts = String(Math.floor(Date.now() / 1000));
    const resp = await this.http.post(path, {
      timestamp: ts,
      sign: this.webSign(ts),
      channel: WEB_CHANNEL,
      token,
      enterprise_id: enterpriseId,
      ...params,
    });
    return resp.data;
  }

  /**
   * 公版分页拉取加工单，解析每单 craft_list 的工序顺序。
   * 返回 Map<taskId, orderNumber>（order_number 即快工单真实工艺顺序，用户可拖动调整；
   * OpenAPI 不返回该字段，其数组顺序按 id 升序，不可作为顺序依据）
   * @param createdAfter 非空时只拉近 created_at 该时间之后的加工单（全量对账按一年窗口）
   */
  async fetchWebCraftOrders(createdAfter?: string): Promise<Map<number, number>> {
    const orders = new Map<number, number>();
    const PAGE = 200;
    let page = 1;
    for (;;) {
      const params: Record<string, unknown> = { pageNo: page, pageSize: PAGE };
      if (createdAfter) {
        params.created_at_start = createdAfter;
        params.created_at_end = fmtDateTimeWeb(new Date());
      }
      const body = await this.webPost('/api/produce_bill/list', params);
      if (!body?.success) throw new Error(`公版加工单列表失败: ${body?.msg ?? '未知错误'}`);
      const rows: any[] = body.data ?? [];
      for (const b of rows) {
        for (const c of b.craft_list ?? []) {
          if (c.id != null && c.order_number != null) orders.set(c.id, c.order_number);
        }
      }
      const count = body.count ?? rows.length;
      if (rows.length < PAGE || page * PAGE >= count) break;
      page++;
    }
    return orders;
  }

  /**
   * 公版 Web 报工记录列表（分页拉取）。OpenAPI 的 report_work_record/list 返回的记录
   * 不含时间戳字段，公版接口额外返回完整报工时间 report_time（YYYY-MM-DD HH:mm:ss），
   * 供本地缓存回填报工时间。支持 report_time_start/end 时间窗口过滤。
   */
  async listWebReportRecords(params: Record<string, unknown> = {}): Promise<{ data: any[]; count?: number }> {
    const body = await this.webPost('/api/report_work_record/list', { pageNo: 1, pageSize: 200, ...params });
    if (!body?.success) throw new Error(`公版报工记录列表失败: ${body?.msg ?? '未知错误'}`);
    return { data: body.data ?? [], count: body.count };
  }

  /**
   * 公版 Web 不良品项字典（企业级，含 code 编号 / name 名称）。
   * 报工提交不良品项时 waste_item_code 必须传编号（如气孔=01），名称会报
   * 「不良品项【xxx】不存在」。OpenAPI 无此字典，公版接口分页可全量拉取。
   */
  async listWebWasteItems(): Promise<{ data: any[]; count?: number }> {
    const rows: any[] = [];
    const PAGE = 100;
    let page = 1;
    for (;;) {
      const body = await this.webPost('/api/waste_item/list', { pageNo: page, pageSize: PAGE });
      if (!body?.success) throw new Error(`公版不良品项列表失败: ${body?.msg ?? '未知错误'}`);
      const pageRows: any[] = body.data ?? [];
      rows.push(...pageRows);
      const count = body.count ?? rows.length;
      if (pageRows.length < PAGE || page * PAGE >= count) break;
      page++;
    }
    return { data: rows, count: rows.length };
  }

  // ===== 用户 =====

  /** 用户列表 */
  listUsers(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/user/list', params);
  }

  // ===== 客户 =====

  /** 客户列表（支持 keyword / is_enable / updated_at 窗口过滤） */
  listCustomers(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/customer/list', params);
  }

  /** 客户新增 */
  addCustomer(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/customer/add', payload);
  }

  // ===== 供应商 =====

  /** 供应商列表（支持 keyword / is_enable / updated_at 窗口过滤） */
  listSuppliers(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/supplier/list', params);
  }

  /** 供应商新增 */
  addSupplier(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/supplier/add', payload);
  }

  // ===== 其他出库单 =====

  /** 其他出库单列表（支持 goods_keyword / code / 单据日期 / 制单时间窗口过滤） */
  listElseStockOutBills(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/else_stock_out_bill/list', params);
  }

  /** 其他出库单新增 */
  addElseStockOutBill(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/else_stock_out_bill/add', payload);
  }

  // ===== 其他入库单 =====

  /** 其他入库单列表（支持 goods_keyword / code / 单据日期 / 制单时间窗口过滤） */
  listElseStockInBills(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/else_stock_in_bill/list', params);
  }

  /** 其他入库单新增 */
  addElseStockInBill(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/else_stock_in_bill/add', payload);
  }

  // ===== 成品入库单 =====

  /** 成品入库单列表（支持 goods_keyword / code / 单据日期 / 制单时间窗口过滤） */
  listProduceStockInBills(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/produce_stock_in_bill/list', params);
  }

  /** 成品入库单新增 */
  addProduceStockInBill(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/produce_stock_in_bill/add', payload);
  }

  // ===== 合同 =====

  /** 合同列表（支持 code / goods_keyword / 出库进度 / updated_at 窗口过滤） */
  listContracts(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/customer_contract/list', params);
  }

  /** 合同新增 */
  addContract(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/customer_contract/add', payload);
  }

  /** 合同修改 */
  editContract(payload: Record<string, unknown>) {
    return this.post<any[]>('/open_api/customer_contract/edit', payload);
  }

  // ===== 上传附件 =====

  /** 上传附件（multipart/form-data），返回 { original_name, url, file_size } */
  uploadFile(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('file', new Blob([buffer as unknown as BlobPart]), filename);
    return this.http.post('/open_api/upload/file', form).then((resp) => this.unwrap<any>(resp));
  }
}
