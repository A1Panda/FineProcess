<template>
  <section class="rs-page">
    <!-- 统计条：窗口内汇总（产出 / 损失 / 速率 / 质量） -->
    <div class="stats-row">
      <div class="stat-card s-blue">
        <span class="stat-ico"><el-icon :size="15"><Box /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.valid) }}<span class="stat-unit">件</span></span>
        <span class="stat-label">良品产出</span>
      </div>
      <div class="stat-card s-red">
        <span class="stat-ico"><el-icon :size="15"><WarningFilled /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.waste) }}<span class="stat-unit">件</span></span>
        <span class="stat-label">废品损失</span>
      </div>
      <div class="stat-card s-purple">
        <span class="stat-ico"><el-icon :size="15"><TrendCharts /></el-icon></span>
        <span class="stat-num">{{ fmt(summary.dailyValid) }}<span class="stat-unit">件/天</span></span>
        <span class="stat-label">日均产出</span>
      </div>
      <div class="stat-card s-green">
        <span class="stat-ico"><el-icon :size="15"><CircleCheck /></el-icon></span>
        <span class="stat-num">{{ summary.passRate }}<span class="stat-unit">%</span></span>
        <span class="stat-label">综合合格率</span>
      </div>
    </div>

    <!-- 工具栏：时间范围 + 刷新 -->
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
      <div class="toolbar-right">
        <span class="range-text">{{ raw.startDate }} ~ {{ raw.endDate }}</span>
        <button class="refresh-btn" :class="{ spinning: refreshing }" aria-label="刷新数据" @click="refreshData">
          <el-icon :size="16"><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <div v-loading="loading" class="charts">
      <template v-if="hasData">
        <!-- 产量趋势：每日良品折线 + 废品虚线 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">产量趋势</div>
            <div class="chart-desc">窗口内每日良品产出走势（废品独立比例显示）</div>
            <div class="rs-legend">
              <span class="lg"><i class="lg-dot lg-valid"></i>良品</span>
              <span class="lg"><i class="lg-dot lg-waste"></i>废品</span>
            </div>
          </div>
          <div class="rs-trend">
            <div class="rs-trend-plot" :title="trendTitle">
              <svg class="rs-trend-svg" viewBox="0 0 100 54" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="rs-trend-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color: var(--primary); stop-opacity: 0.28" />
                    <stop offset="100%" style="stop-color: var(--primary); stop-opacity: 0.02" />
                  </linearGradient>
                </defs>
                <path class="rs-trend-area" :d="trendArea" fill="url(#rs-trend-grad)"></path>
                <path v-if="trendHasWaste" class="rs-trend-wline" :d="trendWasteLine"></path>
                <path class="rs-trend-vline" :d="trendLine"></path>
              </svg>
              <span v-if="trendLine" class="rs-trend-dot" :style="{ left: trendLastX, top: trendLastY }"></span>
            </div>
            <div class="rs-trend-x">
              <span v-for="(lb, i) in trendLabels" :key="i" class="rs-trend-xlab" :class="lb.align">{{ lb.text }}</span>
            </div>
          </div>
        </div>

        <!-- 按工序汇总：堆叠条对比，展开看产线明细 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">按工序汇总</div>
            <div class="chart-desc">良品（工序色）与废品（红）堆叠对比，点击工序展开产线明细</div>
          </div>
          <div class="rs-list">
            <div v-for="(c, ci) in crafts" :key="c.name" class="rs-craft" :class="{ open: openSet.has(c.name) }">
              <button class="rs-craft-head" @click="toggleCraft(c.name)">
                <el-icon class="rs-caret" :size="12"><ArrowDown /></el-icon>
                <span class="rs-dot" :style="{ background: colorOf(ci) }"></span>
                <span class="rs-name">{{ c.name }}</span>
                <span class="rs-valid">{{ fmt(c.valid) }} 件</span>
              </button>
              <div class="rs-craft-foot">
                <span class="rs-craft-meta">废品 {{ fmt(c.waste) }} · 报工 {{ c.cnt }} 次</span>
                <span class="rs-rate" :style="{ color: passColor(c.passRate) }">合格率 {{ c.passRate }}%</span>
              </div>
              <!-- 展开：分组/产线对比 + 组内成员对比 -->
              <div v-if="openSet.has(c.name)" class="rs-lines">
                <div v-for="(l, li) in c.lines" :key="l.line" class="rs-lgrp">
                  <div class="rs-lgrp-head">
                    <span class="rs-lgrp-name" :title="l.line">{{ l.line }}</span>
                    <span class="rs-lgrp-valid">{{ fmt(l.valid) }} 件</span>
                    <span class="rs-lgrp-rate" :style="{ color: passColor(l.passRate) }">{{ l.passRate }}%</span>
                  </div>
                  <!-- 组间对比条：本工序内归一 -->
                  <div class="rs-lgrp-track">
                    <div class="rs-lgrp-fill" :style="{ width: lmPct(c, l), background: colorOf(ci) }"></div>
                  </div>
                  <!-- 组内成员对比 -->
                  <div class="rs-lgrp-members">
                    <div v-for="(m, mi) in l.members" :key="m.name" class="rs-lm-row">
                      <span class="rs-lm-rank" :class="rankClass(mi)">{{ mi + 1 }}</span>
                      <span class="rs-lm-name">{{ m.name }}</span>
                      <div class="rs-lm-bar">
                        <div class="rs-lm-bar-fill" :style="{ width: gmPct(l, m), background: colorOf(ci) }"></div>
                      </div>
                      <span class="rs-lm-valid">{{ fmt(m.valid) }}</span>
                      <span class="rs-lm-rate" :style="{ color: passColor(m.passRate) }">{{ m.passRate }}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 按报工人汇总：分组排行，点击看个人日报 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">按报工人汇总</div>
            <div class="chart-desc">按产线/组分组的人员产量排行，点击任意成员查看个人日报</div>
          </div>
          <div class="rs-list">
            <div v-for="(g, gi) in userGroups" :key="g.line" class="rs-group">
              <div class="rs-group-head" :class="{ 'rs-group-misc': g.misc }">
                <div class="rs-group-top">
                  <span class="rs-group-name">{{ g.line }}</span>
                  <span class="rs-group-valid">{{ fmt(g.valid) }} 件</span>
                  <span class="rs-group-rate" :style="{ color: passColor(g.passRate) }">{{ g.passRate }}%</span>
                </div>
                <div class="rs-group-meta">{{ g.members.length }} 人 · 报工 {{ g.cnt }} 次</div>
              </div>
              <div class="rs-group-body">
                <div v-for="(u, ui) in g.members" :key="u.name" class="rs-row" @click="openUserDaily(u, g)">
                  <div class="rs-line1">
                    <span class="rs-rank" :class="rankClass(ui)">{{ ui + 1 }}</span>
                    <span class="rs-name">{{ u.name }}</span>
                    <span v-if="u.line && !g.misc" class="rs-u-line">{{ u.line }}</span>
                    <span class="rs-valid">{{ fmt(u.valid) }} 件</span>
                  </div>
                  <div class="rs-bar-track">
                    <div class="rs-bar-fill" :style="{ width: uBarW(g, u), background: rankColor(ui) }"></div>
                  </div>
                  <div class="rs-metrics">
                    <span class="rs-m">废品 {{ fmt(u.waste) }}</span>
                    <span class="rs-m">报工 {{ u.cnt }} 次</span>
                    <span class="rs-m" :class="{ 'rs-m-low': u.passRate < 90 }">合格率 {{ u.passRate }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="!loading" class="empty">
        <el-icon :size="36"><DataAnalysis /></el-icon>
        <p class="empty-text">暂无报工数据</p>
        <p class="empty-desc">窗口内没有带报工时间的报工记录</p>
      </div>
    </div>

    <!-- 个人日报弹窗：每日每人报工明细 -->
    <el-dialog v-model="userDailyVisible" width="92%" :style="{ maxWidth: '560px' }" align-center append-to-body destroy-on-close>
      <template #header>
        <div class="rsd-header">
          <span class="rsd-title">{{ userDaily.name }}</span>
          <span class="rsd-sub">{{ userDaily.line }}</span>
        </div>
      </template>

      <template v-if="userDaily.days">
        <!-- 汇总 -->
        <div class="rsd-summary">
          <div class="rsd-stat">
            <span class="rsd-num" style="color: var(--primary)">{{ fmt(userDaily.valid) }}</span>
            <span class="rsd-label">良品（件）</span>
          </div>
          <div class="rsd-stat">
            <span class="rsd-num" style="color: #ef4444">{{ fmt(userDaily.waste) }}</span>
            <span class="rsd-label">废品（件）</span>
          </div>
          <div class="rsd-stat">
            <span class="rsd-num">{{ fmt(userDaily.cnt) }}</span>
            <span class="rsd-label">报工次数</span>
          </div>
          <div class="rsd-stat">
            <span class="rsd-num" style="color: #10b981">{{ userDaily.passRate }}%</span>
            <span class="rsd-label">合格率</span>
          </div>
        </div>

        <!-- 每日明细列表：新日期在上 -->
        <div class="rsd-list">
          <div v-for="(d, di) in [...userDaily.days].reverse()" :key="d.date" class="rsd-day">
            <span class="rsd-date" :class="{ zero: d.valid + d.waste === 0 }">{{ d.date.slice(5) }}</span>
            <div class="rsd-bar-track">
              <div class="rsd-bar-valid" :style="{ width: rsdPct(d.valid) }"></div>
              <div class="rsd-bar-waste" :style="{ width: rsdPct(d.waste) }"></div>
            </div>
            <span class="rsd-nums">
              <b class="rsd-v">{{ fmt(d.valid) }}</b>
              <span v-if="d.waste > 0" class="rsd-w">废 {{ fmt(d.waste) }}</span>
              <span class="rsd-c">{{ d.cnt }} 次</span>
            </span>
          </div>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../../api'

/* ===== 数据 ===== */

/* 筛选偏好持久化：刷新/重开页面后恢复用户的选择（时间范围 + 工序展开） */
const PREFS_KEY = 'report-stats-prefs'

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
const raw = ref({ days: 7, startDate: '', endDate: '', daily: [], crafts: [], users: [] })
const crafts = computed(() => raw.value.crafts || [])
const users = computed(() => raw.value.users || [])
const daily = computed(() => raw.value.daily || [])

/* ===== 按报工人分组：按产线/组聚合（组按良品降序，未分组排最后） ===== */
const userGroups = computed(() => {
  const map = new Map()
  for (const u of users.value) {
    const line = u.line || '未分组'
    if (!map.has(line)) map.set(line, { line, valid: 0, waste: 0, cnt: 0, passRate: 100, members: [] })
    const g = map.get(line)
    g.valid += u.valid
    g.waste += u.waste
    g.cnt += u.cnt
    g.members.push(u)
  }
  const groups = [...map.values()]
  groups.sort((a, b) => b.valid - a.valid)
  const misc = groups.filter((g) => g.line === '未分组')
  const rest = groups.filter((g) => g.line !== '未分组')
  return [...rest, ...misc].map((g) => ({
    ...g,
    misc: g.line === '未分组',
    passRate: g.valid + g.waste > 0 ? Math.round((g.valid / (g.valid + g.waste)) * 1000) / 10 : 100,
  }))
})

const hasData = computed(() =>
  crafts.value.some((c) => c.valid > 0 || c.waste > 0 || c.cnt > 0),
)

/* ===== 汇总统计 ===== */
const summary = computed(() => {
  let valid = 0
  let waste = 0
  let cnt = 0
  for (const c of crafts.value) {
    valid += c.valid
    waste += c.waste
    cnt += c.cnt
  }
  const passRate = valid + waste > 0 ? Math.round((valid / (valid + waste)) * 1000) / 10 : 100
  const activeDays = (raw.value.daily || []).length
  const dailyValid = activeDays > 0 ? Math.round(valid / activeDays) : valid
  return { valid, waste, cnt, passRate, dailyValid }
})

/* ===== 产量趋势折线图 ===== */
const TW = 100
const TH = 54
const T_PAD = { t: 5, b: 6, l: 3, r: 3 }

function tMax(pick) {
  return Math.max(1, ...daily.value.map((d) => pick(d) || 0))
}

function tPts(pick) {
  const arr = daily.value
  const n = arr.length
  const max = tMax(pick)
  return arr.map((d, i) => {
    const x = n > 1 ? T_PAD.l + (i / (n - 1)) * (TW - T_PAD.l - T_PAD.r) : TW / 2
    const y = T_PAD.t + (1 - (pick(d) || 0) / max) * (TH - T_PAD.t - T_PAD.b)
    return [x, y]
  })
}

/** Catmull-Rom 平滑曲线 */
function smoothPath(pts) {
  const n = pts.length
  if (!n) return ''
  if (n === 1) return `M ${pts[0][0]} ${pts[0][1]}`
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

const trendLine = computed(() => smoothPath(tPts((d) => d.valid)))

const trendArea = computed(() => {
  const pts = tPts((d) => d.valid)
  if (!pts.length) return ''
  const base = TH - T_PAD.b
  return `${smoothPath(pts)} L ${pts[pts.length - 1][0].toFixed(2)} ${base} L ${pts[0][0].toFixed(2)} ${base} Z`
})

const trendHasWaste = computed(() => daily.value.some((d) => (d.waste || 0) > 0))

const trendWasteLine = computed(() => smoothPath(tPts((d) => d.waste)))

const trendLastX = computed(() => {
  const p = tPts((d) => d.valid)
  return p.length ? `${(p[p.length - 1][0] / TW) * 100}%` : '0%'
})

const trendLastY = computed(() => {
  const p = tPts((d) => d.valid)
  return p.length ? `${(p[p.length - 1][1] / TH) * 100}%` : '0%'
})

/** X 轴标签：取首/中/尾三个日期，短格式 MM-DD */
const trendLabels = computed(() => {
  const arr = daily.value
  const n = arr.length
  if (!n) return []
  const idx = n === 1 ? [0] : n === 2 ? [0, 1] : n === 3 ? [0, 1, 2] : [0, Math.floor(n / 2), n - 1]
  return idx.map((i, k) => ({
    text: (arr[i].date || '').slice(5),
    align: k === 0 ? 'left' : k === idx.length - 1 ? 'right' : 'center',
  }))
})

/** 悬浮提示：每日 良/废/次数 */
const trendTitle = computed(() =>
  daily.value.map((d) => `${d.date.slice(5)} 良 ${fmt(d.valid)} · 废 ${fmt(d.waste)} · ${d.cnt} 次`).join('\n'),
)

/* ===== 工序展开 ===== */
const openSet = ref(new Set())
function toggleCraft(name) {
  const next = new Set(openSet.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  openSet.value = next
}

watch([days, openSet], () => {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ days: days.value, openSet: [...openSet.value] }),
    )
  } catch {
    /* 存储不可用时忽略 */
  }
})

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

/** 合格率着色：>=99 绿 / >=90 橙 / <90 红（突出低合格率异常） */
function passColor(rate) {
  return rate >= 99 ? '#10b981' : rate >= 90 ? '#f59e0b' : '#ef4444'
}

/* ===== 分组/成员对比条 ===== */
/** 组间条宽：相对本工序内最大分组良品归一（至少 4% 可见） */
function lmPct(c, l) {
  const max = Math.max(1, ...(c.lines || []).map((x) => x.valid || 0))
  return `${Math.max(4, Math.round(((l.valid || 0) / max) * 100))}%`
}

/** 组内成员条宽：相对该组内最大成员良品归一（至少 4% 可见） */
function gmPct(l, m) {
  const max = Math.max(1, ...(l.members || []).map((x) => x.valid || 0))
  return `${Math.max(4, Math.round(((m.valid || 0) / max) * 100))}%`
}

/* ===== 排行样式 ===== */
/** 人员产量条：相对组内最大成员良品归一（至少 3% 可见） */
function uBarW(g, u) {
  const max = Math.max(1, ...(g.members || []).map((x) => x.valid || 0))
  return `${Math.max(3, Math.round(((u.valid || 0) / max) * 100))}%`
}

const MEDAL = ['#f5a623', '#a8b2c1', '#cd8a5a']
function rankClass(i) {
  return `rank-${i + 1}`
}
function rankColor(i) {
  return MEDAL[i] || '#007aff'
}

/* ===== 个人日报：每日每人报工 ===== */
const userDailyVisible = ref(false)
const userDaily = ref({ name: '', line: '', valid: 0, waste: 0, cnt: 0, passRate: 100, days: [] })

function openUserDaily(u, g) {
  userDaily.value = {
    name: u.name,
    line: g.misc ? '未分组' : u.line,
    valid: u.valid,
    waste: u.waste,
    cnt: u.cnt,
    passRate: u.passRate,
    days: u.days || [],
  }
  userDailyVisible.value = true
}

/** 个人日报横向条宽：相对该人窗口内最大单日总量 */
function rsdPct(v) {
  const selfMax = Math.max(1, ...(userDaily.value.days || []).map((d) => (d.valid || 0) + (d.waste || 0)))
  return `${Math.max(0, Math.round((v / selfMax) * 100))}%`
}

/* ===== 颜色 ===== */
const COLORS = ['#007aff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
function colorOf(i) {
  return COLORS[i % COLORS.length]
}

/* ===== 加载 ===== */
async function load() {
  loading.value = true
  try {
    const res = await api.get('/tasks/report-stats', { params: { days: days.value } })
    raw.value = res || { days: days.value, startDate: '', endDate: '', daily: [], crafts: [], users: [] }
    // 恢复上次展开的工序；首次进入默认展开全部
    const names = (raw.value.crafts || []).map((c) => c.name)
    const saved = Array.isArray(prefs.openSet) ? prefs.openSet.filter((n) => names.includes(n)) : []
    openSet.value = new Set(saved.length ? saved : names)
  } finally {
    loading.value = false
  }
}

/** 刷新：先短按同步一次（拉取最新报工数据），再重新加载 */
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

onMounted(() => {
  load()
  startPolling()
})

/* ===== 自动轮询：跟随后端同步（后端每 5 分钟自动同步，这里静默重拉数据） ===== */
let pollTimer = null
function startPolling(ms = 60000) {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (document.hidden) return // 页面不可见时不打扰
    load()
  }, ms)
}

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.rs-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 统计条 ===== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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

.stat-unit {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  margin-left: 2px;
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
  flex-wrap: wrap;
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

.toolbar-right {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
}

.range-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
  text-align: right;
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
  animation: rs-spin 0.9s linear infinite;
}

@keyframes rs-spin {
  to { transform: rotate(360deg); }
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

/* ===== 图例 ===== */
.rs-legend {
  margin-top: 8px;
  display: flex;
  gap: 14px;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted-foreground);
}

.lg-dot {
  width: 14px;
  height: 3px;
  border-radius: 999px;
}

.lg-valid {
  background: var(--primary);
}

.lg-waste {
  background: #ef4444;
  background-image: repeating-linear-gradient(90deg, #ef4444 0 3px, transparent 3px 5px);
}

/* ===== 产量趋势图 ===== */
.rs-trend {
  margin-top: 2px;
}

.rs-trend-plot {
  position: relative;
  height: 120px;
}

.rs-trend-svg {
  display: block;
  width: 100%;
  height: 120px;
  overflow: visible;
}

.rs-trend-vline {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.rs-trend-wline {
  fill: none;
  stroke: #ef4444;
  stroke-width: 1.4;
  stroke-dasharray: 4 4;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

/* 最新日圆点：HTML 叠加保证圆形不被 viewBox 拉伸 */
.rs-trend-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--primary);
  border: 2px solid var(--card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.rs-trend-x {
  position: relative;
  height: 16px;
  margin-top: 2px;
}

.rs-trend-xlab {
  position: absolute;
  top: 0;
  font-size: 10px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.rs-trend-xlab.left { left: 0; }
.rs-trend-xlab.center { left: 50%; transform: translateX(-50%); }
.rs-trend-xlab.right { right: 0; }

/* ===== 按工序汇总 ===== */
.rs-list {
  display: flex;
  flex-direction: column;
}

.rs-craft {
  border-radius: 12px;
  padding: 10px 8px;
  margin: 0 -8px;
}

.rs-craft + .rs-craft {
  border-top: 1px solid var(--border);
}

.rs-craft-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  color: inherit;
}

.rs-caret {
  flex-shrink: 0;
  color: var(--muted-foreground);
  transition: transform 0.18s ease;
}

.rs-craft.open .rs-caret {
  transform: rotate(180deg);
}

.rs-craft-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-left: 20px;
  margin-top: 6px;
}

.rs-craft-meta {
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.rs-rate {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rs-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.rs-name {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-valid {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

/* 展开：分组/产线对比 */
.rs-lines {
  margin: 8px 0 2px 20px;
  border-left: 2px solid var(--muted, rgba(128, 128, 128, 0.18));
  padding-left: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rs-lgrp {
  min-width: 0;
}

.rs-lgrp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-lgrp-name {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-lgrp-valid {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.rs-lgrp-rate {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 组间对比条 */
.rs-lgrp-track {
  margin-top: 5px;
  height: 8px;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.12));
  overflow: hidden;
}

.rs-lgrp-fill {
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
  transition: width 0.3s ease;
}

/* 组内成员对比 */
.rs-lgrp-members {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rs-lm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-lm-rank {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--muted-foreground);
}

.rs-lm-rank.rank-1 { background: #f5a623; }
.rs-lm-rank.rank-2 { background: #a8b2c1; }
.rs-lm-rank.rank-3 { background: #cd8a5a; }

.rs-lm-name {
  width: 52px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-lm-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.12));
  overflow: hidden;
}

.rs-lm-bar-fill {
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
  transition: width 0.3s ease;
}

.rs-lm-valid {
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.rs-lm-rate {
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ===== 按报工人汇总：产线/组分组 ===== */
.rs-group {
  padding: 10px 8px;
  margin: 0 -8px;
}

.rs-group + .rs-group {
  border-top: 1px solid var(--border);
}

.rs-group-head {
  min-width: 0;
}

.rs-group-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-group-misc .rs-group-name {
  color: var(--muted-foreground);
}

.rs-group-name {
  flex: 1;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-group-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.rs-group-valid {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.rs-group-rate {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rs-group-body {
  margin-top: 4px;
}

.rs-row + .rs-row {
  border-top: 1px solid var(--border);
}

.rs-row {
  padding: 9px 2px;
  cursor: pointer;
}

@media (hover: hover) {
  .rs-craft:hover,
  .rs-row:hover {
    background: var(--muted, rgba(128, 128, 128, 0.06));
  }

  .rs-craft,
  .rs-row {
    border-radius: 12px;
  }
}

.rs-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-u-line {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--muted-foreground);
  background: var(--muted, rgba(128, 128, 128, 0.12));
  border-radius: 999px;
  padding: 1px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.rs-rank {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--muted-foreground);
}

.rs-rank.rank-1 { background: #f5a623; }
.rs-rank.rank-2 { background: #a8b2c1; }
.rs-rank.rank-3 { background: #cd8a5a; }

.rs-bar-track {
  margin-top: 6px;
  height: 5px;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.12));
  overflow: hidden;
}

.rs-bar-fill {
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
  transition: width 0.3s ease;
}

.rs-metrics {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 11.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.rs-m-low {
  color: #ef4444;
  font-weight: 600;
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

/* ===== 个人日报弹窗 ===== */
.rsd-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.rsd-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--foreground);
}

.rsd-sub {
  font-size: 12px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rsd-summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.rsd-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--muted, rgba(128, 128, 128, 0.06));
}

.rsd-num {
  font-size: 17px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.rsd-label {
  font-size: 10.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.rsd-list {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow-y: auto;
}

.rsd-day {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 2px;
}

.rsd-day + .rsd-day {
  border-top: 1px solid var(--border);
}

.rsd-date {
  width: 34px;
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.rsd-date.zero {
  color: var(--muted-foreground);
}

.rsd-bar-track {
  flex: 1;
  height: 7px;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.12));
  overflow: hidden;
  display: flex;
}

.rsd-bar-valid {
  height: 100%;
  background: var(--primary, #007aff);
  opacity: 0.85;
}

.rsd-bar-waste {
  height: 100%;
  background: #ef4444;
  opacity: 0.85;
}

.rsd-nums {
  width: 84px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rsd-v {
  color: var(--foreground);
  font-size: 12.5px;
  font-weight: 700;
}

.rsd-w {
  color: #ef4444;
  margin-left: 4px;
}

.rsd-c {
  margin-left: 4px;
}

/* ===== 桌面端 ===== */
@media (min-width: 768px) {
  .rsd-summary {
    grid-template-columns: repeat(4, 1fr);
  }

  .stats-row {
    grid-template-columns: repeat(4, 1fr);
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

  .rs-trend-plot,
  .rs-trend-svg {
    height: 160px;
  }
}
</style>
