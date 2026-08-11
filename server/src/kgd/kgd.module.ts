import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KgdAuthService } from './kgd-auth.service';
import { KgdClientService } from './kgd-client.service';
import { KgdSyncService } from './kgd-sync.service';
import { KgdToken } from './kgd-token.entity';
import { KgdBillCache } from './kgd-bill-cache.entity';
import { KgdTaskCache } from './kgd-task-cache.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([KgdToken, KgdBillCache, KgdTaskCache])],
  providers: [KgdAuthService, KgdClientService, KgdSyncService],
  exports: [KgdAuthService, KgdClientService, KgdSyncService],
})
export class KgdModule {}
