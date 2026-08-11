import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KgdTaskCache])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
