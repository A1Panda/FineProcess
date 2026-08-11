import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdReportCache } from './kgd-report-cache.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KgdTaskCache, KgdReportCache])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
