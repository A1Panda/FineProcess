import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KgdBillCache, KgdTaskCache])],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
