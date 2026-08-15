<template>
  <div class="page dashboard">
    <!-- 顶部栏 -->
    <header class="header">
      <div class="header-inner">
        <div class="header-left">
          <img class="header-logo" :src="logoUrl" alt="公司 Logo" />
          <div class="header-text">
            <h1 class="title">工作台</h1>
            <p class="subtitle">{{ greeting }}</p>
          </div>
        </div>
        <div class="header-right">
          <button class="theme-toggle" aria-label="切换深色模式" :class="{ anim: themeAnim }" @click="onToggleTheme">
            <span class="toggle-icon"><el-icon :size="18"><Moon v-if="isDark" /><Sunny v-else /></el-icon></span>
          </button>
          <el-button circle plain class="round-btn" :class="{ spinning: refreshing }" aria-label="刷新工作台数据（短按增量同步，长按全量同步）" @pointerdown="onRefreshPress" @contextmenu.prevent>
            <el-icon :size="20"><Refresh /></el-icon>
          </el-button>
          <el-dropdown popper-class="user-popper" @command="onCommand">
            <div class="avatar" :aria-label="auth.user?.name">{{ avatarChar }}</div>
            <template #dropdown>
              <el-dropdown-menu>
                <!-- 用户信息头：头像 + 姓名 + 岗位 -->
                <div class="up-head">
                  <div class="up-avatar">{{ avatarChar }}</div>
                  <div class="up-id">
                    <div class="up-name">{{ auth.user?.name }}</div>
                    <div class="up-role">{{ roleNameText }}</div>
                  </div>
                </div>
                <!-- 权限说明：图标化区分管理员 / 工人 -->
                <div class="up-perm">
                  <el-icon :size="14"><component :is="isAdmin ? 'Lock' : 'User'" /></el-icon>
                  <span>{{ permissionText }}</span>
                </div>
                <!-- 管理员专属：管理员界面/数据大屏入口（admin + 车间主管可见） -->
                <el-dropdown-item v-if="canAdmin" command="admin">
                  <el-icon :size="14"><Setting /></el-icon>{{ auth.user?.role === 'manager' ? '数据大屏' : '管理员界面' }}
                </el-dropdown-item>
                <el-dropdown-item command="profile">
                  <el-icon :size="14"><User /></el-icon>个人中心
                </el-dropdown-item>
                <el-dropdown-item divided command="logout" class="up-logout">
                  <el-icon :size="14"><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <div class="content">
      <!-- 工序入口 -->
      <section class="craft-grid">
        <div
          v-for="c in craftCards"
          :key="c.name"
          class="craft-card"
          :class="{ 'is-biancheng': c.name === '编程' }"
          @click="goCraft(c.name)"
        >
          <div class="craft-card-top">
            <span class="icon-tile"><el-icon :size="20"><component :is="c.icon" /></el-icon></span>
            <span v-if="c.total > 0" class="badge">{{ c.total }}</span>
          </div>
          <div class="card-name">{{ c.name }}</div>
          <div class="card-desc">{{ c.desc }}</div>
        </div>
      </section>

      <!-- 今日概况 -->
      <section class="overview-card">
        <div class="ov-block" @click="switchTab('1')">
          <span class="ov-val pending">{{ summary.statusCount.unstarted }}</span>
          <span class="ov-key">未开工</span>
        </div>
        <div class="ov-block" @click="switchTab('2')">
          <span class="ov-val doing">{{ summary.statusCount.doing }}</span>
          <span class="ov-key">进行中</span>
        </div>
        <div class="ov-block" @click="switchTab('3')">
          <span class="ov-val done">{{ summary.statusCount.done }}</span>
          <span class="ov-key">已完成</span>
        </div>
      </section>

      <!-- 生产任务 -->
      <main class="task-area">
        <div class="task-head">
          <h2 class="task-title">生产任务</h2>
          <span class="task-count">共 {{ total }} 单</span>
        </div>

        <el-input
          v-model="keyword"
          class="task-search"
          size="large"
          clearable
          placeholder="搜索 HT图号 / 产品名"
          @input="onSearchInput"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <div class="seg-control">
          <button
            v-for="t in tabs"
            :key="t.key"
            class="seg-btn"
            :class="{ active: activeTab === t.key }"
            @click="switchTab(t.key)"
          >
            {{ t.label }}
            <span class="seg-count">{{ tabCount(t) }}</span>
          </button>
        </div>

        <el-skeleton v-if="firstLoad" :rows="3" animated />
        <el-empty v-else-if="!list.length" :description="`暂无${currentTab.label}的任务`" />
        <template v-else>
          <section v-for="g in groups" :key="g.htNo" class="ht-group" :class="{ open: expandedHt === g.htNo }">
            <div class="ht-header" @click="toggleGroup(g.htNo)">
              <span class="ht-no">{{ g.htNo }}</span>
              <span v-if="g.goodsName" class="ht-goods">{{ g.goodsName }}</span>
              <span class="ht-right">
                  <span v-if="g.deliveryDate" class="delivery-chip">交期 {{ shortDate(g.deliveryDate) }}</span>
                  <el-icon :size="16" class="ht-chevron"><ArrowDown /></el-icon>
                </span>
            </div>
            <div v-show="expandedHt === g.htNo" class="ht-body">
              <div class="task-grid">
                <TaskCard v-for="t in g.items" :key="t.id" :task="t" @report="openReport" @changed="refresh" />
              </div>
            </div>
          </section>
          <div
              v-infinite-scroll="loadMore"
              :infinite-scroll-disabled="infiniteDisabled"
              :infinite-scroll-distance="120"
              class="load-more"
            >
              <el-icon v-if="loadingMore" class="is-loading"><Loading /></el-icon>
              <span v-if="loadedAll">已加载全部（共 {{ total }} 单）</span>
              <span v-else-if="loadingMore">加载中…</span>
              <span v-else>下滑加载更多</span>
            </div>
          </template>
        </main>
    </div>

    <!-- 移动端浮动刷新 -->
    <footer class="floating-refresh">
      <button class="refresh-pill" :disabled="refreshing" @pointerdown="onRefreshPress" @contextmenu.prevent>
        <el-icon :size="18"><Refresh /></el-icon>
        {{ refreshing ? '同步中…' : '刷新数据' }}
      </button>
    </footer>

    <ReportDialog v-model:visible="reportVisible" :task="reportTask" @success="refresh" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import TaskCard from '../components/TaskCard.vue'
import ReportDialog from '../components/ReportDialog.vue'
import logoUrl from '../assets/logo-md.jpg'
import { isDark as getDark, toggleTheme } from '../utils/theme'

const router = useRouter()
const auth = useAuthStore()

const crafts = ref([])
const summary = ref({ statusCount: { unstarted: 0, doing: 0, done: 0, total: 0 }, craftCount: {}, bianchengBillCount: 0 })
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false) // 是否已有请求进行中（防止重复触发）
const loadingMore = ref(false) // 是否正在加载更多
const loadedAll = ref(false) // 是否已加载全部
const keyword = ref('') // 模糊搜索关键词（HT图号/产品名）
const activeTab = ref('all')
const firstLoad = ref(true)
const refreshing = ref(false)
const reportVisible = ref(false)
const reportTask = ref(null)

/** 无限滚动禁用条件：加载中 / 已加载全部 / 列表为空 */
const infiniteDisabled = computed(() => loadingMore.value || loadedAll.value || !list.value.length)

const tabs = [
  { key: 'all', label: '全部', status: '1,2' },
  { key: '1', label: '未开工', status: 1 },
  { key: '2', label: '进行中', status: 2 },
  { key: '3', label: '已完成', status: 3 },
]
const currentTab = computed(() => tabs.find((t) => t.key === activeTab.value))

const avatarChar = computed(() => auth.user?.name?.[0] || '工')

/* ===== 主题切换 ===== */
const isDark = ref(getDark())
const themeAnim = ref(false)

function onToggleTheme(e) {
  themeAnim.value = false
  // 触发图标旋转动画
  requestAnimationFrame(() => {
    themeAnim.value = true
  })
  window.setTimeout(() => (themeAnim.value = false), 500)
  isDark.value = toggleTheme(e?.currentTarget)
}

const isAdmin = computed(() => auth.user?.role === 'admin')
/** 可进入管理员界面/数据大屏：系统管理员 + 车间主管 */
const canAdmin = computed(() => ['admin', 'manager'].includes(auth.user?.role))

/** 岗位名：优先显示快工单岗位（如 生产班长），无则按系统角色兜底 */
const roleNameText = computed(
  () =>
    auth.user?.roleName ||
    (auth.user?.role === 'admin' ? '管理员' : auth.user?.role === 'manager' ? '车间主管' : '工人'),
)

/** 当前权限说明（随系统角色变化） */
const permissionText = computed(() =>
  auth.user?.role === 'admin'
    ? '管理员：可查看全部任务与工序'
    : auth.user?.role === 'manager'
      ? '车间主管：可查看数据大屏'
      : '工人：工作台仅查看本人任务',
)

const greeting = computed(() => {
  const d = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const h = d.getHours()
  const part = h < 6 ? '凌晨好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  return `${part}，${auth.user?.name || '师傅'} · ${d.getMonth() + 1}/${d.getDate()} ${week}`
})

/** 当前页任务按 HT图号 分组（稳定归组，保持首次出现的顺序），并汇总该图号下的计划数 */
const groups = computed(() => {
  const out = []
  const byHt = new Map()
  for (const t of list.value) {
    const key = t.htNo || '未标注图号'
    let g = byHt.get(key)
    if (!g) {
      g = { htNo: key, goodsName: t.goodsName, items: [], planNums: [], deliveryDate: null }
      byHt.set(key, g)
      out.push(g)
    }
    g.items.push(t)
    if (t.num != null && t.num !== '') g.planNums.push(t.num)
  }
  // 分组交期取组内最早的有效交期（列表已按交期排序）
  for (const g of out) {
    const dates = g.items.map((i) => i.deliveryDate).filter((d) => d).sort()
    if (dates.length) g.deliveryDate = dates[0]
  }
  return out
})

/** 当前展开的图号分组（手风琴：一次只展开一个） */
const expandedHt = ref(null)

function toggleGroup(htNo) {
  expandedHt.value = expandedHt.value === htNo ? null : htNo
}

// 数据加载后默认展开第一个分组（手风琴）
watchEffect(() => {
  const gs = groups.value
  if (gs.length && !gs.some((g) => g.htNo === expandedHt.value)) {
    expandedHt.value = gs[0].htNo
  }
})

// 工序图标映射（Element Plus 图标组件名）
const craftIcons = { 编程: 'Cpu', 雕刻: 'EditPen', 打码: 'PriceTag', 打磨: 'Tools', 涂层: 'Brush', 领料: 'Box' }
const craftDescs = {
  编程: '加工单未开始的订单',
  雕刻: '雕刻工序任务管理',
  打码: '打码工序任务管理',
  打磨: '打磨工序任务管理',
  涂层: '涂层工序任务管理',
  领料: '领料工序任务管理',
}

const craftCards = computed(() => {
  return crafts.value.map((c) => {
    let count
    if (c.name === '编程') {
      count = summary.value.bianchengBillCount
    } else {
      // 未完成任务数（未开始 + 进行中 + 已暂停），由 summary 接口统计
      count = summary.value.craftCount[c.name] ?? 0
    }
    return {
      name: c.name,
      icon: craftIcons[c.name] ?? 'Files',
      desc: craftDescs[c.name] ?? `${c.name}工序任务管理`,
      total: count,
    }
  })
})

function tabCount(tab) {
  if (tab.key === 'all') {
    // 全部 = 未开始 + 进行中
    return summary.value.statusCount.unstarted + summary.value.statusCount.doing
  }
  const map = { 1: 'unstarted', 2: 'doing', 3: 'done' }
  return summary.value.statusCount[map[tab.key]] ?? 0
}

async function loadCrafts() {
  crafts.value = await api.get('/crafts/mine')
}

async function loadSummary() {
  summary.value = await api.get('/tasks/summary')
}

async function loadTasks(append = false) {
  if (loading.value) return
  loading.value = true
  loadingMore.value = append
  try {
    const params = { page: page.value, pageSize }
    const tab = currentTab.value
    if (tab?.status !== undefined) params.status = tab.status
    const kw = keyword.value.trim()
    if (kw) params.keyword = kw
    const data = await api.get('/tasks/mine', { params })
    const rows = data.list ?? []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data.total
    loadedAll.value = list.value.length >= data.total
    firstLoad.value = false
  } catch {
    /* 错误拦截器已提示 */
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function switchTab(key) {
  if (activeTab.value === key) return
  activeTab.value = key
  page.value = 1
  loadedAll.value = false
  list.value = []
  loadTasks()
}

/** 下滑到底部时加载下一页（追加到列表尾部） */
async function loadMore() {
  if (loading.value || loadedAll.value) return
  page.value += 1
  await loadTasks(true)
}

// 模糊搜索：输入防抖 300ms 后重置到第一页重新查询
let searchTimer = null
function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadedAll.value = false
    list.value = []
    loadTasks()
  }, 300)
}

async function refresh() {
  refreshing.value = true
  try {
    await loadCrafts().catch(() => undefined)
    await Promise.all([loadTasks(), loadSummary()])
  } finally {
    refreshing.value = false
  }
}

/** 手动刷新：短按=增量同步（默认，约 0.6s），报工记录额外覆盖最近 3 天（完善近期被修改/漏同步的报工）；
 *  长按(≥600ms)=全量同步（约 10-13s），全量会清理远程已删除的记录 */
async function syncAndReload(full = false) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await api.post('/tasks/sync', null, {
      params: full ? { full: 1 } : { days: 3 },
      timeout: full ? 120000 : 60000,
    })
    ElMessage.success(full ? '全量同步完成' : '数据已同步')
  } catch {
    ElMessage.warning('数据同步失败，显示缓存数据')
  }
  refreshing.value = false
  await refresh()
}

/** 长按(≥600ms)触发全量同步；未满 600ms 松开则按短按增量同步 */
const LONG_PRESS_MS = 600
function onRefreshPress(e) {
  if (refreshing.value || e.button !== 0) return
  const el = e.currentTarget
  let longTriggered = false
  const timer = setTimeout(() => {
    longTriggered = true
    syncAndReload(true)
  }, LONG_PRESS_MS)
  const release = () => {
    clearTimeout(timer)
    if (!longTriggered) syncAndReload(false)
  }
  const cancel = () => clearTimeout(timer)
  el.addEventListener('pointerup', release, { once: true })
  el.addEventListener('pointerleave', cancel, { once: true })
  el.addEventListener('pointercancel', cancel, { once: true })
}

function goCraft(name) {
  router.push(`/craft/${encodeURIComponent(name)}`)
}

function openReport(task) {
  reportTask.value = task
  reportVisible.value = true
}

function onCommand(cmd) {
  if (cmd === 'logout') {
    auth.logout()
    router.push('/login')
  } else if (cmd === 'admin') {
    router.push('/admin')
  } else if (cmd === 'profile') {
    router.push('/profile')
  }
}

/** 交期简化为 M/D，如 2026-08-10 → 8/10 */
function shortDate(v) {
  if (!v) return ''
  const [, m, d] = String(v).split('-')
  return m && d ? `${+m}/${+d}` : v
}

onMounted(() => {
  // 管理员/车间主管且未被分配任何工序：默认进入管理员界面（而非空工作台）
  if (['admin', 'manager'].includes(auth.user?.role) && auth.user?.hasCraft === false) {
    router.replace('/admin')
    return
  }
  refresh()
  // 刷新当前用户信息（岗位/权限可能已变化，登录后首次进入也能拿到最新）
  api
    .get('/auth/me')
    .then((me) => {
      if (me) auth.setUser({ ...auth.user, ...me, id: auth.user?.id ?? me?.sub })
    })
    .catch(() => undefined)
})
</script>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.header-inner {
  max-width: 1024px;
  margin: 0 auto;
  padding: 12px 16px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.header-logo {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  object-fit: cover;
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.header-text {
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--foreground);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--muted-foreground);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.round-btn {
  width: 38px;
  height: 38px;
  border-radius: 999px !important;
}

.avatar {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--primary);
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning :deep(.el-icon) {
  animation: spin 0.8s linear infinite;
}

.content {
  max-width: 1024px;
  margin: 0 auto;
  padding: 24px 20px 32px;
}

/* ===== 工序入口 ===== */

.craft-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.craft-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.craft-card:active {
  transform: scale(0.98);
}

.craft-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.icon-tile {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--destructive);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.card-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--foreground);
}

.card-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 今日概况 ===== */

.overview-card {
  margin-top: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  overflow: hidden;
}

.ov-block {
  flex: 1;
  text-align: center;
  padding: 18px 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.ov-block:hover {
  background: var(--muted);
}

.ov-block + .ov-block {
  border-left: 1px solid var(--border);
}

.ov-val {
  display: block;
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
}

.ov-key {
  display: block;
  font-size: 13px;
  color: var(--muted-foreground);
  margin-top: 4px;
}

.ov-block.pending .ov-val { color: var(--warning); }
.ov-block.doing .ov-val { color: var(--primary); }
.ov-block.done .ov-val { color: var(--success); }

/* ===== 生产任务 ===== */

.task-area {
  margin-top: 28px;
}

.task-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.task-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--foreground);
}

.task-count {
  font-size: 13px;
  color: var(--muted-foreground);
}

.seg-control {
  margin-top: 14px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--muted);
}

.task-search {
  margin-top: 14px;
}

.seg-btn {
  flex: 1;
  height: 38px;
  border: none;
  background: transparent;
  border-radius: 999px;
  font-size: 13px;
  color: var(--muted-foreground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  transition: all 0.15s;
}

.seg-btn.active {
  background: var(--card);
  color: var(--foreground);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}

.seg-count {
  font-size: 12px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* ===== HT图号 分组 ===== */

.ht-group {
  margin-top: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.ht-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.ht-header:hover {
  background: var(--muted);
}

.ht-no {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.ht-goods {
  font-size: 13px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ht-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ht-plan {
  font-size: 13px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.delivery-chip {
  font-size: 12px;
  color: var(--secondary-foreground);
  background: var(--secondary);
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

.ht-chevron {
  color: var(--muted-foreground);
  transition: transform 0.2s;
}

.ht-group.open .ht-chevron {
  transform: rotate(180deg);
}

.ht-body {
  border-top: 1px solid var(--border);
  padding: 12px;
}

.task-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.load-more {
  margin-top: 20px;
  padding: 14px 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted-foreground);
}

.load-more .is-loading {
  animation: spin 0.8s linear infinite;
}

/* ===== 移动端浮动刷新 ===== */

.floating-refresh {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  padding: 0 20px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: center;
  pointer-events: none;
  display: none;
}

.refresh-pill {
  pointer-events: auto;
  height: 48px;
  padding: 0 24px;
  border: none;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px -8px rgba(0, 122, 255, 0.4);
  cursor: pointer;
  transition: transform 0.12s;
}

.refresh-pill:active {
  transform: scale(0.98);
}

.refresh-pill:disabled {
  opacity: 0.7;
}

@media (min-width: 640px) {
  .craft-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .task-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .floating-refresh {
    display: flex;
  }

  .task-area {
    padding-bottom: 40px;
  }
}
</style>
