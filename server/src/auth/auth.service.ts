import { Injectable, Logger, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './users.entity';
import { KgdClientService } from '../kgd/kgd-client.service';

export interface JwtPayload {
  sub: number;
  kgdUserId: number;
  username: string;
  name: string;
  role: string;
  roleName: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly defaultPassword = 'kgd123456';

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly kgdClient: KgdClientService,
  ) {}

  /** 启动延迟同步用户：等 KgdAuthService 凭证就绪后再拉取 */
  onModuleInit() {
    setTimeout(async () => {
      try {
        await this.syncUsersFromKgd();
      } catch (e) {
        this.logger.warn(`启动同步用户失败，30 秒后重试: ${(e as Error).message}`);
        setTimeout(() => this.syncUsersFromKgd().catch(() => undefined), 30_000);
      }
    }, 5_000);
  }

  /** 启动时从快工单同步用户到本地（已存在则刷新岗位名，不覆盖密码） */
  async syncUsersFromKgd(): Promise<number> {
    const adminUsername = this.config.get<string>('kgd.username');
    const { data: kgdUsers } = await this.kgdClient.listUsers({ pageNo: 1, pageSize: 500 });
    let created = 0;
    for (const u of kgdUsers ?? []) {
      const roleName = u.role?.name ?? '';
      const exists = await this.users.findOneBy({ kgdUserId: u.id });
      if (exists) {
        // 用户名/姓名/岗位可能被修改（如名字打错后修正），同步时以快工单为准刷新（不覆盖密码）
        const patch: Partial<User> = {};
        const newUsername = u.name ?? `u${u.id}`;
        const newName = u.real_name ?? u.name ?? '';
        if (exists.username !== newUsername) patch.username = newUsername;
        if (exists.name !== newName) patch.name = newName;
        if (exists.roleName !== roleName) patch.roleName = roleName;
        if (Object.keys(patch).length) {
          await this.users.update({ id: exists.id }, patch);
        }
        continue;
      }
      const hash = await bcrypt.hash(this.defaultPassword, 10);
      await this.users.save(
        this.users.create({
          kgdUserId: u.id,
          username: u.name ?? `u${u.id}`,
          name: u.real_name ?? u.name ?? '',
          password: hash,
          role: u.name === adminUsername ? 'admin' : 'worker',
          roleName,
        }),
      );
      created++;
    }
    this.logger.log(`已从快工单同步用户，新增 ${created} 个本地账号（默认密码 ${this.defaultPassword}）`);
    return created;
  }

  /** 本地用户列表（不含密码），供前端按工序选择报工人等 */
  listUsersLocal() {
    return this.users.find({
      select: {
        id: true,
        kgdUserId: true,
        username: true,
        name: true,
        role: true,
        roleName: true,
      },
      order: { name: 'ASC' },
    });
  }

  /** 外部人员名单缓存（含当日编码），5 分钟过期；跨日后即使未过期也强制刷新 */
  private externalCache: { ts: number; date: string; data: { name: string; code: string; kgdUserId: number | null }[] } | null = null;

  /**
   * 报工人候选：外部人员名单（含当日编码）合并本地快工单用户映射
   * 返回 [{ name, code, kgdUserId }]；kgdUserId 为 null 表示该人员未匹配到快工单用户
   * 外部服务器不可达时抛 503，前端可降级到本地用户列表
   */
  async listExternalReporters() {
    const now = Date.now();
    const today = this.localDateStr();
    // 5 分钟内且未跨日才命中缓存；编码按日期变更，跨日后必须重新拉取
    if (this.externalCache && this.externalCache.date === today && now - this.externalCache.ts < 5 * 60 * 1000) {
      return this.externalCache.data;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    let daily: { name: string; code: string }[] = [];
    let day = today;
    try {
      const res = await fetch(`${this.config.get<string>('externalEmployeeApi')}/api/daily`, { signal: ctrl.signal });
      if (res.ok) {
        const data = (await res.json()) as { date?: string; employees?: { name: string; code: string }[] };
        if (typeof data.date === 'string' && data.date) day = data.date; // 以编码系统自己的日期为准
        daily = data.employees ?? [];
      }
    } catch {
      daily = [];
    } finally {
      clearTimeout(timer);
    }
    if (!daily.length) throw new ServiceUnavailableException('外部人员服务器不可达');

    const users = await this.users.find({ select: { kgdUserId: true, name: true } });
    const byName = new Map(users.map((u) => [u.name, u.kgdUserId]));
    const data = daily.map((e) => ({ name: e.name, code: e.code, kgdUserId: byName.get(e.name) ?? null }));
    this.externalCache = { ts: now, date: day, data };
    return data;
  }

  /** 本地日期 YYYY-MM-DD */
  private localDateStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 本地登录并签发 JWT */
  async login(username: string, password: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.username = :username', { username })
      .getOne();
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const payload: JwtPayload = {
      sub: user.id,
      kgdUserId: user.kgdUserId,
      username: user.username,
      name: user.name,
      role: user.role,
      roleName: user.roleName ?? null,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        kgdUserId: user.kgdUserId,
        username: user.username,
        name: user.name,
        role: user.role,
        roleName: user.roleName ?? null,
      },
    };
  }
}
