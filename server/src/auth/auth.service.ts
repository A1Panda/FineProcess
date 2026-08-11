import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
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

  /** 启动时从快工单同步用户到本地（已存在则跳过，不覆盖密码） */
  async syncUsersFromKgd(): Promise<number> {
    const adminUsername = this.config.get<string>('kgd.username');
    const { data: kgdUsers } = await this.kgdClient.listUsers({ pageNo: 1, pageSize: 500 });
    let created = 0;
    for (const u of kgdUsers ?? []) {
      const exists = await this.users.findOneBy({ kgdUserId: u.id });
      if (exists) continue;
      const hash = await bcrypt.hash(this.defaultPassword, 10);
      await this.users.save(
        this.users.create({
          kgdUserId: u.id,
          username: u.name ?? `u${u.id}`,
          name: u.real_name ?? u.name ?? '',
          password: hash,
          role: u.name === adminUsername ? 'admin' : 'worker',
        }),
      );
      created++;
    }
    this.logger.log(`已从快工单同步用户，新增 ${created} 个本地账号（默认密码 ${this.defaultPassword}）`);
    return created;
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
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        kgdUserId: user.kgdUserId,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    };
  }
}
