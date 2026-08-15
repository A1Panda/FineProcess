import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KgdClientService } from '../kgd/kgd-client.service';
import { KgdWasteItem } from '../kgd/kgd-waste-item.entity';
import { JwtPayload } from '../auth/auth.service';

export interface CraftView {
  id: number;
  name: string;
  code: string;
  unitName: string;
  priceModeName: string;
  needQualityName: string;
  workshopPathNames: string;
  produceLineNames: string;
  wasteItemNames: string;
  reportableUsers: { id: number; realName: string }[];
}

@Injectable()
export class CraftsService {
  private readonly logger = new Logger(CraftsService.name);

  constructor(
    private readonly kgdClient: KgdClientService,
    @InjectRepository(KgdWasteItem) private readonly wasteItems: Repository<KgdWasteItem>,
  ) {}

  private toView(c: any): CraftView {
    return {
      id: c.id,
      name: c.name ?? '',
      code: c.code ?? '',
      unitName: c.unit?.name ?? '',
      priceModeName: c.price_mode_name ?? '',
      needQualityName: c.need_quality_name ?? '',
      workshopPathNames: c.workshop_path_names ?? '',
      produceLineNames: c.produce_line_names ?? '',
      wasteItemNames: c.waste_item_names ?? '',
      reportableUsers: (c.reportable_users ?? []).map((u: any) => ({
        id: u.id,
        realName: u.real_name ?? '',
      })),
    };
  }

  /** 全部工序 */
  async getAll() {
    const { data } = await this.kgdClient.listCrafts({ pageNo: 1, pageSize: 200 });
    return (data ?? []).map((c) => this.toView(c));
  }

  /** 当前工人负责的工序（reportable_users 包含自己） */
  async getMine(user: JwtPayload) {
    const all = await this.getAll();
    return all.filter((c) => c.reportableUsers.some((u) => u.id === user.kgdUserId));
  }

  /** 不良品项字典：内存缓存（5 分钟）→ 数据库缓存（24 小时内有效）→ 公版拉取刷新。
   *  数据库持久化后不依赖公版在线，公版不可用时降级返回本地缓存 */
  private wasteCache: { data: { code: string; name: string }[]; at: number } | null = null;
  private readonly WASTE_CACHE_MS = 5 * 60 * 1000;
  /** 数据库缓存有效期：超过该时长才重新拉公版刷新字典 */
  private readonly WASTE_DB_TTL_MS = 24 * 60 * 60 * 1000;

  /** 不良品项字典（code 编号 / name 名称），供报工选择不良品项映射编号提交 */
  async getWasteItems(): Promise<{ code: string; name: string }[]> {
    if (this.wasteCache && Date.now() - this.wasteCache.at < this.WASTE_CACHE_MS) {
      return this.wasteCache.data;
    }
    const rows = await this.wasteItems.find();
    const fresh = rows.some((r) => r.syncedAt && Date.now() - new Date(r.syncedAt).getTime() < this.WASTE_DB_TTL_MS);
    let items = rows.map((r) => ({ code: r.code, name: r.name }));
    if (!fresh || !items.length) {
      try {
        const { data } = await this.kgdClient.listWebWasteItems();
        const fetched = (data ?? [])
          .filter((w: any) => w?.code != null && w?.name != null)
          .map((w: any) => ({ code: String(w.code), name: String(w.name) }));
        if (fetched.length) {
          // 覆盖式刷新：写入时带 syncedAt，upsert 才会更新该列（TypeORM 只更新实体对象出现的列）
          await this.wasteItems.upsert(
            fetched.map((f) => ({ code: f.code, name: f.name, syncedAt: new Date() })),
            ['code'],
          );
          items = fetched;
        }
      } catch (e) {
        if (!items.length) throw e; // 数据库为空且公版拉取失败，无法降级
        this.logger.warn(`不良品项字典公版刷新失败，降级返回本地缓存: ${(e as Error).message}`);
      }
    }
    this.wasteCache = { data: items, at: Date.now() };
    return items;
  }
}
