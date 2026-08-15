import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './users.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdClientService } from '../kgd/kgd-client.service';

export interface JwtPayload {
  sub: number;
  kgdUserId: number;
  username: string;
  name: string;
  role: string;
  roleName: string | null;
}

/** 快工单岗位名 → 本地系统管理员：岗位为「系统管理员」自动获得管理员权限（按岗位自动分配） */
const ADMIN_ROLE_NAMES = ['系统管理员'];
/** 快工单岗位名 → 本地车间主管：岗位为「生产主管/车间主管」可查看数据大屏（不可管理用户权限） */
const MANAGER_ROLE_NAMES = ['生产主管', '车间主管'];

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly defaultPassword = 'kgd123456';

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(KgdTaskCache) private readonly taskCache: Repository<KgdTaskCache>,
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

  /** 启动时从快工单同步用户到本地（已存在则刷新姓名/岗位/部门/系统角色，不覆盖密码）；快工单中已不存在的用户自动删除 */
  async syncUsersFromKgd(): Promise<{ created: number; removed: number; total: number }> {
    const { data: kgdUsers } = await this.kgdClient.listUsers({ pageNo: 1, pageSize: 500 });
    let created = 0;
    for (const u of kgdUsers ?? []) {
      const roleName = u.role?.name ?? '';
      const dept = u.department_path_names ?? '';
      const newRole = this.roleFor(u, roleName);
      const exists = await this.users.findOneBy({ kgdUserId: u.id });
      if (exists) {
        // 用户名/姓名/岗位/部门/系统角色可能被修改（如名字打错后修正、岗位/部门变动），同步时以快工单为准刷新（不覆盖密码）
        const patch: Partial<User> = {};
        const newUsername = u.name ?? `u${u.id}`;
        const newName = u.real_name ?? u.name ?? '';
        if (exists.username !== newUsername) patch.username = newUsername;
        if (exists.name !== newName) patch.name = newName;
        if (exists.roleName !== roleName) patch.roleName = roleName;
        if (exists.departmentPathNames !== dept) patch.departmentPathNames = dept;
        if (exists.role !== newRole) patch.role = newRole;
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
          role: newRole,
          roleName,
          departmentPathNames: dept,
        }),
      );
      created++;
    }

    // 删除快工单中已不存在的本地用户（本地同步残留；kgdUserId 为空的本地账号不删）
    const kgdIds = new Set((kgdUsers ?? []).map((u: any) => u.id));
    const locals = await this.users.find({ select: { id: true, kgdUserId: true, name: true } });
    let removed = 0;
    for (const l of locals) {
      if (l.kgdUserId != null && !kgdIds.has(l.kgdUserId)) {
        await this.users.delete({ id: l.id });
        removed++;
        this.logger.log(`快工单中已不存在，删除本地用户「${l.name}」`);
      }
    }

    this.logger.log(`已从快工单同步用户：新增 ${created}，删除 ${removed}，共 ${locals.length} 个本地账号（默认密码 ${this.defaultPassword}）`);
    return { created, removed, total: locals.length };
  }

  /** 快工单岗位 → 本地系统角色：系统管理员→admin；车间主管→manager；快工单管理员账号兜底保持 admin */
  private roleFor(u: { name?: string }, roleName: string): string {
    if (ADMIN_ROLE_NAMES.includes(roleName)) return 'admin';
    if (MANAGER_ROLE_NAMES.includes(roleName)) return 'manager';
    return u.name === this.config.get<string>('kgd.username') ? 'admin' : 'worker';
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
        departmentPathNames: true,
      },
      order: { name: 'ASC' },
    });
  }

  /** 管理员重置用户密码：仅改本地登录密码（bcrypt 哈希），不联动快工单 */
  async resetPassword(id: number, newPassword: string): Promise<{ name: string }> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('新密码长度至少 6 位');
    }
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('用户不存在');
    const hash = await bcrypt.hash(newPassword, 10);
    await this.users.update({ id }, { password: hash });
    this.logger.log(`管理员已重置用户「${user.name}」的登录密码`);
    return { name: user.name };
  }

  /** 当前登录用户完整信息（个人中心展示：部门/工序等） */
  async myProfile(jwt: JwtPayload) {
    const user = await this.users.findOneBy({ id: jwt.sub });
    if (!user) throw new UnauthorizedException('用户不存在');
    return {
      id: user.id,
      kgdUserId: user.kgdUserId,
      username: user.username,
      name: user.name,
      role: user.role,
      roleName: user.roleName ?? null,
      departmentPathNames: user.departmentPathNames ?? null,
      hasCraft: await this.hasCraft(user.name),
    };
  }

  /** 用户修改自己的登录密码：校验原密码后再更新 */
  async changeMyPassword(jwt: JwtPayload, oldPassword: string, newPassword: string): Promise<{ name: string }> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('新密码长度至少 6 位');
    }
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: jwt.sub })
      .getOne();
    if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
      throw new BadRequestException('原密码不正确');
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await this.users.update({ id: user.id }, { password: hash });
    this.logger.log(`用户「${user.name}」已修改自己的登录密码`);
    return { name: user.name };
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
        /** 该用户是否被分配了工序（作为某道工序的报工人），供登录后默认跳转判断 */
        hasCraft: await this.hasCraft(user.name),
      },
    };
  }

  /** 该用户是否被分配了工序：任务缓存中作为某道工序的报工人出现即视为有工序 */
  private async hasCraft(name: string): Promise<boolean> {
    if (!name) return false;
    const count = await this.taskCache
      .createQueryBuilder('t')
      .where('t.reportableUserNames LIKE :name', { name: `%${name}%` })
      .getCount();
    return count > 0;
  }
}
