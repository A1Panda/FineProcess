import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/** 全局异常处理：把业务错误信息（含快工单接口错误）返回给前端 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] | object = '服务器内部错误';
    if (exception instanceof HttpException) {
      const r = exception.getResponse();
      message = typeof r === 'string' ? r : ((r as { message?: string | string[] | object }).message ?? r);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    res.status(status).json({ statusCode: status, message });
  }
}
