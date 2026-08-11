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

  /** 加工单状态修改：1=开始 2=撤回 3=完成 4=取消 */
  editProduceBillStatus(id: number, type: 1 | 2 | 3 | 4, cancelReason?: string) {
    const payload: Record<string, unknown> = { id: String(id), type };
    if (cancelReason) payload.cancel_reason = cancelReason;
    return this.post<any[]>('/open_api/produce_bill/edit_status', payload);
  }

  // ===== 用户 =====

  /** 用户列表 */
  listUsers(params: Record<string, unknown> = {}) {
    return this.post<any[]>('/open_api/user/list', params);
  }
}
