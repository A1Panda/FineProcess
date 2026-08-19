import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 商品库存本地缓存：由定时任务从公版 Web /api/goods_stock/list 滚动同步，查询读此表秒回。
 *  一条记录 = 「商品 × 仓库」库存行。OpenAPI 无库存接口，数据源为公版系统。 */
@Entity('kgd_goods_stock_cache')
export class KgdGoodsStockCache {
  @PrimaryColumn({ name: 'stock_id' })
  stockId: number;

  @Column({ name: 'ware_id', type: 'int', default: 0 })
  wareId: number;

  @Column({ name: 'ware_name', length: 128, default: '' })
  wareName: string;

  @Column({ name: 'goods_id', type: 'int', default: 0 })
  goodsId: number;

  @Column({ name: 'goods_code', length: 128, default: '' })
  goodsCode: string;

  @Column({ name: 'goods_name', length: 255, default: '' })
  goodsName: string;

  @Column({ name: 'goods_standard', length: 255, default: '' })
  goodsStandard: string;

  @Column({ name: 'unit_name', length: 32, default: '' })
  unitName: string;

  @Column({ type: 'int', default: 0 })
  source: number;

  @Column({ name: 'source_name', length: 32, default: '' })
  sourceName: string;

  @Column({ name: 'category_path_names', type: 'varchar', length: 512, nullable: true })
  categoryPathNames: string | null;

  /** 本仓库库存数量（保留快工单原始精度字符串） */
  @Column({ type: 'varchar', length: 64, default: '0' })
  num: string;

  /** 本仓库不良数量 */
  @Column({ name: 'waste_num', type: 'varchar', length: 64, default: '0' })
  wasteNum: string;

  /** 全部仓库合计数量 */
  @Column({ name: 'stock_total_num', type: 'varchar', length: 64, default: '0' })
  stockTotalNum: string;

  /** 全部仓库合计不良 */
  @Column({ name: 'stock_total_waste_num', type: 'varchar', length: 64, default: '0' })
  stockTotalWasteNum: string;

  /** 全部仓库可用库存 */
  @Column({ name: 'stock_total_available_num', type: 'varchar', length: 64, default: '0' })
  stockTotalAvailableNum: string;

  @Column({ name: 'lock_stock_num', type: 'varchar', length: 64, default: '0' })
  lockStockNum: string;

  @Column({ name: 'purchase_in_transit_num', type: 'varchar', length: 64, default: '0' })
  purchaseInTransitNum: string;

  @Column({ name: 'low_limit', type: 'varchar', length: 64, nullable: true })
  lowLimit: string | null;

  @Column({ name: 'upper_limit', type: 'varchar', length: 64, nullable: true })
  upperLimit: string | null;

  @Column({ name: 'updated_at', type: 'varchar', length: 32, nullable: true })
  updatedAt: string | null;

  /** 商品扩展字段数组 [{ name, value }] */
  @Column({ name: 'field_value_list', type: 'json', nullable: true })
  fieldValueList: unknown;

  /** 快工单原始返回，保留 goods/ware 等未单独建列的字段 */
  @Column({ type: 'json', nullable: true })
  raw: unknown;

  @UpdateDateColumn({ name: 'synced_at' })
  syncedAt: Date;
}
