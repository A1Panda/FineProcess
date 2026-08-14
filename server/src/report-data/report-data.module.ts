import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportDataController } from './report-data.controller';
import { ReportDataService } from './report-data.service';
import { ApiKeyGuard } from './api-key.guard';
import { KgdBillCache } from '../kgd/kgd-bill-cache.entity';
import { KgdTaskCache } from '../kgd/kgd-task-cache.entity';
import { KgdGoodsCache } from '../kgd/kgd-goods-cache.entity';

/**
 * 日报数据源模块：把快工单 OpenAPI 数据以只读接口形式暴露给外部系统
 * （如 AstrBot 机器人插件），使插件不再持有快工单凭证、不直连 OpenAPI。
 * KgdClientService / KgdSyncService 由全局 KgdModule 提供。
 */
@Module({
  imports: [TypeOrmModule.forFeature([KgdBillCache, KgdTaskCache, KgdGoodsCache])],
  controllers: [ReportDataController],
  providers: [ReportDataService, ApiKeyGuard],
})
export class ReportDataModule {}
