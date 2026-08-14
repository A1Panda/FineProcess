import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 商品本地缓存：由定时任务从快工单滚动同步，查询读此表秒回（字段值与开放接口 /goods 返回一致） */
@Entity('kgd_goods_cache')
export class KgdGoodsCache {
  @PrimaryColumn({ name: 'goods_id' })
  goodsId: number;

  @Column({ length: 128, default: '' })
  code: string;

  @Column({ length: 255, default: '' })
  name: string;

  @Column({ length: 255, default: '' })
  standard: string;

  @Column({ name: 'category_path_names', type: 'varchar', length: 512, nullable: true })
  categoryPathNames: string | null;

  @Column({ type: 'int', default: 0 })
  source: number;

  @Column({ name: 'source_name', length: 32, default: '' })
  sourceName: string;

  @Column({ name: 'unit_name', length: 32, default: '' })
  unitName: string;

  @Column({ name: 'selling_money', type: 'varchar', length: 64, nullable: true })
  sellingMoney: string | null;

  @Column({ name: 'is_enable', type: 'int', default: 1 })
  isEnable: number;

  @Column({ name: 'updated_at', type: 'varchar', length: 32, nullable: true })
  updatedAt: string | null;

  /** 扩展字段数组 [{ name, value }] */
  @Column({ name: 'field_value_list', type: 'json', nullable: true })
  fieldValueList: unknown;

  /** 快工单原始返回，保留 supplier_name / create_user_name 等未单独建列的字段供本地过滤 */
  @Column({ type: 'json', nullable: true })
  raw: unknown;

  @UpdateDateColumn({ name: 'synced_at' })
  syncedAt: Date;
}
