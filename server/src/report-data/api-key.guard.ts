import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * 统一开放接口鉴权（Header: X-API-Key = PLUGIN_API_KEY）：
 * 供 AstrBot 机器人插件、浏览器扩展、产品编码管理系统等外部服务调用，
 * 与前端用户的 JWT 体系解耦。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get<string>('pluginApiKey');
    if (!expected) {
      throw new UnauthorizedException('服务间共享密钥未配置（PLUGIN_API_KEY）');
    }
    const provided = req.headers['x-api-key'];
    if (typeof provided !== 'string' || provided !== expected) {
      throw new UnauthorizedException('开放接口凭证错误');
    }
    return true;
  }
}
