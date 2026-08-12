import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { KgdAuthService } from './kgd-auth.service';

/** 快工单 OpenAPI 统一封装：自动注入 X-TOKEN，集中处理返回结构 */
@Injectable()
export class KgdClientService {
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: KgdAuthService,
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
        /请登录|未登录|登录已失效|登录过期/.test(body.msg ?? '')
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
