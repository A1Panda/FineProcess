import { Module } from '@nestjs/common';
import { CraftsController } from './crafts.controller';
import { CraftsService } from './crafts.service';

@Module({
  controllers: [CraftsController],
  providers: [CraftsService],
  exports: [CraftsService],
})
export class CraftsModule {}
