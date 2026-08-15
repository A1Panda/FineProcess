import { Controller, Get, UseGuards } from '@nestjs/common';
import { CraftsService } from './crafts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@UseGuards(JwtAuthGuard)
@Controller('crafts')
export class CraftsController {
  constructor(private readonly crafts: CraftsService) {}

  /** 当前工人负责的工序 */
  @Get('mine')
  getMine(@CurrentUser() user: JwtPayload) {
    return this.crafts.getMine(user);
  }

  /** 全部工序 */
  @Get()
  getAll() {
    return this.crafts.getAll();
  }

  /** 不良品项字典（code 编号 / name 名称） */
  @Get('waste-items')
  getWasteItems() {
    return this.crafts.getWasteItems();
  }
}
