import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * 服务间共享密钥校验（Header: X-API-Key）：
 * 供 AstrBot 机器人插件等外部服务调用「日报数据源」接口使用，
 * 与前端用户的 JWT 体系解耦。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get<string>('pluginApiKey');
    if (!expected) return false; // 未配置密钥时不开放接口
    const provided = req.headers['x-api-key'];
    return typeof provided === 'string' && provided === expected;
  }
}
