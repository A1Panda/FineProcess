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
        <!-- 按工序汇总：工序为主，产线为次 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">按工序汇总</div>
            <div class="chart-desc">各工序累计产量与一次合格率，展开查看各产线/班组细分</div>
          </div>
          <div class="rs-list">
            <div v-for="(c, ci) in crafts" :key="c.name" class="rs-craft">
              <button class="rs-craft-head" :class="{ open: openSet.has(c.name) }" @click="toggleCraft(c.name)">
                <el-icon class="rs-caret" :size="12"><ArrowDown /></el-icon>
                <span class="rs-dot" :style="{ background: colorOf(ci) }"></span>
                <span class="rs-name">{{ c.name }}</span>
                <span class="rs-valid">{{ fmt(c.valid) }} 件</span>
              </button>
              <div class="rs-craft-meta">废品 {{ fmt(c.waste) }} · 报工 {{ c.cnt }} 次</div>
              <div v-if="openSet.has(c.name)" class="rs-lines">
                <div v-for="(l, li) in c.lines" :key="l.line" class="rs-line">
                  <div class="rs-line-top">
                    <span class="rs-line-name">{{ l.line }}</span>
                    <span class="rs-line-valid">{{ fmt(l.valid) }} 件</span>
                    <span class="rs-line-rate" :style="{ color: passColor(l.passRate) }">{{ l.passRate }}%</span>
                  </div>
                  <div class="rs-line-meta">废品 {{ fmt(l.waste) }} · 报工 {{ l.cnt }} 次</div>
                  <el-progress
                    class="rs-line-bar"
                    :percentage="l.passRate"
                    :show-text="false"
                    :stroke-width="5"
                    :color="passColor(l.passRate)"
                  />
                </div>
              </div>
              <div class="rs-pass">
                <span class="rs-pass-label">工序合格率</span>
                <el-progress
                  class="rs-pass-bar"
                  :percentage="c.passRate"
                  :show-text="false"
                  :stroke-width="6"
                  :color="passColor(c.passRate)"
                />
                <span class="rs-pass-num" :style="{ color: passColor(c.passRate) }">{{ c.passRate }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 按报工人汇总：按产线/组分组展示成员贡献 -->
        <div class="chart-card">
          <div class="chart-head">
            <div class="chart-title">按报工人汇总</div>
            <div class="chart-desc">窗口内按产线/组分组的人员产量贡献（组内按良品数降序，含所属产线/班组）</div>
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
                  <!-- 每日报工迷你柱：良品（蓝）上叠废品（红），悬浮看每日明细，点击看日报 -->
                  <div v-if="u.days && u.days.length" class="rs-user-bars">
                    <div
                      v-for="(d, di) in u.days"
                      :key="di"
                      class="rs-ub-col"
                      :title="`${d.date.slice(5)}：良 ${fmt(d.valid)} · 废 ${fmt(d.waste)} · ${d.cnt} 次`"
                    >
                      <div class="rs-ub-track">
                        <div class="rs-ub-stack">
                          <div class="rs-ub-waste" :style="{ height: ubH(u, d.waste) }"></div>
                          <div class="rs-ub-valid" :style="{ height: ubH(u, d.valid) }"></div>
                        </div>
                      </div>
                    </div>
                    <span class="rs-ub-hint">近 {{ u.days.length }} 天逐日报工</span>
                  </div>
                  <div class="rs-bar-track">
                    <div class="rs-bar-fill" :style="{ width: barPct(u.valid), background: rankColor(ui) }"></div>
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

        <!-- 每日明细列表 -->
        <div class="rsd-list">
          <div v-for="(d, di) in userDaily.days" :key="di" class="rsd-day">
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
import { ref, computed, onMounted, watch } from 'vue'
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

/* ===== 排行样式 ===== */
const maxUserValid = computed(() => {
  let m = 0
  for (const u of users.value) m = Math.max(m, u.valid)
  return m
})
function barPct(v) {
  return maxUserValid.value > 0 ? Math.max(3, (v / maxUserValid.value) * 100) : 0
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

/** 成员每日迷你柱高度（良品/废品分别相对该人窗口内最大单日良品+废品归一） */
function ubH(u, v) {
  const selfMax = Math.max(1, ...(u.days || []).map((d) => (d.valid || 0) + (d.waste || 0)))
  // 相对本人最大值归一（最多占满），保证跨人不失真
  return `${Math.max(0, Math.round((v / selfMax) * 100))}%`
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

onMounted(load)
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
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
}

.range-text {
  max-width: 132px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
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

/* ===== 汇总列表 ===== */
.rs-list {
  display: flex;
  flex-direction: column;
}

.rs-row + .rs-row {
  border-top: 1px solid var(--border);
}

.rs-row {
  padding: 10px 2px;
}

/* 工序分组：头部可展开 */
.rs-craft {
  border-radius: 12px;
  padding: 10px 10px;
  margin: 0 -8px;
  transition: background 0.15s ease;
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

.rs-craft-head.open .rs-caret {
  transform: rotate(180deg);
}

.rs-craft-meta {
  margin: 3px 0 0 37px;
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* 产线子行 */
.rs-lines {
  margin: 8px 0 0 18px;
  border-left: 2px solid var(--muted, rgba(128, 128, 128, 0.18));
  padding-left: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rs-line {
  min-width: 0;
}

.rs-line-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-line-name {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-line-valid {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.rs-line-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.rs-line-rate {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rs-line-bar {
  width: 100%;
  margin-top: 4px;
}

/* 报工人所属产线标签 */
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

/* 按报工人汇总：产线/组分组 */
.rs-group {
  padding: 10px 2px;
}

.rs-group + .rs-group {
  border-top: 1px solid var(--border);
}

.rs-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-group-misc .rs-group-name {
  color: var(--muted-foreground);
}

.rs-group-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-group-meta {
  margin-left: auto;
  flex-shrink: 0;
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

@media (hover: hover) {
  .rs-row {
    border-radius: 12px;
    padding: 10px 10px;
    margin: 0 -8px;
    transition: background 0.15s ease;
  }

  .rs-row:hover,
  .rs-craft:hover {
    background: var(--muted, rgba(128, 128, 128, 0.06));
  }
}

.rs-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rs-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.rs-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-valid {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
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

.rs-pass {
  margin-top: 7px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rs-pass-label {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
}

.rs-pass-bar {
  flex: 1;
  min-width: 0;
}

.rs-pass-bar :deep(.el-progress-bar__outer) {
  background: var(--muted, rgba(128, 128, 128, 0.12));
}

.rs-pass-num {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: #10b981;
  font-variant-numeric: tabular-nums;
}

/* 报工人排行：名次徽章 + 相对产量条 */
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

/* ===== 成员每日报工迷你柱 ===== */
.rs-user-bars {
  margin-top: 8px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
}

.rs-ub-col {
  flex: 1;
  min-width: 0;
}

.rs-ub-track {
  height: 26px;
  border-radius: 6px;
  background: var(--muted, rgba(128, 128, 128, 0.1));
  overflow: hidden;
}

.rs-ub-stack {
  display: flex;
  flex-direction: column-reverse;
  height: 100%;
  width: 100%;
}

.rs-ub-valid {
  width: 100%;
  min-height: 0;
  background: var(--primary, #007aff);
  opacity: 0.85;
  border-radius: 2px;
}

.rs-ub-waste {
  width: 100%;
  min-height: 0;
  background: #ef4444;
  opacity: 0.85;
  border-radius: 2px;
}

.rs-ub-hint {
  flex-shrink: 0;
  margin-left: 6px;
  font-size: 10px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.rs-row {
  cursor: pointer;
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
}
</style>
