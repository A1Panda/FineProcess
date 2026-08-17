<template>
  <section class="ct-page">
    <!-- 统计条：窗口内（选中工序）汇总 -->
    <div class="stats-row">
      <div class="stat-card s-blue">
        <span class="stat-ico"><el-icon :size="15"><Box /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.valid) }}</span>
        <span class="stat-label">良品（件）</span>
      </div>
      <div class="stat-card s-red">
        <span class="stat-ico"><el-icon :size="15"><WarningFilled /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.waste) }}</span>
        <span class="stat-label">废品（件）</span>
      </div>
      <div class="stat-card s-purple">
        <span class="stat-ico"><el-icon :size="15"><Finished /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.cnt) }}</span>
        <span class="stat-label">报工次数</span>
      </div>
      <div class="stat-card s-green">
        <span class="stat-ico"><el-icon :size="15"><CircleCheck /></el-icon></span>
        <span class="stat-num">{{ summary.passRate }}%</span>
        <span class="stat-label">综合合格率</span>
      </div>
    </div>

    <!-- 工具栏：时间范围 + 周期 + 刷新 -->
    <div class="toolbar">
      <div class="range-seg">
        <button
          v-for="r in ranges"
          :key="r.days"
          class="seg-item"
          :class="{ active: days === r.days }"
          @click="setDays(r.days)"
        >
          {{ r.label }}
        </button>
      </div>
      <span class="range-text">{{ raw.startDate }} ~ {{ raw.endDate }}</span>
      <button class="refresh-btn" :class="{ spinning: refreshing }" aria-label="刷新数据" @click="refreshData">
        <el-icon :size="16"><Refresh /></el-icon>
      </button>
    </div>

    <!-- 工序筛选 chips -->
    <div class="craft-chips">
      <button class="chip" :class="{ active: isAll }" @click="selectAll">全部</button>
      <button
        v-for="c in crafts"
        :key="c.name"
        class="chip"
        :class="{ active: !isAll && selected.includes(c.name) }"
        @click="toggleCraft(c.name)"
      >
        {{ c.name }}
        <span class="chip-num">{{ fmt(c.totals.valid) }}</span>
      </button>
    </div>

    <!-- 图表区 -->
    <div ref="chartRef" v-loading="loading" class="charts">
      <template v-if="displayCrafts.length">
        <!-- 按日汇总：每日良品+废品堆叠柱（随工序筛选联动） -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-head-text">
              <div class="chart-title">按日汇总</div>
              <div class="chart-desc">近 {{ days }} 天每日报工良品按工序堆叠显示，废品叠加在顶部，点击柱子查看明细</div>
            </div>
            <div class="chart-toolbar">
              <div class="yctl">
                <span class="yctl-label">Y 轴上限</span>
                <div class="yctl-seg">
                  <button type="button" :class="{ active: yAuto }" @click="yAuto = true">自动</button>
                  <button type="button" :class="{ active: !yAuto }" @click="yAuto = false">手动</button>
                </div>
              </div>
              <div v-if="!yAuto" class="yctl-input">
                <input v-model.number="yManualVal" type="number" min="0" step="100" placeholder="上限值" />
                <span class="yctl-unit">件</span>
              </div>
            </div>
          </div>
          <svg class="ct-svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
            <g v-for="(gv, gi) in stackGrid" :key="gi">
              <line :x1="padL" :x2="W - padR" :y1="gv.y" :y2="gv.y" class="grid-line" />
              <text :x="padL - 6" :y="gv.y + 3.5" class="axis-text" text-anchor="end">{{ fmt(gv.label) }}</text>
            </g>
            <g v-for="(d, di) in dailyBars" :key="di">
              <g class="bar-group" @click="openDailyDetail(di)">
                <title>{{ d.date }}：良品 {{ fmt(d.valid) }} 件 · 废品 {{ fmt(d.waste) }} 件 · 报工 {{ d.cnt }} 次（点击查看明细）</title>
                <!-- 各工序良品段：按工序顺序从下往上堆叠，颜色区分 -->
                <rect
                  v-for="(s, si) in d.segs"
                  :key="si"
                  :x="xAt(di) - barW / 2"
                  :y="stackVal(segCum(d.segs, si))"
                  :width="barW"
                  :height="stackH(s.valid)"
                  rx="1"
                  :fill="s.color"
                  opacity="0.92"
                >
                  <title>{{ s.name }}：良品 {{ fmt(s.valid) }} 件</title>
                </rect>
                <!-- 废品：叠加在最顶部（红） -->
                <rect
                  v-if="d.waste > 0"
                  :x="xAt(di) - barW / 2"
                  :y="stackVal(d.valid + d.waste)"
                  :width="barW"
                  :height="stackH(d.waste)"
                  rx="1"
                  fill="#ef4444"
                  opacity="0.85"
                >
                  <title>废品 {{ fmt(d.waste) }} 件</title>
                </rect>
              </g>
            </g>
            <g v-for="(d, di) in xTicks" :key="di">
              <text :x="xAt(d.i)" :y="H - 8" class="axis-text" text-anchor="middle">{{ d.label }}</text>
            </g>
          </svg>
          <div class="legend">
            <span v-for="(c, ci) in displayCrafts" :key="c.name" class="legend-item">
              <span class="legend-dot" :style="{ background: colorOf(ci) }"></span>{{ c.name }}
            </span>
            <span class="legend-item"><span class="legend-dot" style="background: #ef4444"></span>废品</span>
          </div>
        </div>

        <!-- 产量趋势：多工序折线 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">产量趋势</div>
            <div class="chart-desc">近 {{ days }} 天各工序每日良品数（悬浮查看数值）</div>
          </div>
          <svg class="ct-svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
            <g v-for="(gv, gi) in yGrid" :key="gi">
              <line :x1="padL" :x2="W - padR" :y1="gv.y" :y2="gv.y" class="grid-line" />
              <text :x="padL - 6" :y="gv.y + 3.5" class="axis-text" text-anchor="end">{{ fmt(gv.label) }}</text>
            </g>
            <g v-for="(c, ci) in displayCrafts" :key="c.name">
              <path
                :d="smoothPath(c)"
                fill="none"
                :stroke="colorOf(ci)"
                stroke-width="2.2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <circle
                v-for="(p, pi) in c.points"
                :key="pi"
                :cx="xAt(pi)"
                :cy="yVal(p.valid)"
                r="3"
                :fill="colorOf(ci)"
                stroke="#fff"
                stroke-width="1.2"
                v-show="p.valid > 0"
              >
                <title>{{ p.date }}：{{ fmt(p.valid) }} 件</title>
              </circle>
            </g>
            <g v-for="(d, di) in xTicks" :key="di">
              <text :x="xAt(d.i)" :y="H - 8" class="axis-text" text-anchor="middle">{{ d.label }}</text>
            </g>
          </svg>
          <div class="legend">
            <span v-for="(c, ci) in displayCrafts" :key="c.name" class="legend-item">
              <span class="legend-dot" :style="{ background: colorOf(ci) }"></span>{{ c.name }}
            </span>
          </div>
        </div>

        <!-- 效率分析：各工序对比排行 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">效率分析</div>
            <div class="chart-desc">各工序产量、平均每次产量与合格率对比</div>
          </div>
          <div class="eff-list">
            <div v-for="(c, ci) in displayCrafts" :key="c.name" class="eff-row">
              <div class="eff-line1">
                <span class="eff-dot" :style="{ background: colorOf(ci) }"></span>
                <span class="eff-name">{{ c.name }}</span>
                <span class="eff-valid">{{ fmt(c.totals.valid) }} 件</span>
              </div>
              <div class="eff-metrics">
                <span class="eff-m">废品 {{ fmt(c.totals.waste) }}</span>
                <span class="eff-m">报工 {{ c.totals.cnt }} 次</span>
                <span class="eff-m">平均 {{ avgPerReport(c) }} 件/次</span>
              </div>
              <div class="eff-pass">
                <span class="eff-pass-label">合格率</span>
                <el-progress
                  class="eff-pass-bar"
                  :percentage="c.totals.passRate"
                  :show-text="false"
                  :stroke-width="6"
                  color="#10b981"
                />
                <span class="eff-pass-num">{{ c.totals.passRate }}%</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="!loading" class="empty">
        <el-icon :size="36"><TrendCharts /></el-icon>
        <p class="empty-text">暂无趋势数据</p>
        <p class="empty-desc">窗口内没有带报工时间的报工记录</p>
      </div>
    </div>

    <!-- 每日明细弹窗：点击按日汇总柱子查看该日各工序报工 -->
    <el-dialog
      v-model="detailVisible"
      :title="detailTitle"
      width="92%"
      :style="{ maxWidth: '560px' }"
      align-center
      append-to-body
      class="day-detail-dlg"
    >
      <div class="dd-summary">
        <div class="dd-stat">
          <span class="dd-num" style="color: var(--primary)">{{ fmt(detailTotal.valid) }}</span>
          <span class="dd-label">良品（件）</span>
        </div>
        <div class="dd-stat">
          <span class="dd-num" style="color: #ef4444">{{ fmt(detailTotal.waste) }}</span>
          <span class="dd-label">废品（件）</span>
        </div>
        <div class="dd-stat">
          <span class="dd-num">{{ fmt(detailTotal.cnt) }}</span>
          <span class="dd-label">报工次数</span>
        </div>
        <div class="dd-stat">
          <span class="dd-num" style="color: #10b981">{{ detailTotal.passRate }}%</span>
          <span class="dd-label">合格率</span>
        </div>
      </div>
      <div class="dd-list">
        <div v-for="(r, ri) in detailRows" :key="r.name" class="dd-row">
          <span class="dd-dot" :style="{ background: colorOf(r.ci) }"></span>
          <span class="dd-main">
            <span class="dd-name">{{ r.name }}</span>
            <span class="dd-meta">废 {{ fmt(r.waste) }} · 报工 {{ r.cnt }} 次</span>
          </span>
          <span class="dd-valid">{{ fmt(r.valid) }} 件</span>
        </div>
        <div v-if="!detailRows.length" class="dd-empty">该日无报工记录</div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../../api'

/* ===== 数据 ===== */

/* 筛选偏好持久化：刷新/重开页面后恢复用户的选择（时间范围 + 工序筛选） */
const PREFS_KEY = 'craft-trend-prefs'

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

const prefs = readPrefs()

const days = ref([7, 30].includes(prefs.days) ? prefs.days : 7)
const ranges = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
]
const loading = ref(false)
const refreshing = ref(false)
const raw = ref({ days: 7, startDate: '', endDate: '', daysList: [], crafts: [] })
const crafts = computed(() => raw.value.crafts || [])
const daysList = computed(() => raw.value.daysList || [])

/* ===== 工序筛选 ===== */
const isAll = ref(typeof prefs.isAll === 'boolean' ? prefs.isAll : true)
const selected = ref(Array.isArray(prefs.selected) ? prefs.selected : [])
const displayCrafts = computed(() =>
  isAll.value ? crafts.value : crafts.value.filter((c) => selected.value.includes(c.name)),
)

watch([days, isAll, selected], () => {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ days: days.value, isAll: isAll.value, selected: selected.value }),
    )
  } catch {
    /* 存储不可用时忽略 */
  }
})

function selectAll() {
  isAll.value = true
  selected.value = []
}

function toggleCraft(name) {
  if (isAll.value) {
    isAll.value = false
    selected.value = [name]
    return
  }
  const i = selected.value.indexOf(name)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(name)
  if (!selected.value.length) isAll.value = true
}

/* ===== 汇总统计 ===== */
const summary = computed(() => {
  let valid = 0
  let waste = 0
  let cnt = 0
  for (const c of displayCrafts.value) {
    valid += c.totals.valid
    waste += c.totals.waste
    cnt += c.totals.cnt
  }
  const passRate = valid + waste > 0 ? Math.round((valid / (valid + waste)) * 1000) / 10 : 100
  return { valid, waste, cnt, passRate }
})

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

function avgPerReport(c) {
  const t = c.totals
  return t.cnt ? Math.round((t.valid / t.cnt) * 10) / 10 : 0
}

/* ===== SVG 布局 ===== */
// 动态测量容器实际宽度：viewBox 宽度 1:1 对应 CSS 像素，避免手机上字体被整体缩放变小
const chartRef = ref(null)
const chartW = ref(640)
const W = computed(() => chartW.value)
const H = 240
const padL = 42
const padR = 14
const padT = 16
const padB = 30
const plotW = computed(() => W.value - padL - padR)
const plotH = H - padT - padB
const n = computed(() => Math.max(1, daysList.value.length))
let chartResizeObs = null

watch(
  chartRef,
  (el) => {
    chartResizeObs?.disconnect()
    chartResizeObs = null
    if (!el) return
    const measure = () => {
      chartW.value = Math.max(280, el.clientWidth)
    }
    measure()
    chartResizeObs = new ResizeObserver(measure)
    chartResizeObs.observe(el)
  },
  { flush: 'post' },
)

onUnmounted(() => {
  chartResizeObs?.disconnect()
})

function xAt(i) {
  if (n.value === 1) return padL + plotW.value / 2
  // 两端各留半个柱宽，避免首末柱子贴边/溢出绘图区
  const half = barW.value / 2
  return padL + half + (i / (n.value - 1)) * (plotW.value - barW.value)
}

function niceMax(v) {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const d = v / pow
  const nice = d <= 1 ? 1 : d <= 2 ? 2 : d <= 2.5 ? 2.5 : d <= 5 ? 5 : 10
  return nice * pow
}

function makeGrid(max) {
  const arr = []
  for (let i = 0; i <= 4; i++) {
    const val = (max * i) / 4
    arr.push({ label: val, y: padT + plotH - (plotH * i) / 4 })
  }
  return arr
}

function makeVal(max) {
  return (v) => padT + plotH - (plotH * v) / max
}

/* 产量趋势：折线 */
const maxValid = computed(() => {
  let m = 0
  for (const c of displayCrafts.value) for (const p of c.points) m = Math.max(m, p.valid)
  return m
})
const yMax = computed(() => niceMax(maxValid.value))
const yGrid = computed(() => makeGrid(yMax.value))
const yVal = computed(() => makeVal(yMax.value))

/** 产量趋势：平滑曲线（Catmull-Rom 转三次贝塞尔） */
function smoothPath(c) {
  const pts = c.points.map((p, i) => [xAt(i), yVal.value(p.valid)])
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`
  }
  return d
}

/* 按日汇总：每日良品+废品堆叠柱（随工序筛选联动）
 * Y 轴按“每日所有工序合计”取最大值，避免单日总量超绘图区导致顶部段被裁剪 */
const stackMax = computed(() => {
  let m = 0
  for (let i = 0; i < daysList.value.length; i++) {
    let s = 0
    for (const c of displayCrafts.value) {
      const p = c.points[i] || {}
      s += (p.valid || 0) + (p.waste || 0)
    }
    m = Math.max(m, s)
  }
  return m
})
/** 自动 Y 轴上限：按数据峰值留 6% 余量后向上取整到合理刻度，跟随数据动态变化 */
function autoYMax(need) {
  if (need <= 0) return 100
  const unit = need >= 5000 ? 2000 : need >= 2000 ? 1000 : need >= 500 ? 500 : need >= 100 ? 100 : 50
  return Math.ceil((need * 1.06) / unit) * unit
}

/* Y 轴上限：自动模式按数据动态计算；手动模式完全尊重输入值（不做自动抬高） */
const yAuto = ref(true)
const yManualVal = ref(1000)
const stackYMax = computed(() => {
  if (yAuto.value) return autoYMax(stackMax.value)
  return Math.max(0, Math.round(Number(yManualVal.value) || 0))
})
const stackGrid = computed(() => makeGrid(stackYMax.value))
const stackVal = computed(() => makeVal(stackYMax.value))
function stackH(v) {
  return (plotH * v) / stackYMax.value
}

/** 各工序段累计到第 i 段（含）的良品总量，用于堆叠定位 */
function segCum(segs, i) {
  let s = 0
  for (let k = 0; k <= i; k++) s += segs[k].valid
  return s
}
const barW = computed(() => Math.min(22, (plotW.value / n.value) * 0.55))
/** 每日堆叠柱：segs 为各工序良品段（按工序顺序从下往上堆叠），waste 叠加在顶部 */
const dailyBars = computed(() =>
  daysList.value.map((d, i) => {
    let valid = 0
    let waste = 0
    let cnt = 0
    const segs = []
    displayCrafts.value.forEach((c, ci) => {
      const p = c.points[i] || {}
      const v = p.valid || 0
      if (v > 0) segs.push({ name: c.name, valid: v, color: colorOf(ci) })
      valid += v
      waste += p.waste || 0
      cnt += p.cnt || 0
    })
    return { date: d, valid, waste, cnt, segs }
  }),
)

/* X 轴标签：30 天时抽稀 */
const xTicks = computed(() => {
  const arr = []
  const step = Math.max(1, Math.ceil(n.value / 6))
  for (let i = 0; i < n.value; i += step) arr.push({ i, label: (daysList.value[i] || '').slice(5) })
  return arr
})

/* ===== 每日明细弹窗 ===== */
const detailVisible = ref(false)
const detailDate = ref('')
const detailRows = ref([])

const detailTitle = computed(() => (detailDate.value ? `${detailDate.value} 报工明细` : '报工明细'))

const detailTotal = computed(() => {
  let valid = 0
  let waste = 0
  let cnt = 0
  for (const r of detailRows.value) {
    valid += r.valid
    waste += r.waste
    cnt += r.cnt
  }
  const passRate = valid + waste > 0 ? Math.round((valid / (valid + waste)) * 1000) / 10 : 100
  return { valid, waste, cnt, passRate }
})

function openDailyDetail(di) {
  detailDate.value = daysList.value[di] || ''
  // 各工序在该日（索引 di）的报工明细，按良品降序；颜色用原始工序索引，保证与柱状图/图例一致
  detailRows.value = displayCrafts.value
    .map((c, ci) => {
      const p = c.points[di] || {}
      return { name: c.name, ci, valid: p.valid || 0, waste: p.waste || 0, cnt: p.cnt || 0 }
    })
    .sort((a, b) => b.valid - a.valid)
  detailVisible.value = true
}

/* ===== 颜色与图例 ===== */
const COLORS = ['#007aff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
function colorOf(i) {
  return COLORS[i % COLORS.length]
}

/* ===== 加载 ===== */
async function load() {
  loading.value = true
  try {
    const res = await api.get('/tasks/craft-trend', { params: { days: days.value } })
    raw.value = res || { days: days.value, startDate: '', endDate: '', daysList: [], crafts: [] }
  } finally {
    loading.value = false
  }
}

/** 刷新：先短按同步一次（拉取最新报工/任务数据），再重新加载图表 */
async function refreshData() {
  refreshing.value = true
  try {
    // 同步可能触发每天一次的全量对账（最长约 40s），单独放宽超时避免 30s 默认超时误报失败
    const res = await api.post('/tasks/sync', null, { timeout: 120000 })
    if (res?.duration != null) ElMessage.success(`数据已刷新（耗时 ${res.duration}ms）`)
    await load()
  } catch (e) {
    const timeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')
    ElMessage.error(timeout ? '同步耗时较长，已重试或稍后再试' : (e.response?.data?.message || '刷新失败'))
  } finally {
    refreshing.value = false
  }
}

function setDays(d) {
  if (days.value === d) return
  days.value = d
  load()
}

onMounted(load)
</script>

<style scoped>
.ct-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 统计条 ===== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 4px 11px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  transition: transform 0.12s ease;
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

.s-blue .stat-ico { color: var(--primary); background: var(--primary-soft, rgba(0, 122, 255, 0.12)); }
.s-red .stat-ico { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.s-purple .stat-ico { color: #8b5cf6; background: rgba(139, 92, 246, 0.12); }
.s-green .stat-ico { color: #10b981; background: rgba(16, 185, 129, 0.12); }

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

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-seg {
  display: flex;
  gap: 4px;
  background: var(--muted, rgba(128, 128, 128, 0.1));
  border-radius: 999px;
  padding: 3px;
}

.seg-item {
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.seg-item.active {
  color: #fff;
  background: var(--primary);
}

.range-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
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
  animation: ct-spin 0.9s linear infinite;
}

@keyframes ct-spin {
  to { transform: rotate(360deg); }
}

/* ===== 工序筛选 chips ===== */
.craft-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: -2px;
  padding: 2px;
}

.craft-chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
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

.chip.active {
  color: #fff;
  border-color: transparent;
  background: var(--primary);
}

.chip-num {
  font-size: 10.5px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* ===== 图表卡片 ===== */
.charts {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 120px;
}

.chart-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
}

.chart-head {
  margin-bottom: 10px;
}

.chart-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--foreground);
}

.chart-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--muted-foreground);
}

/* 卡片头：标题左、Y 轴上限控件右（移动端自动换行） */
.chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.chart-head-text {
  min-width: 0;
}

/* Y 轴上限控件：iOS 风格分段控件 */
.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
  margin-left: auto;
}

.yctl {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.yctl-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--muted, #f2f2f7);
  border-radius: 9px;
}

.yctl-seg button {
  border: none;
  background: transparent;
  padding: 4px 13px;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 7px;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}

.yctl-seg button.active {
  background: var(--card, #fff);
  color: var(--foreground, #1d1d1f);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
}

.yctl-input {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.yctl-input input {
  width: 92px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 隐藏数字输入框的上下箭头（Chrome/Safari/Edge） */
.yctl-input input::-webkit-outer-spin-button,
.yctl-input input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.yctl-input input:focus {
  border-color: #007aff;
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.yctl-unit {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.ct-svg {
  width: 100%;
  height: auto;
  display: block;
}

.grid-line {
  stroke: var(--border);
  stroke-width: 1;
}

.axis-text {
  font-size: 12px;
  fill: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* 按日汇总：柱子可点击 */
.bar-group {
  cursor: pointer;
}

.bar-group rect {
  transition: opacity 0.15s ease;
}

.bar-group:hover rect {
  opacity: 0.75;
}

/* ===== 每日明细弹窗 ===== */
.dd-summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.dd-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--muted, rgba(128, 128, 128, 0.06));
}

.dd-num {
  font-size: 17px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.dd-label {
  font-size: 10.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.dd-list {
  display: flex;
  flex-direction: column;
  max-height: 52vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.dd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 2px;
  font-variant-numeric: tabular-nums;
}

.dd-row + .dd-row {
  border-top: 1px solid var(--border);
}

.dd-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.dd-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dd-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dd-meta {
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.dd-valid {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  flex-shrink: 0;
}

.dd-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted-foreground);
}

/* 图例 */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 8px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--muted-foreground);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

/* ===== 效率分析 ===== */
.eff-list {
  display: flex;
  flex-direction: column;
}

.eff-row + .eff-row {
  border-top: 1px solid var(--border);
}

.eff-row {
  padding: 10px 2px;
}

@media (hover: hover) {
  .eff-row {
    border-radius: 12px;
    padding: 10px 10px;
    margin: 0 -8px;
    transition: background 0.15s ease;
  }

  .eff-row:hover {
    background: var(--muted, rgba(128, 128, 128, 0.06));
  }
}

.eff-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.eff-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.eff-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eff-valid {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.eff-metrics {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 11.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.eff-pass {
  margin-top: 7px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.eff-pass-label {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
}

.eff-pass-bar {
  flex: 1;
  min-width: 0;
}

.eff-pass-bar :deep(.el-progress-bar__outer) {
  background: var(--muted, rgba(128, 128, 128, 0.12));
}

.eff-pass-num {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: #10b981;
  font-variant-numeric: tabular-nums;
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

  .dd-summary {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
