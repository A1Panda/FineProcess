<template>
  <div class="page craft-page">
    <!-- 顶部 -->
    <header class="header">
      <div class="header-inner">
        <el-button circle plain class="round-btn" aria-label="返回主页" @click="router.push('/')">
          <el-icon :size="20"><ArrowLeft /></el-icon>
        </el-button>
        <div class="title">
          <div class="craft-name">{{ craftName }}工序</div>
          <div class="sub">{{ subtitle }}</div>
        </div>
        <el-button circle plain class="round-btn" aria-label="刷新数据（短按增量同步，长按全量同步）" :class="{ spinning: refreshing }" @pointerdown="onRefreshPress" @contextmenu.prevent>
          <el-icon :size="20"><Refresh /></el-icon>
        </el-button>
      </div>
    </header>

    <div class="content">
      <!-- 编程工序：Tab 切换模式（加工单状态分类） -->
      <template v-if="isBiancheng">
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
            v-for="t in bianchengTabs"
            :key="t.key"
            class="seg-btn"
            :class="{ active: activeTab === t.key }"
            @click="switchTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="summary">共 {{ displayItems.length }} 单</p>

        <main class="task-area">
          <el-skeleton v-if="firstLoad" :rows="4" animated />
          <el-empty v-else-if="!displayItems.length" :description="emptyText" />
          <template v-else>
            <section v-for="g in displayGroups" :key="g.htNo" class="ht-group" :class="{ open: expandedHt === g.htNo }">
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
                  <TaskCard
                    v-for="item in g.items"
                    :key="item.produceBillCode"
                    :task="item"
                    :mode="bianchengMode"
                    @bianchengDone="doBianchengDone"
                    @bianchengCancel="doBianchengCancel"
                  />
                </div>
              </div>
            </section>
          </template>
        </main>
      </template>

      <!-- 其他工序：状态 Tab 单独显示，组内按 HT图号 分组 -->
      <template v-else>
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
            v-for="t in craftTabs"
            :key="t.key"
            class="seg-btn"
            :class="{ active: craftTab === t.key }"
            @click="switchCraftTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="summary">共 {{ total }} 项</p>

        <main class="task-area">
          <el-skeleton v-if="firstLoad" :rows="4" animated />
          <el-empty v-else-if="!groups.length" :description="`暂无${currentCraftTab.label}的任务`" />
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
                  <TaskCard v-for="t in g.items" :key="t.id" :task="t" @report="openReport" @changed="load" />
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
              <span v-if="loadedAll">已加载全部（共 {{ total }} 项）</span>
              <span v-else-if="loadingMore">加载中…</span>
              <span v-else>下滑加载更多</span>
            </div>
          </template>
        </main>
      </template>

      <!-- 移动端浮动刷新 -->
      <footer class="floating-refresh">
        <button class="refresh-pill" :disabled="refreshing" @pointerdown="onRefreshPress" @contextmenu.prevent>
          <el-icon :size="18"><Refresh /></el-icon>
          {{ refreshing ? '同步中…' : '刷新数据' }}
        </button>
      </footer>
    </div>

    <ReportDialog v-model:visible="reportVisible" :task="reportTask" @success="load" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import TaskCard from '../components/TaskCard.vue'
import ReportDialog from '../components/ReportDialog.vue'

const route = useRoute()
const router = useRouter()

const craftName = ref(route.params.name || '')

const isBiancheng = computed(() => craftName.value === '编程')

const subtitle = computed(() =>
  isBiancheng.value ? '加工单未开始 = 尚未编程' : '所有加工单该工序的任务',
)

const bianchengTabs = [
  { key: 'pending', label: '未开始（未编程）', status: 1, empty: '暂无未编程的订单' },
  { key: 'inprogress', label: '进行中', status: 2, empty: '暂无进行中的订单' },
]

const activeTab = ref('pending')
const tasks = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false) // 是否已有请求进行中（防止重复触发）
const loadingMore = ref(false) // 是否正在加载更多
const loadedAll = ref(false) // 是否已加载全部
const keyword = ref('') // 模糊搜索关键词（HT图号/产品名）
const firstLoad = ref(true)
const refreshing = ref(false)
const reportVisible = ref(false)
const reportTask = ref(null)

/** 无限滚动禁用条件：加载中 / 已加载全部 / 列表为空（编程页整单加载，无分页） */
const infiniteDisabled = computed(() => loadingMore.value || loadedAll.value || !tasks.value.length)

const emptyText = computed(() => bianchengTabs.find((t) => t.key === activeTab.value)?.empty || '暂无任务')

// 编程：从 produce_bill/list 接口获取，不需要去重；支持前端按关键词过滤（整单已全量返回）
const displayItems = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return tasks.value
  return tasks.value.filter(
    (t) =>
      (t.htNo ?? '').toLowerCase().includes(kw) ||
      (t.goodsName ?? '').toLowerCase().includes(kw),
  )
})

// 编程：按 HT图号 分组
const displayGroups = computed(() => groupByHt(displayItems.value))

// 编程按钮：未开始 tab = 完成，全部 tab = 取消
const bianchengMode = computed(() => {
  if (activeTab.value === 'pending') return 'biancheng'
  return 'biancheng-cancel'
})

/** 按 HT图号 分组（稳定归组，保持首次出现的顺序），并汇总该图号下的计划数 */
function groupByHt(items) {
  const out = []
  const byHt = new Map()
  for (const t of items) {
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
}

/** 当前展开的图号分组（手风琴：一次只展开一个） */
const expandedHt = ref(null)

function toggleGroup(htNo) {
  expandedHt.value = expandedHt.value === htNo ? null : htNo
}

// 其他工序：状态 Tab（单独显示，一次只显示一种状态）
const craftTabs = [
  { key: 'all', label: '全部', status: '1,2' },
  { key: '1', label: '未开工', status: 1 },
  { key: '2', label: '进行中', status: 2 },
  { key: '3', label: '已完成', status: 3 },
]
const craftTab = ref('all')
const currentCraftTab = computed(() => craftTabs.find((t) => t.key === craftTab.value))

// 其他工序：当前页任务按 HT图号 分组
const groups = computed(() => groupByHt(tasks.value))

// 数据加载后默认展开第一个分组（手风琴）
watchEffect(() => {
  const gs = groups.value
  if (gs.length && !gs.some((g) => g.htNo === expandedHt.value)) {
    expandedHt.value = gs[0].htNo
  }
})

function switchCraftTab(key) {
  craftTab.value = key
  page.value = 1
  loadedAll.value = false
  tasks.value = []
  load()
}

function switchTab(key) {
  activeTab.value = key
  load()
}

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  loadingMore.value = append
  try {
    if (isBiancheng.value) {
      // 编程：从 produce_bill/list 接口查询（整单返回，无分页）
      const url = activeTab.value === 'pending' ? '/tasks/unstarted-bills' : '/tasks/in-progress-bills'
      tasks.value = await api.get(url)
      loadedAll.value = true
    } else {
      const params = { all: 'true', craftName: craftName.value, page: page.value, pageSize }
      const tab = currentCraftTab.value
      if (tab?.status !== undefined) params.status = tab.status
      const kw = keyword.value.trim()
      if (kw) params.keyword = kw
      const data = await api.get('/tasks/mine', { params })
      const rows = data.list ?? []
      tasks.value = append ? [...tasks.value, ...rows] : rows
      total.value = data.total
      loadedAll.value = tasks.value.length >= data.total
    }
    firstLoad.value = false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 下滑到底部时加载下一页（追加到列表尾部） */
async function loadMore() {
  if (loading.value || loadedAll.value) return
  page.value += 1
  await load(true)
}

// 模糊搜索：编程页由 displayItems 前端即时过滤；其他工序页防抖 300ms 后重置到第一页重新查询
let searchTimer = null
function onSearchInput() {
  if (isBiancheng.value) return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadedAll.value = false
    tasks.value = []
    load()
  }, 300)
}

/** 手动刷新：短按=增量同步（默认，约 0.6s），报工记录额外覆盖最近 3 天（完善近期被修改/漏同步的报工）；
 *  长按(≥600ms)=全量同步（约 10-13s），全量会清理远程已删除的记录 */
async function manualRefresh(full = false) {
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
  await load()
}

/** 长按(≥600ms)触发全量同步；未满 600ms 松开则按短按增量同步 */
const LONG_PRESS_MS = 600
function onRefreshPress(e) {
  if (refreshing.value || e.button !== 0) return
  const el = e.currentTarget
  let longTriggered = false
  const timer = setTimeout(() => {
    longTriggered = true
    manualRefresh(true)
  }, LONG_PRESS_MS)
  const release = () => {
    clearTimeout(timer)
    if (!longTriggered) manualRefresh(false)
  }
  const cancel = () => clearTimeout(timer)
  el.addEventListener('pointerup', release, { once: true })
  el.addEventListener('pointerleave', cancel, { once: true })
  el.addEventListener('pointercancel', cancel, { once: true })
}

function openReport(task) {
  reportTask.value = task
  reportVisible.value = true
}

async function doBianchengDone(task) {
  try {
    await ElMessageBox.confirm(
      `确认加工单「${task.produceBillCode}」已完成编程，加工单将开始生产？`,
      '编程完成确认',
      { type: 'warning', confirmButtonText: '确认完成' },
    )
  } catch {
    return
  }
  await api.post(`/tasks/produce-bill/${encodeURIComponent(task.produceBillCode)}/start`)
  ElMessage.success('已完成编程，加工单已开始')
  // 后端已直接更新本地缓存，重新加载即可看到最新状态
  load()
}

async function doBianchengCancel(task) {
  try {
    await ElMessageBox.confirm(
      `确认将加工单「${task.produceBillCode}」回到未开始状态？`,
      '回到未开始确认',
      { type: 'warning', confirmButtonText: '确认' },
    )
  } catch {
    return
  }
  await api.post(`/tasks/produce-bill/${encodeURIComponent(task.produceBillCode)}/cancel`)
  ElMessage.success('加工单已回到未开始')
  // 后端已直接更新本地缓存，重新加载即可看到最新状态
  load()
}

/** 交期简化为 M/D，如 2026-08-10 → 8/10 */
function shortDate(v) {
  if (!v) return ''
  const [, m, d] = String(v).split('-')
  return m && d ? `${+m}/${+d}` : v
}

onMounted(load)
</script>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(242, 242, 247, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.header-inner {
  max-width: 768px;
  margin: 0 auto;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.round-btn {
  width: 44px;
  height: 44px;
  border-radius: 999px !important;
  flex-shrink: 0;
}

.title {
  flex: 1;
  min-width: 0;
}

.craft-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--foreground);
}

.sub {
  font-size: 12px;
  color: var(--muted-foreground);
  margin-top: 2px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning :deep(.el-icon) {
  animation: spin 0.8s linear infinite;
}

.content {
  max-width: 768px;
  margin: 0 auto;
  padding: 20px 20px 32px;
}

.seg-control {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--muted);
}

.task-search {
  margin-bottom: 14px;
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
  white-space: nowrap;
  transition: all 0.15s;
}

.seg-btn.active {
  background: var(--card);
  color: var(--foreground);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}

.summary {
  margin: 12px 2px 0;
  font-size: 13px;
  color: var(--muted-foreground);
}

.task-area {
  margin-top: 16px;
}

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

.floating-refresh {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  padding: 0 20px calc(16px + env(safe-area-inset-bottom));
  display: none;
  justify-content: center;
  pointer-events: none;
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
