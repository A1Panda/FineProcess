import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtPayload } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }

  /** 当前登录用户信息 */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }

  /** 本地用户列表（不含密码），供报工时按工序选择报工人等 */
  @UseGuards(JwtAuthGuard)
  @Get('users')
  listUsers() {
    return this.auth.listUsersLocal();
  }

  /** 报工人候选：外部人员名单（含当日编码）合并快工单用户映射 */
  @UseGuards(JwtAuthGuard)
  @Get('reporters')
  listReporters() {
    return this.auth.listExternalReporters();
  }

  /** 从快工单同步用户（管理操作） */
  @UseGuards(JwtAuthGuard)
  @Post('sync-users')
  syncUsers() {
    return this.auth.syncUsersFromKgd();
  }
}
