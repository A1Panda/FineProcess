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
      <button class="refresh-btn" :class="{ spinning: loading }" aria-label="刷新数据" @click="load">
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
    <div v-loading="loading" class="charts">
      <template v-if="displayCrafts.length">
        <!-- 产量趋势：多工序折线 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">产量趋势</div>
            <div class="chart-desc">近 {{ days }} 天各工序每日良品数（悬浮查看数值）</div>
          </div>
          <svg class="ct-svg" viewBox="0 0 640 240" preserveAspectRatio="xMidYMid meet">
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

        <!-- 报工频次：每日柱状 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">报工频次</div>
            <div class="chart-desc">近 {{ days }} 天每日报工次数（工作强度，悬浮查看数值）</div>
          </div>
          <svg class="ct-svg" viewBox="0 0 640 240" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="ct-bar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--primary)" />
                <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.3" />
              </linearGradient>
            </defs>
            <g v-for="(gv, gi) in cntGrid" :key="gi">
              <line :x1="padL" :x2="W - padR" :y1="gv.y" :y2="gv.y" class="grid-line" />
              <text :x="padL - 6" :y="gv.y + 3.5" class="axis-text" text-anchor="end">{{ fmt(gv.label) }}</text>
            </g>
            <g v-for="(d, di) in daily" :key="di">
              <rect
                :x="xAt(di) - barW / 2"
                :y="cntVal(d.cnt)"
                :width="barW"
                :height="padT + plotH - cntVal(d.cnt)"
                rx="4"
                fill="url(#ct-bar-grad)"
              >
                <title>{{ d.date }}：{{ d.cnt }} 次</title>
              </rect>
            </g>
            <g v-for="(d, di) in xTicks" :key="di">
              <text :x="xAt(d.i)" :y="H - 8" class="axis-text" text-anchor="middle">{{ d.label }}</text>
            </g>
          </svg>
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
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../../api'

/* ===== 数据 ===== */
const days = ref(7)
const ranges = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
]
const loading = ref(false)
const raw = ref({ days: 7, startDate: '', endDate: '', daysList: [], crafts: [] })
const crafts = computed(() => raw.value.crafts || [])
const daysList = computed(() => raw.value.daysList || [])

/* ===== 工序筛选 ===== */
const isAll = ref(true)
const selected = ref([])
const displayCrafts = computed(() =>
  isAll.value ? crafts.value : crafts.value.filter((c) => selected.value.includes(c.name)),
)

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
const W = 640
const H = 240
const padL = 42
const padR = 14
const padT = 16
const padB = 30
const plotW = W - padL - padR
const plotH = H - padT - padB
const n = computed(() => Math.max(1, daysList.value.length))

function xAt(i) {
  return n.value === 1 ? padL + plotW / 2 : padL + (i / (n.value - 1)) * plotW
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

/* 报工频次：柱状 */
const maxCnt = computed(() => {
  let m = 0
  for (const c of displayCrafts.value) for (const p of c.points) m = Math.max(m, p.cnt)
  return m
})
const cntMax = computed(() => niceMax(maxCnt.value))
const cntGrid = computed(() => makeGrid(cntMax.value))
const cntVal = computed(() => makeVal(cntMax.value))
const daily = computed(() =>
  daysList.value.map((d, i) => {
    let cnt = 0
    for (const c of displayCrafts.value) cnt += (c.points[i] || {}).cnt || 0
    return { date: d, cnt }
  }),
)
const barW = computed(() => Math.min(22, (plotW / n.value) * 0.55))

/* X 轴标签：30 天时抽稀 */
const xTicks = computed(() => {
  const arr = []
  const step = Math.max(1, Math.ceil(n.value / 6))
  for (let i = 0; i < n.value; i += step) arr.push({ i, label: (daysList.value[i] || '').slice(5) })
  return arr
})

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
  font-size: 10px;
  fill: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
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
}
</style>
