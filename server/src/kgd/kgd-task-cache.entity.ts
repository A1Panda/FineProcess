import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 生产任务本地缓存：由定时任务从快工单滚动同步，前端查询读此表秒回 */
@Entity('kgd_task_cache')
export class KgdTaskCache {
  @PrimaryColumn({ name: 'task_id' })
  taskId: number;

  @Column({ name: 'bill_id', type: 'int', default: 0 })
  billId: number;

  @Column({ name: 'bill_code', length: 64, default: '' })
  billCode: string;

  @Column({ name: 'ht_no', type: 'varchar', length: 64, nullable: true })
  htNo: string | null;

  @Column({ name: 'craft_name', length: 64, default: '' })
  craftName: string;

  @Column({ name: 'craft_code', type: 'varchar', length: 64, nullable: true })
  craftCode: string | null;

  /** 工艺顺序：全量同步时记录快工单接口返回数组顺序（用户调整后的真实排列），增量同步不更新 */
  @Column({ name: 'craft_seq', type: 'int', nullable: true })
  craftSeq: number | null;

  @Column({ name: 'goods_name', length: 255, default: '' })
  goodsName: string;

  @Column({ name: 'goods_code', type: 'varchar', length: 128, nullable: true })
  goodsCode: string | null;

  @Column({ name: 'goods_spec', length: 255, default: '' })
  goodsSpec: string;

  @Column({ length: 32, default: '0' })
  num: string;

  @Column({ name: 'valid_num', length: 32, default: '0' })
  validNum: string;

  @Column({ name: 'waste_num', length: 32, default: '0' })
  wasteNum: string;

  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ name: 'status_name', length: 32, default: '' })
  statusName: string;

  /** 任务完成时间（快工单 end_time，仅已完成任务有值），用于"已完成"按最新完成排序 */
  @Column({ name: 'end_time', type: 'varchar', length: 32, nullable: true })
  endTime: string | null;

  @Column({ name: 'reportable_user_names', type: 'varchar', length: 1024, nullable: true })
  reportableUserNames: string | null;

  @Column({ name: 'unit_name', length: 32, default: '' })
  unitName: string;

  @Column({ name: 'workshop_path_names', length: 255, default: '' })
  workshopPathNames: string;

  @Column({ name: 'produce_line_names', length: 255, default: '' })
  produceLineNames: string;

  @Column({ type: 'json', nullable: true })
  raw: unknown;

  @UpdateDateColumn({ name: 'synced_at' })
  syncedAt: Date;
}
