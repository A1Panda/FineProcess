import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdReportCache } from '../report/kgd-report-cache.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KgdBillCache, KgdTaskCache, KgdReportCache])],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
