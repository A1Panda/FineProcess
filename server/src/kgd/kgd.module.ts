import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KgdAuthService } from './kgd-auth.service';
import { KgdClientService } from './kgd-client.service';
import { KgdSyncService } from './kgd-sync.service';
import { KgdToken } from './kgd-token.entity';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';
import { KgdGoodsCache } from './kgd-goods-cache.entity';
import { KgdReportCache } from '../report/kgd-report-cache.entity';
import { User } from '../auth/users.entity';
import { KgdSyncMeta } from './kgd-sync-meta.entity';
import { KgdWasteItem } from './kgd-waste-item.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([KgdToken, KgdBillCache, KgdTaskCache, KgdGoodsCache, KgdReportCache, User, KgdSyncMeta, KgdWasteItem]),
  ],
  providers: [KgdAuthService, KgdClientService, KgdSyncService],
  exports: [KgdAuthService, KgdClientService, KgdSyncService, TypeOrmModule],
})
export class KgdModule {}
