import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 不良品项字典本地缓存（code 编号 / name 名称）。
 * 数据源为公版 Web `/api/waste_item/list`（OpenAPI 无此字典），
 * 持久化到数据库避免每次报工弹窗依赖公版在线；缓存超过有效期才重新拉取。
 */
@Entity('kgd_waste_item_cache')
export class KgdWasteItem {
  /** 不良品项编号（如 气孔=01、断刀=09），报工提交 waste_item_code 必须传编号 */
  @PrimaryColumn({ length: 16 })
  code: string;

  @Column({ length: 64 })
  name: string;

  /** 最近同步时间（拉取公版刷新时更新） */
  @Column({ name: 'synced_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  syncedAt: Date;
}
