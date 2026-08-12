import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 报工记录本地缓存：快工单报工记录接口不返回创建时间，
 * 本表在报工/修改成功时记录本地时间，供弹窗展示"报工时间"。
 */
@Entity('kgd_report_cache')
export class KgdReportCache {
  @PrimaryGeneratedColumn()
  id: number;

  /** 快工单报工记录ID（add 后按任务+用户反查，历史/未知时为空）；唯一约束保证 upsert 幂等 */
  @Column({ name: 'report_id', type: 'bigint', nullable: true, unique: true })
  reportId: number | null;

  @Column({ name: 'bill_code', length: 64, default: '' })
  billCode: string;

  @Column({ name: 'craft_name', length: 64, default: '' })
  craftName: string;

  @Column({ name: 'unit_name', length: 32, default: '' })
  unitName: string;

  @Column({ name: 'plan_num', length: 32, default: '' })
  planNum: string;

  @Column({ name: 'report_user_id', length: 32, default: '' })
  reportUserId: string;

  @Column({ name: 'report_user_name', length: 64, default: '' })
  reportUserName: string;

  @Column({ name: 'valid_num', length: 32, default: '0' })
  validNum: string;

  @Column({ name: 'waste_num', length: 32, default: '0' })
  wasteNum: string;

  @Column({ name: 'working_minutes', type: 'int', default: 0 })
  workingMinutes: number;

  @Column({ name: 'valid_money', length: 32, default: '0' })
  validMoney: string;

  @Column({ name: 'price_mode_name', length: 32, default: '' })
  priceModeName: string;

  /** 报工时间（本地记录，YYYY-MM-DD HH:mm:ss） */
  @Column({ name: 'report_time', length: 32, default: '' })
  reportTime: string;

  @Column({ name: 'remark', type: 'varchar', length: 500, nullable: true })
  remark: string | null;

  /**
   * 最近同步时间（普通列而非 UpdateDateColumn：
   * upsert 冲突键 reportId 非主键，MySQL insertId=0 时 UpdateDateColumn 的回填回查会抛
   * "Cannot update entity because entity id is not set"，故改为普通列 + 显式赋值）
   */
  @Column({ name: 'synced_at', type: 'datetime', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  syncedAt: Date | null;
}
