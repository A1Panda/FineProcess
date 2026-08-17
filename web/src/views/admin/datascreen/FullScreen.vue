<template>
  <section class="fs-page">
    <!-- 顶部栏：标题 + 时钟 + 操作 -->
    <header class="fs-top">
      <div class="fs-brand">
        <span class="fs-dot"></span>
        <h1 class="fs-title">快工单生产数据大屏</h1>
      </div>
      <div class="fs-top-right">
        <span class="fs-clock">{{ clockText }}</span>
        <button class="fs-btn" :class="{ spinning: refreshing }" aria-label="刷新" @click="refreshData">
          <el-icon :size="15"><Refresh /></el-icon>
        </button>
        <button class="fs-btn fs-exit" aria-label="退出全屏" @click="router.push('/admin/data/bill-progress')">
          <el-icon :size="15"><Close /></el-icon>
        </button>
      </div>
    </header>

    <!-- KPI 统计条 -->
    <div class="fs-kpis">
      <div class="fs-kpi k-total">
        <span class="k-num">{{ fmt(bpStats.total) }}</span>
        <span class="k-label">加工单总数</span>
      </div>
      <div class="fs-kpi k-unprog">
        <span class="k-num">{{ fmt(bpStats.unprogrammed) }}</span>
        <span class="k-label">未编程</span>
      </div>
      <div class="fs-kpi k-run">
        <span class="k-num">{{ fmt(bpStats.inProgress) }}</span>
        <span class="k-label">进行中</span>
      </div>
      <div class="fs-kpi k-overdue">
        <span class="k-num">{{ fmt(bpStats.overdue) }}</span>
        <span class="k-label">已逾期</span>
      </div>
      <div class="fs-kpi k-soon">
        <span class="k-num">{{ fmt(bpStats.dueSoon) }}</span>
        <span class="k-label">临期(3天内)</span>
      </div>
    </div>

    <!-- 主体网格 -->
    <div v-loading="loading" class="fs-grid">
      <!-- 左：工序产出趋势（近 7 天堆叠柱） -->
      <div class="fs-panel">
        <div class="fs-panel-head">
          <span class="fs-panel-title">工序产出趋势</span>
          <span class="fs-panel-sub">近 {{ trendDays.length }} 天良品/废品</span>
        </div>
        <svg class="fs-svg" viewBox="0 0 640 220" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="fs-valid-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#007aff" />
              <stop offset="100%" stop-color="#007aff" stop-opacity="0.4" />
            </linearGradient>
          </defs>
          <g v-for="(gv, gi) in trendGrid" :key="gi">
            <line :x1="fsPadL" :x2="fsW - fsPadR" :y1="gv.y" :y2="gv.y" class="fs-grid-line" />
            <text :x="fsPadL - 6" :y="gv.y + 3.5" class="fs-axis-text" text-anchor="end">{{ fmt(gv.label) }}</text>
          </g>
          <g v-for="(d, di) in dailySeries" :key="di">
            <g>
              <title>{{ d.date }}：良品 {{ fmt(d.valid) }} 件 · 废品 {{ fmt(d.waste) }} 件 · 报工 {{ d.cnt }} 次</title>
              <rect :x="fsXAt(di) - fsBarW / 2" :y="fsStackVal(d.valid)" :width="fsBarW" :height="fsStackH(d.valid)" rx="3" fill="url(#fs-valid-grad)" />
              <rect :x="fsXAt(di) - fsBarW / 2" :y="fsStackVal(d.valid + d.waste)" :width="fsBarW" :height="fsStackH(d.waste)" rx="3" fill="#ef4444" opacity="0.85" />
            </g>
          </g>
          <g v-for="(d, di) in trendTicks" :key="di">
            <text :x="fsXAt(d.i)" :y="fsH - 8" class="fs-axis-text" text-anchor="middle">{{ d.label }}</text>
          </g>
        </svg>
        <div class="fs-legend">
          <span class="fs-legend-item"><span class="fs-legend-dot" style="background:#007aff"></span>良品</span>
          <span class="fs-legend-item"><span class="fs-legend-dot" style="background:#ef4444"></span>废品</span>
        </div>
        <!-- 各工序汇总 -->
        <div class="fs-craft-strip">
          <div v-for="c in trendCrafts" :key="c.name" class="fs-craft-chip">
            <span class="fs-craft-name">{{ c.name }}</span>
            <span class="fs-craft-num">{{ fmt(c.valid) }} 件</span>
          </div>
        </div>
      </div>

      <!-- 右：报工统计（工序 + 产线/组） -->
      <div class="fs-panel">
        <div class="fs-panel-head">
          <span class="fs-panel-title">报工统计</span>
          <span class="fs-panel-sub">近 {{ rsDays }} 天按工序 / 产线</span>
        </div>
        <!-- 按工序汇总 -->
        <div class="fs-rs-block">
          <div class="fs-rs-title">按工序</div>
          <div v-for="(c, i) in reportCrafts" :key="c.name" class="fs-rs-row">
            <span class="fs-rs-rank" :style="{ color: rankColor(i) }">{{ i + 1 }}</span>
            <span class="fs-rs-name">{{ c.name }}</span>
            <span class="fs-rs-bar"><i :style="{ width: barPct(c.valid, reportCrafts) }"></i></span>
            <span class="fs-rs-num">{{ fmt(c.valid) }} 件</span>
          </div>
          <div v-if="!reportCrafts.length" class="fs-empty">暂无报工数据</div>
        </div>
        <!-- 按产线/组分组 -->
        <div class="fs-rs-block">
          <div class="fs-rs-title">按产线 / 组</div>
          <div v-for="g in userGroups" :key="g.line" class="fs-group">
            <div class="fs-group-head">
              <span class="fs-group-name">{{ g.line }}</span>
              <span class="fs-group-meta">{{ g.members.length }} 人 · {{ fmt(g.valid) }} 件</span>
              <span class="fs-group-rate" :style="{ color: passColor(g.passRate) }">{{ g.passRate }}%</span>
            </div>
            <div class="fs-group-body">
              <div v-for="(u, ui) in g.members.slice(0, 6)" :key="u.name" class="fs-user">
                <span class="fs-user-rank">{{ ui + 1 }}</span>
                <span class="fs-user-name">{{ u.name }}</span>
                <span class="fs-user-num">{{ fmt(u.valid) }} 件</span>
              </div>
            </div>
          </div>
          <div v-if="!userGroups.length" class="fs-empty">暂无报工数据</div>
        </div>
      </div>
    </div>

    <!-- 底部：加工单进度列表 -->
    <div class="fs-panel fs-bills">
      <div class="fs-panel-head">
        <span class="fs-panel-title">加工单进度</span>
        <span class="fs-panel-sub">未编程 / 进行中 · 逾期优先</span>
      </div>
      <div class="fs-bill-grid">
        <div v-for="b in bills" :key="b.code" class="fs-bill" :class="{ 'is-overdue': b.overdue }">
          <div class="fs-bill-top">
            <span class="fs-bill-code">{{ b.code }}</span>
            <span class="fs-bill-tag" :class="billCls(b)">{{ billLabel(b) }}</span>
          </div>
          <div class="fs-bill-sub">{{ b.htNo || '—' }} · {{ b.goodsName }}</div>
          <div class="fs-bill-progress">
            <div class="fs-bill-track"><i :style="{ width: b.progressPercent + '%' }"></i></div>
            <span class="fs-bill-pct">{{ b.progressPercent }}%</span>
            <span class="fs-bill-cnt">{{ b.doneCrafts }}/{{ b.totalCrafts }} 序</span>
          </div>
          <div class="fs-bill-crafts">
            <span v-for="(c, ci) in b.crafts" :key="ci" class="fs-bill-craft" :class="'st' + c.status">
              {{ c.craftName }}
            </span>
          </div>
        </div>
        <div v-if="!bills.length && !loading" class="fs-empty">暂无进行中加工单</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../../../api'

const router = useRouter()

const loading = ref(true)
const refreshing = ref(false)

/* ===== 加工单进度统计 ===== */
const bpStats = reactive({ unprogrammed: 0, total: 0, inProgress: 0, overdue: 0, dueSoon: 0 })
const bills = ref([])

/* ===== 工序产出趋势 ===== */
const trendDays = ref([])
const trendCrafts = ref([])

/* ===== 报工统计 ===== */
const reportCrafts = ref([])
const rsDays = ref(7)

/* ===== 时钟 ===== */
const now = ref(new Date())
let clockTimer = null
const clockText = computed(() => {
  const p = (n) => String(n).padStart(2, '0')
  const d = now.value
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

function fmt(n) {
  return (n ?? 0).toLocaleString('en-US')
}

/* ===== 加载 ===== */
async function load() {
  loading.value = true
  try {
    const [bp, ct, rs] = await Promise.all([
      api.get('/tasks/bill-progress', { params: { page: 1, pageSize: 60, status: '1,2' } }),
      api.get('/tasks/craft-trend', { params: { days: 7 } }),
      api.get('/tasks/report-stats', { params: { days: 7 } }),
    ])
    Object.assign(bpStats, bp.stats || {})
    bills.value = (bp.list || []).sort((a, b) => Number(b.overdue) - Number(a.overdue))
    trendDays.value = ct.daysList || []
    trendCrafts.value = (ct.crafts || []).map((c) => ({ name: c.name, valid: c.totals.valid, waste: c.totals.waste, cnt: c.totals.cnt, passRate: c.totals.passRate }))
    // 每日明细：从 craft-trend points 聚合（良品+废品堆叠柱）
    dailySeries.value = trendDays.value.map((d, i) => {
      let valid = 0
      let waste = 0
      let cnt = 0
      for (const c of ct.crafts || []) {
        const p = c.points[i] || {}
        valid += p.valid || 0
        waste += p.waste || 0
        cnt += p.cnt || 0
      }
      return { date: d, valid, waste, cnt }
    })
    reportCrafts.value = (rs.crafts || []).map((c) => ({ name: c.name, valid: c.valid, waste: c.waste, cnt: c.cnt, passRate: c.passRate }))
    rsDays.value = rs.days || 7
    buildUserGroups(rs.users || [])
  } finally {
    loading.value = false
  }
}

/* ===== 报工统计：按产线/组分组 ===== */
const userGroups = ref([])
function buildUserGroups(users) {
  const map = new Map()
  for (const u of users) {
    const line = u.line || '未分组'
    if (!map.has(line)) map.set(line, { line, valid: 0, waste: 0, cnt: 0, members: [] })
    const g = map.get(line)
    g.valid += u.valid
    g.waste += u.waste
    g.cnt += u.cnt
    g.members.push(u)
  }
  const groups = [...map.values()].sort((a, b) => b.valid - a.valid)
  const misc = groups.filter((g) => g.line === '未分组')
  const rest = groups.filter((g) => g.line !== '未分组')
  userGroups.value = [...rest, ...misc].map((g) => ({
    ...g,
    passRate: g.valid + g.waste > 0 ? Math.round((g.valid / (g.valid + g.waste)) * 1000) / 10 : 100,
  }))
}

async function refreshData() {
  refreshing.value = true
  try {
    await api.post('/tasks/sync', null, { timeout: 120000 })
    await load()
  } catch (e) {
    const timeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')
    ElMessage.error(timeout ? '同步耗时较长，请稍后再试' : (e.response?.data?.message || '刷新失败'))
  } finally {
    refreshing.value = false
  }
}

/* ===== 加工单进度辅助 ===== */
function billLabel(b) {
  if (b.overdue) return '逾期'
  if (b.dueSoon) return '临期'
  return b.statusName || ''
}
function billCls(b) {
  if (b.overdue) return 'is-red'
  if (b.dueSoon) return 'is-orange'
  if (b.status === 1) return 'is-gray'
  return 'is-blue'
}

/* ===== 工序产出趋势 SVG 布局 ===== */
const fsW = 640
const fsH = 220
const fsPadL = 42
const fsPadR = 14
const fsPadT = 16
const fsPadB = 28
const fsPlotW = fsW - fsPadL - fsPadR
const fsPlotH = fsH - fsPadT - fsPadB

const nDays = computed(() => Math.max(1, trendDays.value.length))

function niceMax(v) {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const d = v / pow
  const nice = d <= 1 ? 1 : d <= 2 ? 2 : d <= 2.5 ? 2.5 : d <= 5 ? 5 : 10
  return nice * pow
}

/* 每日明细：从原始 craft-trend points 聚合（良品+废品堆叠柱） */
const dailySeries = ref([])

const stackMax = computed(() => {
  let m = 0
  for (const d of dailySeries.value) m = Math.max(m, d.valid + d.waste)
  return m
})
const stackYMax = computed(() => niceMax(stackMax.value))
const trendGrid = computed(() => {
  const arr = []
  for (let i = 0; i <= 4; i++) {
    const val = (stackYMax.value * i) / 4
    arr.push({ label: val, y: fsPadT + fsPlotH - (fsPlotH * i) / 4 })
  }
  return arr
})
function fsStackVal(v) {
  return fsPadT + fsPlotH - (fsPlotH * v) / stackYMax.value
}
function fsStackH(v) {
  return (fsPlotH * v) / stackYMax.value
}
function fsXAt(i) {
  return nDays.value === 1 ? fsPadL + fsPlotW / 2 : fsPadL + (i / (nDays.value - 1)) * fsPlotW
}
const fsBarW = computed(() => Math.min(26, (fsPlotW / nDays.value) * 0.6))
const trendTicks = computed(() => {
  const arr = []
  const step = Math.max(1, Math.ceil(nDays.value / 6))
  for (let i = 0; i < nDays.value; i += step) arr.push({ i, label: (dailySeries.value[i]?.date || '').slice(5) })
  return arr
})

/* ===== 报工统计辅助 ===== */
function rankColor(i) {
  return ['#007aff', '#8b5cf6', '#10b981'][i] || '#94a3b8'
}
function barPct(v, list) {
  const m = Math.max(1, ...list.map((c) => c.valid))
  return `${Math.max(3, Math.round((v / m) * 100))}%`
}
function passColor(p) {
  if (p >= 98) return '#34c759'
  if (p >= 90) return '#f59e0b'
  return '#ef4444'
}

onMounted(() => {
  load()
  clockTimer = setInterval(() => (now.value = new Date()), 1000)
})
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.fs-page {
  min-height: 100vh;
  padding: 20px 24px 28px;
  background: var(--background);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 顶部栏 ===== */
.fs-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.fs-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.fs-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--success);
  box-shadow: 0 0 0 4px rgba(52, 199, 89, 0.18);
  flex-shrink: 0;
}

.fs-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--foreground);
  white-space: nowrap;
}

.fs-top-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fs-clock {
  font-size: 14px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
}

.fs-btn {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.fs-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.fs-btn.spinning .el-icon {
  animation: fs-spin 0.9s linear infinite;
}

.fs-exit:hover {
  color: var(--destructive);
  border-color: var(--destructive);
}

@keyframes fs-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ===== KPI ===== */
.fs-kpis {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.fs-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 8px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
}

.k-num {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--foreground);
}

.k-label {
  font-size: 12px;
  color: var(--muted-foreground);
}

.k-overdue .k-num {
  color: var(--destructive);
}

.k-soon .k-num {
  color: var(--warning);
}

/* ===== 主体网格 ===== */
.fs-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  align-items: start;
}

.fs-panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  padding: 16px;
}

.fs-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.fs-panel-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--foreground);
}

.fs-panel-sub {
  font-size: 11.5px;
  color: var(--muted-foreground);
}

/* ===== SVG ===== */
.fs-svg {
  width: 100%;
  height: auto;
  display: block;
}

.fs-grid-line {
  stroke: var(--border);
  stroke-width: 1;
}

.fs-axis-text {
  font-size: 10px;
  fill: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.fs-legend {
  display: flex;
  gap: 14px;
  margin-top: 6px;
}

.fs-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted-foreground);
}

.fs-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.fs-craft-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.fs-craft-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--muted);
  font-size: 12px;
}

.fs-craft-name {
  color: var(--foreground);
  font-weight: 600;
}

.fs-craft-num {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* ===== 报工统计 ===== */
.fs-rs-block + .fs-rs-block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.fs-rs-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
  margin-bottom: 8px;
}

.fs-rs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.fs-rs-rank {
  width: 18px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fs-rs-name {
  width: 52px;
  font-size: 12.5px;
  color: var(--foreground);
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-rs-bar {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--muted);
  overflow: hidden;
}

.fs-rs-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
}

.fs-rs-num {
  font-size: 12px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fs-group {
  padding: 6px 0;
}

.fs-group + .fs-group {
  border-top: 1px dashed var(--border);
}

.fs-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fs-group-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-group-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fs-group-rate {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fs-group-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
  margin-top: 5px;
}

.fs-user {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.fs-user-rank {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  width: 12px;
  flex-shrink: 0;
}

.fs-user-name {
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.fs-user-num {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.fs-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 加工单进度列表 ===== */
.fs-bill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.fs-bill {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--background);
}

.fs-bill.is-overdue {
  border-color: rgba(255, 59, 48, 0.4);
}

.fs-bill-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fs-bill-code {
  font-size: 13px;
  font-weight: 700;
  color: var(--foreground);
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
}

.fs-bill-tag {
  font-size: 10px;
  border-radius: 999px;
  padding: 1px 7px;
  line-height: 1.6;
  flex-shrink: 0;
}

.fs-bill-tag.is-red {
  background: rgba(255, 59, 48, 0.12);
  color: var(--destructive);
}

.fs-bill-tag.is-orange {
  background: rgba(255, 149, 0, 0.14);
  color: var(--warning);
}

.fs-bill-tag.is-blue {
  background: rgba(0, 122, 255, 0.12);
  color: var(--primary);
}

.fs-bill-tag.is-gray {
  background: var(--muted);
  color: var(--muted-foreground);
}

.fs-bill-sub {
  font-size: 11px;
  color: var(--muted-foreground);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-bill-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.fs-bill-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--muted);
  overflow: hidden;
}

.fs-bill-track i {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: 999px;
}

.fs-bill-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.fs-bill-cnt {
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.fs-bill-crafts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.fs-bill-craft {
  font-size: 10px;
  border-radius: 6px;
  padding: 1px 6px;
  background: var(--muted);
  color: var(--muted-foreground);
}

.fs-bill-craft.st3 {
  background: rgba(52, 199, 89, 0.14);
  color: var(--success);
}

.fs-bill-craft.st2 {
  background: rgba(0, 122, 255, 0.12);
  color: var(--primary);
}

/* ===== 响应式降级 ===== */
@media (max-width: 960px) {
  .fs-kpis {
    grid-template-columns: repeat(3, 1fr);
  }

  .fs-grid {
    grid-template-columns: 1fr;
  }
}
</style>
