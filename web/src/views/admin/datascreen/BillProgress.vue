<template>
  <section class="bp-page">
    <!-- 统计条：iOS 概览卡，图标 + 大数字 -->
    <div class="stats-row">
      <button class="stat-card s-purple" :class="{ active: activeUnprog }" @click="setStatus('1')">
        <span class="stat-ico"><el-icon :size="15"><Files /></el-icon></span>
        <span class="stat-num">{{ stats.unprogrammed }}</span>
        <span class="stat-label">未编程</span>
      </button>
      <button class="stat-card s-blue" :class="{ active: activeRun }" @click="setStatus('2')">
        <span class="stat-ico"><el-icon :size="15"><VideoPlay /></el-icon></span>
        <span class="stat-num">{{ stats.inProgress }}</span>
        <span class="stat-label">进行中</span>
      </button>
      <button class="stat-card s-red" :class="{ active: activeOverdue }" @click="setOverdue(true)">
        <span class="stat-ico"><el-icon :size="15"><WarningFilled /></el-icon></span>
        <span class="stat-num">{{ stats.overdue }}</span>
        <span class="stat-label">已逾期</span>
      </button>
      <button class="stat-card s-orange" :class="{ active: activeSoon }" @click="setDueSoon()">
        <span class="stat-ico"><el-icon :size="15"><Clock /></el-icon></span>
        <span class="stat-num">{{ stats.dueSoon }}</span>
        <span class="stat-label">临期提醒</span>
      </button>
    </div>

    <!-- 工具栏：搜索 + 排序 + 刷新 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="搜索单号 / HT图号 / 产品名"
        clearable
      >
        <template #prefix><el-icon :size="15"><Search /></el-icon></template>
      </el-input>
      <div class="toolbar-right">
        <el-select v-model="sortBy" class="sort-select" @change="reload(1)">
          <el-option label="交期优先" value="delivery" />
          <el-option label="进度最慢" value="progress" />
          <el-option label="剩余工序多" value="remaining" />
        </el-select>
        <button class="refresh-btn" :class="{ spinning: refreshing }" aria-label="刷新同步数据" @click="refreshData">
          <el-icon :size="16"><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <!-- 状态筛选 tab -->
    <div class="status-tabs">
      <button
        v-for="t in statusTabs"
        :key="t.value"
        class="st-item"
        :class="{ active: activeStatus === t.value }"
        @click="switchStatus(t.value)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 加工单卡片列表（按 HT 图号分组，可折叠） -->
    <div v-loading="loading" class="bill-list">
      <div v-for="g in groups" :key="g.htNo" class="bill-group">
        <!-- 分组头 -->
        <div class="group-head" @click="toggleGroup(g.htNo)">
          <span class="group-badge">HT</span>
          <span class="group-title">{{ g.htNo }}</span>
          <span class="group-plans">{{ g.bills.map((b) => b.num).join('+') }}</span>
          <span class="group-count">{{ g.bills.length }} 单</span>
          <el-icon class="group-arrow" :class="{ open: !collapsedGroups.includes(g.htNo) }"><ArrowDown /></el-icon>
        </div>

        <!-- 组内加工单 -->
        <div v-show="!collapsedGroups.includes(g.htNo)" class="group-body">
          <div class="bill-card" v-for="b in g.bills" :key="b.code">
            <div class="bc-head" @click="toggle(b.code)">
              <div class="bc-line1">
                <span class="bc-code">{{ b.goodsName || b.code }}</span>
                <span class="bc-tag" :class="billStatus(b).cls">{{ billStatus(b).label }}</span>
              </div>
              <div class="bc-sub">
                {{ b.code }} · {{ b.spec }}
              </div>
              <div class="bc-meta">
                <span class="bc-qty"><el-icon :size="13"><Box /></el-icon>{{ b.num }} {{ b.unitName }}</span>
                <span class="bc-due" :class="dueClass(b)">{{ dueText(b) }}</span>
              </div>
              <div class="bc-progress-row">
                <el-progress
                  class="bc-progress"
                  :percentage="b.progressPercent"
                  :show-text="false"
                  :stroke-width="8"
                  :color="progressColor(b)"
                />
                <span class="bc-pct">{{ b.progressPercent }}%</span>
                <span class="bc-count">已完 {{ b.doneCrafts }}/{{ b.totalCrafts }} 序</span>
                <el-icon class="bc-arrow" :class="{ open: expanded.includes(b.code) }"><ArrowDown /></el-icon>
              </div>
            </div>

            <!-- 展开：工序明细（两行布局：信息行 + 进度条） -->
            <div v-if="expanded.includes(b.code)" class="bc-crafts">
              <div class="craft-row" v-for="(c, i) in b.crafts" :key="i" @click="openCraftDaily(b, c)">
                <div class="cr-line1">
                  <span class="cr-name">{{ c.craftName }}</span>
                  <span class="cr-tag" :class="craftStatusClass(c.status)">{{ c.statusName }}</span>
                  <span class="cr-num">
                    计划 {{ c.num }} · 良 {{ c.validNum }} · 剩 {{ Math.max(0, c.num - c.validNum) }}<span v-if="c.wasteNum > 0"> · 废 {{ c.wasteNum }}</span>
                  </span>
                </div>
                <el-progress
                  class="cr-bar"
                  :percentage="c.percent"
                  :show-text="false"
                  :stroke-width="6"
                  :color="craftColor(c)"
                />
              </div>
              <div v-if="!b.crafts.length" class="cr-empty">暂无工序数据（该加工单任务尚未同步）</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!loading && list.length === 0" class="empty">
        <el-icon :size="36"><Document /></el-icon>
        <p class="empty-text">没有符合条件的加工单</p>
        <p class="empty-desc">试试调整筛选条件，或点击右上角刷新同步数据</p>
      </div>
    </div>

    <!-- 触底加载更多 -->
    <div v-show="list.length > 0" ref="loadMoreRef" class="load-more" :class="{ end: noMore }">
      <el-icon v-if="!noMore && loadingMore" class="lm-spin" :size="14"><Loading /></el-icon>
      <span v-if="noMore">已加载全部 {{ total }} 条</span>
      <span v-else-if="loadingMore">加载中…</span>
      <span v-else>上滑加载更多</span>
    </div>

    <!-- 单工序多日报工弹窗 -->
    <el-dialog
      v-model="dailyVisible"
      width="92%"
      :style="{ maxWidth: '560px' }"
      align-center
      append-to-body
      destroy-on-close
    >
      <template #header>
        <div class="cd-header">
          <span class="cd-title">多日报工</span>
          <span class="cd-sub">{{ dailyCraft }}</span>
        </div>
      </template>

      <div v-if="dailyLoading" class="cd-loading">加载中…</div>
      <template v-else>
        <!-- 汇总条 -->
        <div class="cd-summary">
          <div class="cd-stat">
            <span class="cd-num" style="color: var(--primary)">{{ fmtNum(dailyTotals.valid) }}</span>
            <span class="cd-label">良品（件）</span>
          </div>
          <div class="cd-stat">
            <span class="cd-num" style="color: #ef4444">{{ fmtNum(dailyTotals.waste) }}</span>
            <span class="cd-label">废品（件）</span>
          </div>
          <div class="cd-stat">
            <span class="cd-num">{{ fmtNum(dailyTotals.cnt) }}</span>
            <span class="cd-label">报工次数</span>
          </div>
          <div class="cd-stat">
            <span class="cd-num" style="color: #10b981">{{ dailyTotals.passRate }}%</span>
            <span class="cd-label">合格率</span>
          </div>
        </div>

        <!-- 多日堆叠柱（横向条形图 + 上下滑动） -->
        <div ref="cdChartRef" class="cd-chart">
          <svg
            class="cd-svg"
            :viewBox="`0 0 ${cdW} ${cdH}`"
            :style="{ height: cdH + 'px' }"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="cd-valid-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#007aff" />
                <stop offset="100%" stop-color="#007aff" stop-opacity="0.4" />
              </linearGradient>
            </defs>
            <!-- 数量刻度（垂直网格线 + 顶部数值） -->
            <g v-for="(gv, gi) in cdGrid" :key="gi">
              <line :x1="gv.x" :x2="gv.x" :y1="cdPadT" :y2="cdPadT + cdPlotH" class="cd-grid-line" />
              <text :x="gv.x" :y="cdPadT - 5" class="cd-axis-text" text-anchor="middle">{{ fmtNum(gv.label) }}</text>
            </g>
            <!-- 每天一行：日期 + 横条（良品+废品堆叠） + 数值 -->
            <g v-for="(d, di) in cdBars" :key="di">
              <title>{{ d.date }}：良品 {{ fmtNum(d.valid) }} 件 · 废品 {{ fmtNum(d.waste) }} 件 · 报工 {{ d.cnt }} 次</title>
              <text :x="cdPadL - 8" :y="cdYAt(di)" class="cd-axis-text" text-anchor="end">{{ (d.date || '').slice(5) }}</text>
              <rect :x="cdPadL" :y="cdYAt(di) - cdBarH / 2" :width="cdBarLen(d.valid)" :height="cdBarH" rx="4" fill="url(#cd-valid-grad)" />
              <rect
                v-if="d.waste > 0"
                :x="cdPadL + cdBarLen(d.valid)"
                :y="cdYAt(di) - cdBarH / 2"
                :width="cdBarLen(d.waste)"
                :height="cdBarH"
                rx="4"
                fill="#ef4444"
                opacity="0.85"
              />
              <!-- 良品数：统一居中显示在蓝色段正上方（含短柱） -->
              <text
                v-if="d.valid > 0"
                :x="cdLabelX(cdPadL + cdBarLen(d.valid) / 2)"
                :y="cdYAt(di) - cdBarH / 2 - 5"
                class="cd-valid-label"
                text-anchor="middle"
              >{{ fmtNum(d.valid) }}</text>
              <!-- 废品数：统一居中显示在红色段正上方（含短柱） -->
              <text
                v-if="d.waste > 0"
                :x="cdLabelX(cdPadL + cdBarLen(d.valid) + cdBarLen(d.waste) / 2)"
                :y="cdYAt(di) - cdBarH / 2 - 5"
                class="cd-waste-label"
                text-anchor="middle"
              >{{ fmtNum(d.waste) }}</text>
            </g>
          </svg>
        </div>
        <div class="cd-legend">
          <span class="cd-legend-item"><span class="cd-legend-dot" style="background: #007aff"></span>良品</span>
          <span class="cd-legend-item"><span class="cd-legend-dot" style="background: #ef4444"></span>废品</span>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../../api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const refreshing = ref(false)
const expanded = ref([])
/** 按 HT 图号折叠的分组集合 */
const collapsedGroups = ref([])

const stats = reactive({ unprogrammed: 0, total: 0, inProgress: 0, overdue: 0, dueSoon: 0 })
const keyword = ref('')
const sortBy = ref('delivery')
const activeStatus = ref('1,2,5')
const overdueOnly = ref(false)
const dueSoonOnly = ref(false)

/**
 * 统计卡高亮联动：全部(1,2,5)→四卡全亮；未编程(1)/进行中(2)→只亮对应卡；
 * 已完成(3)/今日已完成(done-today)→全不亮；已逾期/临期筛选→只亮对应卡
 */
const isAllTab = computed(() => activeStatus.value === '1,2,5' && !overdueOnly.value && !dueSoonOnly.value)
const activeUnprog = computed(() => activeStatus.value === '1' || isAllTab.value)
const activeRun = computed(() => activeStatus.value === '2' || isAllTab.value)
const activeOverdue = computed(() => overdueOnly.value || isAllTab.value)
const activeSoon = computed(() => dueSoonOnly.value || isAllTab.value)

const statusTabs = [
  { label: '全部', value: '1,2,5' },
  { label: '未编程', value: '1' },
  { label: '进行中', value: '2' },
  { label: '已完成', value: '3' },
  { label: '今日已完成', value: 'done-today' },
]

function buildParams(p) {
  const v = activeStatus.value
  const isNumeric = /^[\d,]+$/.test(v)
  return {
    status: isNumeric ? v : undefined,
    scope: v && !isNumeric ? v : undefined,
    keyword: keyword.value || undefined,
    sortBy: sortBy.value,
    overdue: overdueOnly.value || undefined,
    dueSoon: dueSoonOnly.value || undefined,
    page: p,
    pageSize,
  }
}

async function load() {
  loading.value = true
  try {
    const res = await api.get('/tasks/bill-progress', { params: buildParams(page.value) })
    list.value = res.list || []
    total.value = res.total || 0
    Object.assign(stats, res.stats || {})
  } finally {
    loading.value = false
  }
}

function reload(p = 1) {
  page.value = p
  load()
}

/* ===== 触底加载更多 ===== */
const loadMoreRef = ref(null)
const loadingMore = ref(false)
const noMore = computed(() => total.value <= list.value.length)
let moreObserver = null

watch(
  loadMoreRef,
  (el) => {
    if (moreObserver) {
      moreObserver.disconnect()
      moreObserver = null
    }
    if (!el) return
    moreObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '200px' },
    )
    moreObserver.observe(el)
  },
  { flush: 'post' },
)

/** 追加下一页数据（按单号去重，避免排序波动导致重复/遗漏） */
async function loadMore() {
  if (loadingMore.value || loading.value || noMore.value) return
  loadingMore.value = true
  const nextPage = page.value + 1
  try {
    const res = await api.get('/tasks/bill-progress', { params: buildParams(nextPage) })
    const items = res.list || []
    if (items.length) {
      const seen = new Set(list.value.map((b) => b.code))
      list.value = [...list.value, ...items.filter((b) => !seen.has(b.code))]
    }
    total.value = res.total ?? total.value
    page.value = nextPage
  } finally {
    loadingMore.value = false
  }
}

onUnmounted(() => {
  moreObserver?.disconnect()
  cdResizeObs?.disconnect()
})

function switchStatus(v) {
  activeStatus.value = v
  overdueOnly.value = false
  dueSoonOnly.value = false
  reload(1)
}

function setOverdue(v) {
  if (overdueOnly.value === v && !v) return
  dueSoonOnly.value = false
  if (v) activeStatus.value = '1,2,5' // 逾期跨状态查看，重置到全部
  overdueOnly.value = v
  reload(1)
}

/** 统计卡点击：只看临期（3 天内到期）加工单 */
function setDueSoon() {
  overdueOnly.value = false
  activeStatus.value = '1,2,5'
  dueSoonOnly.value = true
  reload(1)
}

/** 统计卡点击：切换到指定状态筛选（如未编程=1） */
function setStatus(v) {
  overdueOnly.value = false
  dueSoonOnly.value = false
  if (activeStatus.value === v) return
  activeStatus.value = v
  reload(1)
}

function toggle(code) {
  expanded.value = expanded.value.includes(code)
    ? expanded.value.filter((c) => c !== code)
    : [...expanded.value, code]
}

/** 按 HT 图号分组（未填图号归入"未填图号"组），保持当前页顺序 */
const groups = computed(() => {
  const map = new Map()
  for (const b of list.value) {
    const key = b.htNo || '未填图号'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(b)
  }
  return [...map.entries()].map(([htNo, bills]) => ({ htNo, bills }))
})

function toggleGroup(htNo) {
  collapsedGroups.value = collapsedGroups.value.includes(htNo)
    ? collapsedGroups.value.filter((h) => h !== htNo)
    : [...collapsedGroups.value, htNo]
}

async function refreshData() {
  refreshing.value = true
  try {
    // 同步可能触发每天一次的全量对账（最长约 40s），单独放宽超时避免 30s 默认超时误报失败
    const res = await api.post('/tasks/sync', null, { timeout: 120000 })
    ElMessage.success(`数据已刷新（耗时 ${res.duration ?? '—'}ms）`)
    await load()
  } catch (e) {
    const timeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')
    ElMessage.error(timeout ? '同步耗时较长，已重试或稍后再试' : (e.response?.data?.message || '刷新失败'))
  } finally {
    refreshing.value = false
  }
}

/* ===== 展示辅助 ===== */

/** 数字格式化：整数直接显示，带小数的保留 1 位 */
function fmtNum(v) {
  const n = Number(v) || 0
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)
}

/* ===== 单工序多日报工弹窗 ===== */
const dailyVisible = ref(false)
const dailyLoading = ref(false)
const dailyCraft = ref('')
const dailyBillCode = ref('')
const dailyDays = ref([])
const dailyPoints = ref([])
const dailyTotals = ref({ valid: 0, waste: 0, cnt: 0, passRate: 100 })

// SVG 布局常量（横向条形图：每天一行，高度随天数增长，超高时上下滑动）
const cdRowH = 52 // 每天占用的行高（留出横条上方的数字空间）
const cdBarH = 20 // 横条高度
const cdPadT = 24 // 顶部留白（容纳数量刻度）
const cdPadB = 10 // 底部留白
const cdPadL = 54 // 左侧日期标签留白
const cdPadR = 44 // 右侧数值标签留白
const cdN = computed(() => dailyDays.value.length || 1)
const cdH = computed(() => cdPadT + cdPadB + cdN.value * cdRowH)
const cdPlotH = computed(() => cdN.value * cdRowH)

// 动态测量容器实际宽度：让 viewBox 宽度 1:1 对应 CSS 像素，避免字体被整体缩放变小
const cdChartRef = ref(null)
const chartW = ref(640)
const cdW = computed(() => chartW.value)
const cdPlotW = computed(() => Math.max(120, cdW.value - cdPadL - cdPadR))
let cdResizeObs = null

watch(
  cdChartRef,
  (el) => {
    cdResizeObs?.disconnect()
    cdResizeObs = null
    if (!el) return
    const measure = () => {
      chartW.value = Math.max(280, el.clientWidth)
    }
    measure()
    cdResizeObs = new ResizeObserver(measure)
    cdResizeObs.observe(el)
  },
  { flush: 'post' },
)

/** 第 i 天横条的纵向中心坐标 */
function cdYAt(i) {
  return cdPadT + cdRowH * i + cdRowH / 2
}

/** 数量 → 横条长度（像素） */
function cdBarLen(v) {
  return (cdPlotW.value * v) / cdYMax.value
}

/** 数字水平坐标：尽量居中于段上方，同时保证不超出图表左右边界 */
function cdLabelX(x) {
  return Math.max(cdPadL, Math.min(cdW.value - cdPadR, x))
}

/** 数量轴最大值：取每日良品+废品堆叠最大值，向上取整到漂亮刻度 */
function cdNiceMax(m) {
  if (m <= 0) return 10
  const mag = Math.pow(10, Math.floor(Math.log10(m)))
  const norm = m / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

const cdYMax = computed(() => {
  let m = 0
  for (const p of dailyPoints.value) m = Math.max(m, (p.valid || 0) + (p.waste || 0))
  return cdNiceMax(m)
})

/** 数量刻度：垂直网格线 + 顶部数值标签 */
const cdGrid = computed(() => {
  const arr = []
  const count = 4
  for (let i = 0; i <= count; i++) {
    const v = (cdYMax.value / count) * i
    arr.push({ x: cdPadL + (cdPlotW.value * v) / cdYMax.value, label: v })
  }
  return arr
})

/** 每天一条横条：最新日期排在最前面（倒序） */
const cdBars = computed(() => [...dailyPoints.value].reverse())

async function openCraftDaily(b, c) {
  dailyCraft.value = `${c.craftName} · ${b.code}`
  dailyBillCode.value = b.code
  dailyVisible.value = true
  dailyLoading.value = true
  dailyPoints.value = []
  dailyDays.value = []
  dailyTotals.value = { valid: 0, waste: 0, cnt: 0, passRate: 100 }
  try {
    const data = await api.get('/tasks/craft-daily', {
      params: { billCode: b.code, craftName: c.craftName, days: 7 },
    })
    dailyDays.value = data.daysList || []
    dailyPoints.value = data.points || []
    dailyTotals.value = data.totals || { valid: 0, waste: 0, cnt: 0, passRate: 100 }
  } catch {
    /* 拦截器已提示 */
  } finally {
    dailyLoading.value = false
  }
}

/** 加工单状态 tag：1 未开始 / 2 进行中 / 3 已完成 / 4 已取消 / 5 已暂停 */
function statusClass(s) {
  return { 1: 'st-wait', 2: 'st-run', 3: 'st-done', 4: 'st-cancel', 5: 'st-pause' }[s] || ''
}

/**
 * 加工单状态标签（区分"未编程 / 未开始"）：
 * - 单未开始(status=1) → 未编程
 * - 单进行中(status=2) 但所有工序均未开始 → 未开始
 * - 单进行中且已有工序开工 → 进行中
 */
function billStatus(b) {
  if (b.status === 1) return { label: '未编程', cls: 'st-unprog' }
  if (b.status === 3) return { label: '已完成', cls: 'st-done' }
  if (b.status === 5) return { label: '已暂停', cls: 'st-pause' }
  if (b.status === 2) {
    const started = (b.crafts || []).some((c) => c.status >= 2)
    return started ? { label: '进行中', cls: 'st-run' } : { label: '未开始', cls: 'st-wait' }
  }
  return { label: b.statusName || '', cls: statusClass(b.status) }
}

/** 工序状态 tag：1 未开始 / 2 进行中 / 3 已完成 / 4 已暂停 */
function craftStatusClass(s) {
  return { 1: 'st-wait', 2: 'st-run', 3: 'st-done', 4: 'st-pause' }[s] || ''
}

/** 交期展示：逾期红 / 临期橙 / 正常灰 */
function dueClass(b) {
  if (b.overdue) return 'is-overdue'
  if (b.dueSoon) return 'is-due-soon'
  return ''
}

function dueText(b) {
  if (!b.deliveryDate) return '未设置交期'
  if (b.overdue) return `已逾期 ${-b.dueInDays} 天 · ${b.deliveryDate}`
  if (b.dueInDays === 0) return `今天到期 · ${b.deliveryDate}`
  if (b.dueSoon) return `还剩 ${b.dueInDays} 天 · ${b.deliveryDate}`
  return `交期 ${b.deliveryDate}`
}

/** 整体进度条颜色：逾期红、100% 绿、其余主题蓝 */
function progressColor(b) {
  if (b.overdue) return '#ef4444'
  return b.progressPercent >= 100 ? '#10b981' : 'var(--primary, #007aff)'
}

/** 工序条颜色：已完成绿、进行中蓝、其余灰 */
function craftColor(c) {
  if (c.status === 3) return '#10b981'
  if (c.status === 2) return 'var(--primary, #007aff)'
  return '#cbd5e1'
}

onMounted(load)

/** 输入即搜索：关键词防抖 400ms 后自动刷新 */
let kwTimer = null
watch(keyword, () => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => reload(1), 400)
})
</script>

<style scoped>
.bp-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 统计条：iOS 概览卡 ===== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 4px 11px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.stat-card:active {
  transform: scale(0.97);
}

.stat-ico {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.s-purple .stat-ico { color: #8b5cf6; background: rgba(139, 92, 246, 0.12); }
.s-blue .stat-ico { color: var(--primary); background: var(--primary-soft, rgba(0, 122, 255, 0.12)); }
.s-red .stat-ico { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.s-orange .stat-ico { color: #f59e0b; background: rgba(245, 158, 11, 0.14); }

.stat-num {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.15;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

/* 选中态：主题色边框 + 浅色底托 */
.stat-card.active {
  border-color: transparent;
  background: var(--primary-soft, rgba(0, 122, 255, 0.1));
  box-shadow: inset 0 0 0 1px var(--primary-soft, rgba(0, 122, 255, 0.4));
}

.stat-card.active .stat-num { color: var(--primary); }
.stat-card.s-purple.active { box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.35); background: rgba(139, 92, 246, 0.1); }
.stat-card.s-purple.active .stat-num { color: #8b5cf6; }
.stat-card.s-red.active { box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.09); }
.stat-card.s-red.active .stat-num { color: #ef4444; }
.stat-card.s-orange.active { box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.12); }
.stat-card.s-orange.active .stat-num { color: #f59e0b; }

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  flex: 1;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 12px;
  min-height: 38px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-select {
  width: 116px;
}

.sort-select :deep(.el-select__wrapper) {
  border-radius: 12px;
  min-height: 38px;
}

.refresh-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.refresh-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.refresh-btn.spinning .el-icon {
  animation: bp-spin 0.9s linear infinite;
}

@keyframes bp-spin {
  to { transform: rotate(360deg); }
}

/* ===== 状态 tab ===== */
.status-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: -2px;
  padding: 2px;
}

.status-tabs::-webkit-scrollbar {
  display: none;
}

.st-item {
  flex-shrink: 0;
  height: 32px;
  padding: 0 15px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--muted-foreground);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.st-item.active {
  color: #fff;
  border-color: transparent;
  background: var(--primary);
}

/* ===== 卡片列表 ===== */
.bill-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}

/* ===== HT 图号分组 ===== */
.bill-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.group-badge {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  background: var(--primary);
  border-radius: 7px;
  padding: 3px 6px;
  line-height: 1;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-plans {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.group-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
  background: var(--muted, rgba(128, 128, 128, 0.1));
  border-radius: 999px;
  padding: 1px 8px;
}

.group-arrow {
  color: var(--muted-foreground);
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.group-arrow.open {
  transform: rotate(180deg);
}

.group-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ===== 加工单卡片 ===== */
.bill-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.bc-head {
  padding: 13px 14px 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.bc-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bc-code {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bc-tag {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  border-radius: 999px;
  padding: 1px 8px;
  line-height: 1.6;
}

.st-wait { color: var(--muted-foreground); border: 1px solid var(--border); }
.st-unprog { color: #8b5cf6; background: rgba(139, 92, 246, 0.12); }
.st-run { color: var(--primary); background: var(--primary-soft, rgba(0, 122, 255, 0.12)); }
.st-done { color: #10b981; background: rgba(16, 185, 129, 0.12); }
.st-pause { color: #f59e0b; background: rgba(245, 158, 11, 0.12); }
.st-cancel { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

.bc-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bc-meta {
  margin-top: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.bc-qty {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.bc-due {
  flex-shrink: 0;
  font-weight: 500;
}

.bc-due.is-overdue { color: #ef4444; }
.bc-due.is-due-soon { color: #f59e0b; }

.bc-progress-row {
  margin-top: 9px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.bc-progress {
  flex: 1;
  min-width: 0;
}

.bc-progress :deep(.el-progress-bar__outer) {
  background: var(--muted, rgba(128, 128, 128, 0.12));
}

.bc-pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.bc-count {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bc-arrow {
  color: var(--muted-foreground);
  transition: transform 0.18s ease;
}

.bc-arrow.open {
  transform: rotate(180deg);
}

/* ===== 工序明细（两行布局） ===== */
.bc-crafts {
  border-top: 1px solid var(--border);
  padding: 8px 14px 12px;
  background: var(--background, transparent);
}

.craft-row + .craft-row {
  border-top: 1px solid var(--border);
}

.craft-row {
  padding: 8px 0;
  cursor: pointer;
  border-radius: 10px;
  transition: background 0.15s ease;
}

.craft-row:hover {
  background: var(--muted, rgba(128, 128, 128, 0.06));
}

.cr-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cr-name {
  flex-shrink: 0;
  max-width: 45%;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cr-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  border-radius: 999px;
  padding: 0 7px;
  line-height: 1.7;
}

.cr-num {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cr-bar {
  margin-top: 6px;
}

.cr-bar :deep(.el-progress-bar__outer) {
  background: var(--muted, rgba(128, 128, 128, 0.12));
}

.cr-empty {
  padding: 12px 0 4px;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 空状态 ===== */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 16px;
  color: var(--muted-foreground);
  border: 1px dashed var(--border);
  border-radius: 16px;
  background: transparent;
}

.empty-text {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
}

.empty-desc {
  margin: 0;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 触底加载更多 ===== */
.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 0 4px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.load-more.end {
  padding: 10px 0 2px;
}

.lm-spin {
  animation: lm-spin 0.9s linear infinite;
}

@keyframes lm-spin {
  to { transform: rotate(360deg); }
}

/* ===== 单工序多日报工弹窗 ===== */
.cd-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.cd-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--foreground);
}

.cd-sub {
  font-size: 12px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cd-loading {
  text-align: center;
  color: var(--muted-foreground);
  padding: 24px 0;
  font-size: 13px;
}

.cd-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.cd-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--muted, rgba(128, 128, 128, 0.06));
}

.cd-num {
  font-size: 17px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.cd-label {
  font-size: 10.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.cd-chart {
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  max-height: 320px;
  margin: 0 -2px;
  padding: 2px 2px 6px;
}

.cd-svg {
  display: block;
  width: 100%;
  height: auto;
}

.cd-grid-line {
  stroke: var(--border);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.cd-axis-text {
  font-size: 12px;
  fill: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* 良品数：蓝色，加粗 */
.cd-valid-label {
  font-size: 12px;
  font-weight: 600;
  fill: #007aff;
  font-variant-numeric: tabular-nums;
}

/* 废品数：红色，加粗 */
.cd-waste-label {
  font-size: 12px;
  font-weight: 600;
  fill: #ef4444;
  font-variant-numeric: tabular-nums;
}

.cd-legend {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 6px;
}

.cd-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.cd-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
}

/* ===== 桌面端 ===== */
@media (min-width: 768px) {
  .stats-row {
    gap: 12px;
  }

  .stat-card {
    padding: 16px 8px;
    gap: 5px;
  }

  .stat-num {
    font-size: 24px;
  }

  .stat-ico {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  .bill-list {
    gap: 14px;
  }

  .group-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
}
</style>
