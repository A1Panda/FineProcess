import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 加工单本地缓存：由定时任务从快工单滚动同步，前端查询读此表秒回 */
@Entity('kgd_bill_cache')
export class KgdBillCache {
  @PrimaryColumn({ name: 'bill_id' })
  billId: number;

  @Column({ length: 64 })
  code: string;

  @Column({ name: 'ht_no', type: 'varchar', length: 64, nullable: true })
  htNo: string | null;

  @Column({ name: 'goods_name', length: 255, default: '' })
  goodsName: string;

  @Column({ name: 'goods_spec', length: 255, default: '' })
  goodsSpec: string;

  @Column({ type: 'int', default: 0 })
  num: number;

  @Column({ name: 'unit_name', length: 32, default: '' })
  unitName: string;

  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ name: 'status_name', length: 32, default: '' })
  statusName: string;

  @Column({ name: 'plan_start', type: 'varchar', length: 32, nullable: true })
  planStart: string | null;

  @Column({ name: 'plan_end', type: 'varchar', length: 32, nullable: true })
  planEnd: string | null;

  @Column({ name: 'delivery_date', type: 'varchar', length: 32, nullable: true })
  deliveryDate: string | null;

  @Column({ type: 'json', nullable: true })
  raw: unknown;

  @UpdateDateColumn({ name: 'synced_at' })
  syncedAt: Date;
}
