# 快工单 OpenAPI 映射清单

本文档列出快工单 OpenAPI（`https://api.kgd.ltd`）全部接口在主系统（快工单工序细化管理系统）中的映射关系。

## 说明

- **主系统封装**：`server/src/kgd/kgd-client.service.ts` 中的方法（统一处理 `X-TOKEN` 注入、凭证失效自动重登、`success=false` 抛错）。
- **开放接口层**：`server/src/report-data/report-data.controller.ts` 通过 `/api/report-data/*` 对外暴露（`X-API-Key` 鉴权）。
- 所有接口为 `POST` + JSON Body（唯一例外：上传附件为 `multipart/form-data`）。

## 完整映射表

### 登录鉴权（由 `KgdAuthService` 处理，无需手工调用）

| 快工单接口 | 说明 | 处理位置 |
|---|---|---|
| 获取授权凭证 | 根据 ApiKey/ApiSecret 获取 access_token，有效期 2 小时 | `kgd-auth.service.ts`（自动缓存与刷新） |
| 登录鉴权 | 用 access_token + 用户名登录，返回 X-TOKEN | `kgd-auth.service.ts` |

### 用户 / 商品 / 工序

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 用户列表 | `/open_api/user/list` | `listUsers` | `/users`（GET）✅、`/user/list`（POST）✅ |
| 商品列表 | `/open_api/goods/list` | `listGoods` | `/goods`（GET，本地包装）✅、`/goods/list`（POST，快工单原样透传，扩展用）✅ |
| 商品新增 | `/open_api/goods/add` | `addGoods` | `/goods/add`（POST）✅ |
| 商品编辑 | `/open_api/goods/edit` | `editGoods` | `/goods/edit`（POST）✅ |
| 工序列表 | `/open_api/pub_craft/list` | `listCrafts` | `/crafts`（GET）✅ |
| 工序新增 | `/open_api/pub_craft/add` | `addCraft` | `/crafts/add`（POST）✅ |
| 工序编辑 | `/open_api/pub_craft/edit` | `editCraft` | `/crafts/edit`（POST）✅ |

### 加工单 / 生产任务

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 加工单列表 | `/open_api/produce_bill/list` | `listProduceBills` | `/produce-bills`（GET）✅ |
| 加工单新增 | `/open_api/produce_bill/add` | `addProduceBill` | `/produce-bills/add`（POST）✅ |
| 加工单编辑 | `/open_api/produce_bill/edit` | `editProduceBill` | `/bill`（POST）✅ |
| 加工单状态修改 | `/open_api/produce_bill/edit_status` | `editProduceBillStatus` | `/produce-bills/status`（POST）✅ |
| 生产任务列表 | `/open_api/produce_bill_craft/list` | `listTasks` | `/tasks`、`/task`（GET）✅ |
| 生产任务状态修改 | `/open_api/produce_bill_craft/edit_status` | `editTaskStatus` | `/tasks/status`（POST）✅ |

### 报工

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 报工记录列表 | `/open_api/report_work_record/list` | `listReportRecords` | `/day-reports`（GET，本地包装）✅、`/reports/list`（POST，原样透传）✅ |
| 新增报工记录 | `/open_api/report_work_record/add` | `addReportWorkRecord` | `/reports/add`（POST）✅ |
| 编辑报工记录 | `/open_api/report_work_record/edit` | `editReportWorkRecord` | `/reports/edit`（POST）✅ |

### 客户 / 供应商

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 客户列表 | `/open_api/customer/list` | `listCustomers` | `/customer/list`（POST）✅ |
| 客户新增 | `/open_api/customer/add` | `addCustomer` | `/customer/add`（POST）✅ |
| 供应商列表 | `/open_api/supplier/list` | `listSuppliers` | `/supplier/list`（POST）✅ |
| 供应商新增 | `/open_api/supplier/add` | `addSupplier` | `/supplier/add`（POST）✅ |

### 出入库单（仓库管理）

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 其他出库单列表 | `/open_api/else_stock_out_bill/list` | `listElseStockOutBills` | `/else-stock-out/list`（POST）✅ |
| 其他出库单新增 | `/open_api/else_stock_out_bill/add` | `addElseStockOutBill` | `/else-stock-out/add`（POST）✅ |
| 其他入库单列表 | `/open_api/else_stock_in_bill/list` | `listElseStockInBills` | `/else-stock-in/list`（POST）✅ |
| 其他入库单新增 | `/open_api/else_stock_in_bill/add` | `addElseStockInBill` | `/else-stock-in/add`（POST）✅ |
| 成品入库单列表 | `/open_api/produce_stock_in_bill/list` | `listProduceStockInBills` | `/produce-stock-in/list`（POST）✅ |
| 成品入库单新增 | `/open_api/produce_stock_in_bill/add` | `addProduceStockInBill` | `/produce-stock-in/add`（POST）✅ |

### 合同 / 附件

| 快工单接口 | 路径 | 主系统封装方法 | 开放接口层 |
|---|---|---|---|
| 合同列表 | `/open_api/customer_contract/list` | `listContracts` | `/contract/list`（POST）✅ |
| 合同新增 | `/open_api/customer_contract/add` | `addContract` | `/customer_contract/add`（POST，兼容旧扩展）✅、`/contract/add`（POST）✅ |
| 合同修改 | `/open_api/customer_contract/edit` | `editContract` | `/contract/edit`（POST）✅ |
| 上传附件 | `/open_api/upload/file` | `uploadFile(buffer, filename)` | `/upload`（POST，multipart）✅ |

## 使用示例

```ts
// 注入 KgdClientService（构造函数参数即可）
async demo(kgd: KgdClientService) {
  // 列表类（透传分页/过滤参数）
  const customers = await kgd.listCustomers({ keyword: '某某', is_enable: 1 });
  // 新增类（Body 结构见快工单 Apifox 文档）
  await kgd.addGoods({ name: '新商品', unit_name: '个', source: 1 });
  // 上传附件（multipart）
  const file = await kgd.uploadFile(buffer, '报表.png');
  // 之后可把 file.url 填入各接口的 attachments 字段
}
```

## 注意事项

1. **写操作安全**：所有 `add*/edit*` 方法会真实修改快工单数据，如需对外暴露请先评估权限与校验。
2. **上传附件**：`/open_api/upload/file` 为 `multipart/form-data`，是唯一非 JSON 接口；上传得到的 `url` 用于其他接口的 `attachments` 字段。
3. **新增/编辑请求体差异**：各接口必填字段不同（如商品新增必填 `name`、加工单新增必填 `goods_id`+`num`、合同新增必填较多），调用前请对照快工单 Apifox 文档确认。
4. **开放接口层**：已实现**快工单 OpenAPI 全部业务接口的全量映射**（上表全部 ✅，共 26 个业务接口 + 2 个登录鉴权），统一 `X-API-Key` 鉴权、响应统一 `{success, data}` / `{success:false, msg}`。查询类接口既有本地包装版本（如 GET `/goods`、GET `/day-reports`），也有快工单原样透传版本（如 POST `/goods/list`、POST `/reports/list`），按需选择。
5. **工序顺序**：`/api/report-data/craft-orders` 不在上表，其数据源是**公版 Web 接口**（order_number 真实工艺顺序，经同步校准写入本地 `craft_seq`），非 `https://api.kgd.ltd/open_api/*`，参数与返回结构见《开放接口使用说明》。
