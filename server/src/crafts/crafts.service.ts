import { Injectable } from '@nestjs/common';
import { KgdClientService } from '../kgd/kgd-client.service';
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
  constructor(private readonly kgdClient: KgdClientService) {}

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

  /** 不良品项字典缓存（5 分钟，避免每次报工弹窗都拉公版接口） */
  private wasteCache: { data: { code: string; name: string }[]; at: number } | null = null;
  private readonly WASTE_CACHE_MS = 5 * 60 * 1000;

  /** 不良品项字典（code 编号 / name 名称），供报工选择不良品项映射编号提交 */
  async getWasteItems(): Promise<{ code: string; name: string }[]> {
    if (this.wasteCache && Date.now() - this.wasteCache.at < this.WASTE_CACHE_MS) {
      return this.wasteCache.data;
    }
    const { data } = await this.kgdClient.listWebWasteItems();
    const items = (data ?? [])
      .filter((w: any) => w?.code != null && w?.name != null)
      .map((w: any) => ({ code: String(w.code), name: String(w.name) }));
    this.wasteCache = { data: items, at: Date.now() };
    return items;
  }
}
