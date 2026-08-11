# 快工单工序细化管理系统

面向「快工单」ERP 的移动端工序管理平台：将粗粒度的加工单拆分为可逐工序跟踪的生产任务，供车间工人按工序（编程 / 雕刻 / 打磨 / 涂层 / 打码 / 领料）查看、开工、报工，管理者在仪表盘实时掌握每张加工单的工序进度。

## 功能特性

- **工序工作台**：按工序划分独立页面，按状态（全部 / 未开工 / 进行中 / 已完成）筛选任务
- **工序链门控**：同一加工单按工艺顺序展示工序，前序工序未开始且有报工时，后序工序自动隐藏；无编程工序的单据由加工单级「编程完成」门控第一步
- **工序进度条**：每张任务卡展示整张加工单的工序链进度（如 `编程 100% → 雕刻 60% → 打磨 0%`），当前工序高亮
- **报工管理**：任务级报工（良品 / 不良），本地缓存直更、秒级可见
- **编程工序**：加工单「未编程 / 进行中」分栏，一键完成编程或撤回
- **模糊搜索**：按 HT 图号 / 产品名检索任务
- **无限滚动**：列表下滑自动加载更多
- **统计看板**：未开工 / 进行中 / 已完成数量，与任务列表口径一致（自动排除被锁定工序）
- **认证自愈**：快工单凭证失效时自动重新登录并重试请求，无需人工干预
- **数据同步**：启动 8 秒后自动全量同步，此后每 5 分钟增量同步；本地缓存查询秒级响应

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + Vite + Element Plus + Pinia + Vue Router |
| 后端 | NestJS + TypeORM |
| 数据库 | MySQL 8.0（`kgd_process`） |
| 数据源 | 快工单 OpenAPI（`https://api.kgd.ltd`） |
| 部署 | Docker / docker-compose（nginx 托管前端并反代后端） |

## 目录结构

```
快工单工序细化管理系统/
├── web/                        # 前端 Vue3 应用
│   ├── src/views/              # 页面：登录 / 工作台 / 工序工作台
│   ├── src/components/         # 任务卡、报工弹窗、报工记录弹窗
│   ├── src/api/                # axios 实例（统一 /api 前缀与鉴权）
│   ├── src/router/             # 路由（history 模式）
│   └── Dockerfile / nginx.conf # 前端容器化
├── server/                     # 后端 NestJS 服务
│   ├── src/auth/               # 本地账号、JWT 登录、快工单用户同步
│   ├── src/kgd/                # 快工单 OpenAPI 对接、凭证管理、数据同步
│   ├── src/tasks/              # 任务 / 加工单接口、工序链门控、工序进度
│   ├── src/report/             # 报工接口
│   ├── src/crafts/             # 工序列表
│   └── Dockerfile              # 后端容器化
├── docker-compose.yml          # 一键编排：MySQL + 后端 + 前端
└── .env                        # 快工单 API 凭证（KGD_*）
```

## 端口规划

| 服务 | 开发环境 | Docker 环境 |
| --- | --- | --- |
| 前端 | `http://localhost:5173` | `http://<服务器IP>:8080`（`WEB_PORT` 可改） |
| 后端 API | `http://localhost:3000/api` | 容器内 3000，经 nginx `/api` 转发 |
| MySQL | `localhost:3306` | `MYSQL_PORT`（默认 3306） |

---

## 快速开始（本地开发）

### 前置要求

- Node.js ≥ 20.19
- npm ≥ 10
- MySQL 8.0（本机或使用 `docker compose up -d mysql` 启动容器版）
- 快工单 OpenAPI 凭证（`KGD_API_KEY` / `KGD_API_SECRET`，已配置在 `.env`）

### 1. 启动数据库

仅启动 MySQL 容器（复用本仓库的 compose 文件）：

```bash
docker compose up -d mysql
```

数据库 `kgd_process`、账号 `kgd / kgd123456` 会自动创建。若本机 3306 已被占用，可改用本机 MySQL 并手动建库：

```sql
CREATE DATABASE IF NOT EXISTS kgd_process DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 启动后端

```bash
cd server
npm install
npm run build
node --enable-source-maps dist/main   # 或 npm run start:dev 热重载
```

启动后会自动：同步快工单用户到本地账号（默认密码 `kgd123456`）、同步加工单与任务缓存（约 8 秒后，此后每 5 分钟增量同步）。

### 3. 启动前端

```bash
cd web
npm install
npm run dev
```

开发环境下 Vite 已将 `/api` 代理到 `http://localhost:3000`。

### 4. 访问

浏览器打开 `http://localhost:5173`，使用任意已同步的用户名登录（例如 `高晨翔`，密码 `kgd123456`）。

---

## Docker 部署

### 一键部署（推荐）

在项目根目录执行：

```bash
docker compose up -d --build
```

启动顺序：MySQL（健康检查通过）→ 后端（健康检查通过）→ 前端。首次构建需要拉取 Node / nginx / MySQL 镜像，耗时较长。

部署完成后访问：

```
http://<服务器IP>:8080        # 前端
http://<服务器IP>:3000/api    # 后端 API（直连，可选）
```

### 首次启动会自动完成

1. **建表**：TypeORM `synchronize` 自动创建全部表结构
2. **同步用户**：从快工单同步工人账号（默认密码 `kgd123456`）
3. **同步数据**：启动 8 秒后拉取加工单与任务到本地缓存，每 5 分钟增量更新
4. **凭证获取**：首次访问快工单 API 时自动登录并缓存凭证，失效后自动重登

### 部署在服务器上

```bash
# 1. 安装 Docker 与 compose 插件（略）

# 2. 上传项目代码（含 .env 与 server/.env）

# 3. 确认 .env 中快工单凭证正确
cat .env        # KGD_API_KEY / KGD_API_SECRET / KGD_USERNAME

# 4. 构建并启动
docker compose up -d --build

# 5. 查看启动日志，确认无报错
docker compose logs -f server

# 6. 防火墙放行 8080（及可选 3000）
```

### 更新部署

代码更新后重新构建并滚动重启：

```bash
git pull                        # 拉取最新代码
docker compose up -d --build    # 仅重建变更的服务
```

### 常用运维命令

```bash
docker compose ps                # 查看服务状态
docker compose logs -f server    # 跟踪后端日志
docker compose logs -f web       # 跟踪前端日志
docker compose down              # 停止（保留数据卷）
docker compose down -v           # 停止并删除数据库数据（慎用！）
```

### 数据备份

MySQL 数据存放在命名卷 `mysql_data` 中，备份示例：

```bash
docker compose exec mysql sh -c 'mysqldump -ukgd -pkgd123456 kgd_process' > backup_$(date +%Y%m%d).sql
```

### 自定义配置

端口与密钥通过环境变量覆盖（写入项目根目录 `.env`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `8080` | 前端访问端口 |
| `SERVER_PORT` | `3000` | 后端 API 端口 |
| `MYSQL_PORT` | `3306` | MySQL 宿主机映射端口 |
| `MYSQL_ROOT_PASSWORD` | `root123456` | MySQL root 密码 |
| `MYSQL_PASSWORD` | `kgd123456` | 业务账号 `kgd` 的密码 |
| `JWT_SECRET` | `kgd-process-secret-key-2026` | 本地登录 JWT 签名密钥（生产请务必修改） |
| `KGD_BASE_URL` | `https://api.kgd.ltd` | 快工单 OpenAPI 地址 |
| `KGD_API_KEY` | — | 快工单 API Key（必填） |
| `KGD_API_SECRET` | — | 快工单 API Secret（必填） |
| `KGD_USERNAME` | — | 快工单登录用户名（必填） |

> 后端单独运行（非 Docker）时，请直接修改 `server/.env` 中的 `DB_*`、`KGD_*` 配置。

---

## 环境变量说明

后端通过环境变量读取配置（见 `server/src/config/configuration.ts`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端监听端口 |
| `KGD_BASE_URL` | `https://api.kgd.ltd` | 快工单 OpenAPI 基地址 |
| `KGD_API_KEY` | — | 快工单 API Key |
| `KGD_API_SECRET` | — | 快工单 API Secret |
| `KGD_USERNAME` | — | 快工单用户名（获取 X-TOKEN） |
| `DB_HOST` | `localhost` | MySQL 地址 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USERNAME` | `kgd` | MySQL 用户名 |
| `DB_PASSWORD` | — | MySQL 密码 |
| `DB_DATABASE` | `kgd_process` | 数据库名 |
| `JWT_SECRET` | `kgd-process-secret` | 本地登录 JWT 密钥 |

---

## 常见问题

**Q1：端口被占用 / 本机已有 MySQL？**

- 前端 5173 被占：修改 `web/vite.config.mjs` 的 `server.port`
- Docker 场景 3306 冲突：`.env` 中设 `MYSQL_PORT=3307`（注意 `server/.env` 的 `DB_PORT` 也要同步）

**Q2：登录提示「请登录」/ 接口报 500？**

快工单凭证可能失效。后端已实现自动重登并重试一次；若持续报错，检查 `.env` 中 `KGD_API_KEY` / `KGD_API_SECRET` / `KGD_USERNAME` 是否正确，然后重启后端或点击页面「刷新数据」。

**Q3：任务卡数据不完整 / 没有报工数据？**

数据来自本地缓存，同步每 5 分钟执行一次。可点击页面右上角刷新按钮手动触发即时同步（`POST /api/tasks/sync`）。

**Q4：为什么有些后序工序看不到？**

工序链门控：同一加工单内，前序工序未「开始且有报工」时，后序工序会隐藏；无编程工序的单据，第一步需加工单开始（编程完成）后才显示。这是预期行为。

**Q5：登录密码是什么？**

本地账号由快工单用户自动同步创建，初始密码统一为 `kgd123456`（见 `server/src/auth/auth.service.ts`）。

**Q6：部署后页面能打开但接口 502？**

确认后端容器正常：`docker compose ps` 查看 `server` 是否 healthy；`docker compose logs server` 查看是否完成建表与同步。前端 nginx 通过服务名 `server` 转发 `/api`，需在同一 compose 网络内。
