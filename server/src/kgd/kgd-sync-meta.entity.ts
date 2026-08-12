import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 同步元数据（KV）：记录各数据源上次增量同步位置等 */
@Entity('kgd_sync_meta')
export class KgdSyncMeta {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  value: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
