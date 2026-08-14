import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Interval } from '@nestjs/schedule';
import { KgdToken } from './kgd-token.entity';

/**
 * 快工单凭证管理（持久化到 MySQL）：
 * - 首次启动 → 登录获取 X-TOKEN，写入数据库
 * - 后续启动 → 从数据库加载，不重新登录
 * - 定时 110 分钟刷新，写入数据库
 */
@Injectable()
export class KgdAuthService implements OnModuleInit {
  private readonly logger = new Logger(KgdAuthService.name);

  private accessToken = '';
  private userToken = '';
  private refreshing = false;
  /** 正在进行的刷新任务（供外部等待复用，避免并发刷新） */
  private refreshPromise: Promise<void> | null = null;
  /** 登录返回的用户会话信息（id/name/real_name/team/role），供开放接口连接测试使用 */
  private sessionInfo: Record<string, unknown> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(KgdToken) private readonly tokens: Repository<KgdToken>,
  ) {}

  async onModuleInit() {
    // 优先从数据库加载已有凭证
    const cached = await this.tokens.findOneBy({ id: 1 });
    const maxAge = 100 * 60 * 1000; // 100 分钟内的凭证直接用
    if (cached && cached.userToken) {
      if (Date.now() - cached.updatedAt.getTime() < maxAge) {
        this.accessToken = cached.accessToken;
        this.userToken = cached.userToken;
        this.logger.log(`从缓存加载快工单凭证（${Math.round((Date.now() - cached.updatedAt.getTime()) / 60000)} 分钟前刷新）`);
        return;
      }

      // 超时但还没过期，尝试直接复用，失败再刷新
      this.accessToken = cached.accessToken;
      this.userToken = cached.userToken;
    }

    await this.refreshCredentials();
    if (!this.userToken) {
      this.logger.warn('首次获取凭证失败，10 秒后重试');
      setTimeout(() => this.refreshCredentials(), 10_000);
    }
  }

  /** 每 110 分钟刷新一次（凭证有效期 2 小时，提前 10 分钟刷新） */
  @Interval(110 * 60 * 1000)
  refreshNow(): Promise<void> {
    // 复用进行中的刷新任务，避免定时刷新与接口触发的刷新并发重复登录
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshCredentials().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /** 获取 access_token + 登录换取 X-TOKEN 并持久化 */
  private async refreshCredentials() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const { apiKey, apiSecret, baseUrl, username } = this.config.get('kgd');

      const tokenResp = await axios.get(`${baseUrl}/open_api/token`, {
        params: { api_key: apiKey, api_secret: apiSecret },
        timeout: 15_000,
      });
      if (!tokenResp.data?.success) {
        throw new Error(`获取 access_token 失败: ${JSON.stringify(tokenResp.data)}`);
      }
      this.accessToken = tokenResp.data.data as string;

      const loginResp = await axios.post(
        `${baseUrl}/open_api/user/login`,
        { access_token: this.accessToken, username },
        { timeout: 15_000 },
      );
      if (!loginResp.data?.success) {
        throw new Error(`快工单登录失败: ${JSON.stringify(loginResp.data)}`);
      }
      this.userToken = loginResp.data.data.token as string;
      this.sessionInfo = loginResp.data.data as Record<string, unknown>;

      // 持久化
      await this.tokens.upsert(
        { id: 1, accessToken: this.accessToken, userToken: this.userToken },
        ['id'],
      );

      this.logger.log(`快工单凭证刷新成功，用户: ${loginResp.data.data.real_name ?? username}`);
    } catch (e) {
      this.logger.error(`快工单凭证刷新失败: ${(e as Error).message}`);
      // 如果刷新失败但数据库里有旧凭证，继续用旧的
      if (!this.userToken) {
        const cached = await this.tokens.findOneBy({ id: 1 });
        if (cached?.userToken) {
          this.accessToken = cached.accessToken;
          this.userToken = cached.userToken;
          this.logger.warn('刷新失败，回退使用数据库旧凭证');
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  getUserToken(): string {
    return this.userToken;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  /** 会话信息缓存（无则返回 null） */
  getSessionInfo(): Record<string, unknown> | null {
    return this.sessionInfo;
  }

  /**
   * 确保会话信息可用：有缓存直接返回；否则用当前凭证现拉一次快工单登录信息并缓存。
   * 供开放接口连接测试展示真实账号/团队/企业信息。
   */
  async ensureSessionInfo(): Promise<Record<string, unknown> | null> {
    if (this.sessionInfo) return this.sessionInfo;
    if (!this.accessToken) return null;
    const { baseUrl, username } = this.config.get('kgd');
    try {
      const loginResp = await axios.post(
        `${baseUrl}/open_api/user/login`,
        { access_token: this.accessToken, username },
        { timeout: 15_000 },
      );
      if (!loginResp.data?.success) {
        this.logger.warn(`拉取会话信息失败: ${loginResp.data?.msg ?? JSON.stringify(loginResp.data)}`);
        return null;
      }
      this.sessionInfo = loginResp.data.data as Record<string, unknown>;
      return this.sessionInfo;
    } catch (e) {
      this.logger.warn(`拉取会话信息失败: ${(e as Error).message}`);
      return null;
    }
  }
}
