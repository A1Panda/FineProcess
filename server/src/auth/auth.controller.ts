import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  /** 当前登录用户完整信息（个人中心展示：岗位/部门/工序等） */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.myProfile(user);
  }

  /** 用户修改自己的登录密码：body { oldPassword, newPassword } */
  @UseGuards(JwtAuthGuard)
  @Post('me/password')
  changeMyPassword(@Body() body: { oldPassword: string; newPassword: string }, @CurrentUser() user: JwtPayload) {
    return this.auth.changeMyPassword(user, body.oldPassword, body.newPassword);
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

  /** 从快工单同步用户（仅管理员） */
  @UseGuards(JwtAuthGuard)
  @Post('sync-users')
  syncUsers(@CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException('仅管理员可操作');
    return this.auth.syncUsersFromKgd();
  }

  /** 重置用户登录密码（仅管理员）：body { password } */
  @UseGuards(JwtAuthGuard)
  @Post('users/:id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password: string }, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException('仅管理员可操作');
    return this.auth.resetPassword(Number(id), body.password);
  }
}
