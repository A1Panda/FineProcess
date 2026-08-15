<template>
  <section class="wf-page">
    <!-- 统计条 -->
    <div class="stats-row">
      <div class="stat-card s-blue">
        <span class="stat-ico"><el-icon :size="15"><VideoPlay /></el-icon></span>
        <span class="stat-num">{{ stats.total }}</span>
        <span class="stat-label">进行中订单</span>
      </div>
      <div class="stat-card s-green">
        <span class="stat-ico"><el-icon :size="15"><Finished /></el-icon></span>
        <span class="stat-num">{{ stats.withData }}</span>
        <span class="stat-label">可估算完成</span>
      </div>
      <div class="stat-card s-purple">
        <span class="stat-ico"><el-icon :size="15"><Box /></el-icon></span>
        <span class="stat-num">{{ fmt(stats.weekReported) }}</span>
        <span class="stat-label">近7天报工（件次）</span>
      </div>
      <div class="stat-card s-red">
        <span class="stat-ico"><el-icon :size="15"><WarningFilled /></el-icon></span>
        <span class="stat-num">{{ stats.risk }}</span>
        <span class="stat-label">预计逾期风险</span>
      </div>
    </div>

    <!-- 工具栏：搜索 + 刷新 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="搜索单号 / HT图号 / 产品名"
        clearable
      >
        <template #prefix><el-icon :size="15"><Search /></el-icon></template>
      </el-input>
      <button class="refresh-btn" :class="{ spinning: refreshing }" aria-label="刷新数据" @click="refreshData">
        <el-icon :size="16"><Refresh /></el-icon>
      </button>
    </div>

    <!-- 订单列表：按 HT 图号分组 -->
    <div v-loading="loading" class="bill-list">
      <template v-for="g in groups" :key="g.htNo || '__empty__'">
        <div class="wf-group">
          <span class="wf-group-badge">HT</span>
          <span class="wf-group-name">{{ g.htNo || '未填图号' }}</span>
          <span class="wf-group-count">{{ g.rows.length }} 张</span>
          <span v-if="g.risk > 0" class="wf-group-risk">含 {{ g.risk }} 张逾期风险</span>
        </div>
        <div v-for="b in g.rows" :key="b.code" class="wf-card">
        <!-- 头部 -->
        <div class="wf-line1">
          <span class="wf-name">{{ b.goodsName || b.code }}</span>
          <span class="wf-tag st-run">进行中</span>
        </div>
        <div class="wf-sub">{{ b.code }} · {{ b.spec }}</div>
        <div class="wf-meta">
          <span class="wf-qty"><el-icon :size="13"><Box /></el-icon>计划 {{ fmt(b.num) }} {{ b.unitName }}</span>
          <span class="wf-due" :class="{ 'is-overdue': b.overrunDelivery }">交期 {{ b.deliveryDate || '未设置' }}</span>
        </div>

        <!-- 进度 -->
        <div class="wf-progress-row">
          <el-progress
            class="wf-progress"
            :percentage="b.progressPercent"
            :show-text="false"
            :stroke-width="7"
            :color="b.progressPercent >= 100 ? '#10b981' : 'var(--primary, #007aff)'"
          />
          <span class="wf-pct">{{ b.progressPercent }}%</span>
          <span class="wf-count">已报 {{ fmt(b.reported) }}</span>
        </div>

        <!-- 工序占比：不同颜色对应不同工序，段长=该工序占总件次的比例，段内填充=该工序完成度 -->
        <div v-if="b.crafts.length" class="wf-stack-wrap">
          <div class="wf-stack" :title="stackTooltip(b)">
            <div v-for="c in b.crafts" :key="c.name" class="wf-stack-seg" :style="{ width: segW(c, b) }">
              <div class="wf-stack-fill" :style="{ width: fillW(c), background: craftColor(c.name) }"></div>
            </div>
          </div>
          <div class="wf-legend">
            <span v-for="c in b.crafts" :key="'lg' + c.name" class="wf-lg">
              <i class="wf-lg-dot" :style="{ background: craftColor(c.name) }"></i>
              {{ c.name }}
              <b :class="{ done: c.status === 3 }">{{ craftPct(c) }}</b>
            </span>
            <span v-if="b.remainingCrafts > 0" class="wf-craft-left">剩 {{ b.remainingCrafts }} 道</span>
          </div>
        </div>
        <div v-else class="wf-craft-none">暂无工序数据</div>

        <!-- 近 7 天报工迷你图：点击日期查看当日分工序报工 -->
        <div class="wf-bars">
          <div
            v-for="(d, i) in b.weekDays"
            :key="i"
            class="wf-col"
            :class="{ pop: dayPop && dayPop.code === b.code && dayPop.date === d.date }"
            @click.stop="toggleDay(b, d, i)"
          >
            <div class="wf-bar-wrap">
              <div class="wf-bar" :class="{ zero: d.valid === 0 }" :style="{ height: barH(d.valid, b) }"></div>
            </div>
            <span class="wf-date">{{ d.date.slice(5) }}</span>
          </div>
          <span class="wf-week-total">7天共 {{ fmt(b.weekTotal) }} 件次 · 点柱看分工序</span>

          <!-- 当日分工序报工浮层 -->
          <div v-if="dayPop && dayPop.code === b.code" class="wf-day-pop" :style="{ left: dayPop.left, transform: dayPop.transform }">
            <div class="wdp-title">{{ dayPop.date.slice(5) }} 报工明细</div>
            <template v-if="dayPop.crafts.length">
              <div v-for="c in dayPop.crafts" :key="c.name" class="wdp-row">
                <i class="wdp-dot" :style="{ background: craftColor(c.name) }"></i>
                <span class="wdp-name">{{ c.name }}</span>
                <b class="wdp-val">{{ fmt(c.valid) }} 件</b>
              </div>
            </template>
            <div v-else class="wdp-empty">当日无报工</div>
          </div>
        </div>

        <!-- 估算完成日期 -->
        <div class="wf-forecast">
          <div class="wf-fc-item">
            <span class="wf-fc-label">日均件次</span>
            <span class="wf-fc-val">{{ b.dailyAvg ? b.dailyAvg + ' 件/天' : '—' }}</span>
          </div>
          <div class="wf-fc-item">
            <span class="wf-fc-label">剩余件次</span>
            <span class="wf-fc-val">{{ fmt(b.remaining) }} 件</span>
          </div>
          <div class="wf-fc-item">
            <span class="wf-fc-label">预计完成</span>
            <span class="wf-fc-val" :class="{ 'is-risk': b.overrunDelivery }">{{ etaDateText(b) }}</span>
            <span class="wf-fc-note" :class="{ 'is-risk': b.overrunDelivery }">{{ etaNoteText(b) }}</span>
          </div>
        </div>
        </div>
      </template>

      <div v-if="!loading && list.length === 0" class="empty">
        <el-icon :size="36"><Document /></el-icon>
        <p class="empty-text">没有进行中的加工单</p>
        <p class="empty-desc">试试调整搜索条件，或点击右上角刷新同步数据</p>
      </div>
    </div>

    <!-- 触底加载更多 -->
    <div v-show="list.length > 0" ref="loadMoreRef" class="load-more" :class="{ end: noMore }">
      <el-icon v-if="!noMore && loadingMore" class="lm-spin" :size="14"><Loading /></el-icon>
      <span v-if="noMore">已加载全部 {{ fmt(total) }} 条</span>
      <span v-else-if="loadingMore">加载中…</span>
      <span v-else>上滑加载更多</span>
    </div>
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
const keyword = ref('')
const stats = reactive({ total: 0, withData: 0, weekReported: 0, risk: 0 })
/** 当前展开的每日分工序明细：{ code, date, crafts, left, transform } */
const dayPop = ref(null)

/** 按 HT 图号分组：保持列表顺序（已按预计完成排序），同图号子单聚合到一组 */
const groups = computed(() => {
  const out = []
  for (const b of list.value) {
    const key = b.htNo || ''
    const last = out[out.length - 1]
    if (last && last.htNo === key) {
      last.rows.push(b)
      if (b.overrunDelivery) last.risk++
    } else {
      out.push({ htNo: key, rows: [b], risk: b.overrunDelivery ? 1 : 0 })
    }
  }
  return out
})

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

/** 近 7 天迷你柱：按单内最大值归一 */
function barH(v, b) {
  const max = Math.max(...b.weekDays.map((d) => d.valid))
  return max > 0 ? `${Math.max(4, Math.round((v / max) * 100))}%` : '0%'
}

/** 点击日期柱：展开当日分工序报工明细（再点或点别处关闭） */
function toggleDay(b, d, i) {
  if (dayPop.value && dayPop.value.code === b.code && dayPop.value.date === d.date) {
    dayPop.value = null
    return
  }
  const detail = (b.weekDaysDetail || []).find((x) => x.date === d.date)
  const len = b.weekDays.length
  const pct = len > 1 ? (i / (len - 1)) * 100 : 50
  let transform = 'translateX(-50%)'
  if (pct < 15) transform = 'translateX(0)'
  else if (pct > 85) transform = 'translateX(-100%)'
  dayPop.value = {
    code: b.code,
    date: d.date,
    crafts: detail?.crafts || [],
    left: `${pct}%`,
    transform,
  }
}

/** 点击页面其它位置关闭明细浮层 */
function onDocClick() {
  dayPop.value = null
}

/** 关闭当前卡片上的浮层（切页/刷新时一并清理） */
function closePop() {
  dayPop.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  load()
})

onUnmounted(() => {
  moreObserver?.disconnect()
  document.removeEventListener('click', onDocClick)
})

/* ===== 工序占比条 ===== */
const CRAFT_COLORS = { 雕刻: '#007aff', 打磨: '#f59e0b', 涂层: '#8b5cf6', 打码: '#10b981' }

/** 工序固定配色，未知工序兜底灰色 */
function craftColor(name) {
  return CRAFT_COLORS[name] || '#64748b'
}

/** 段长 = 该工序计划数 / 总件次 */
function segW(c, b) {
  const total = b.crafts.reduce((s, x) => s + (x.plan || 0), 0)
  return total > 0 ? `${Math.round((c.plan / total) * 1000) / 10}%` : '0%'
}

/** 段内填充 = 该工序完成度 */
function fillW(c) {
  return c.plan > 0 ? `${Math.max(0, Math.min(100, Math.round((c.valid / c.plan) * 1000) / 10))}%` : '0%'
}

/** 工序完成百分比文案 */
function craftPct(c) {
  return c.plan > 0 ? `${Math.round((c.valid / c.plan) * 100)}%` : '—'
}

/** 工序堆叠条 tooltip：每道工序的完成度 + 近 7 天速度 + 还需天数 */
function stackTooltip(b) {
  return b.crafts
    .map((c) => {
      const pct = craftPct(c)
      if (c.status === 3) return `${c.name}：${pct} 已完成`
      const rate = c.daily > 0 ? `，近7天 ${fmt(c.weekValid)} 件/${c.weekActive}天` : ''
      const left = c.etaDays != null ? `，还需约 ${c.etaDays} 天` : ''
      return `${c.name}：${fmt(c.valid)}/${fmt(c.plan)}（${pct}）${rate}${left}`
    })
    .join('\n')
}

/** 预计完成文案：无数据灰字 / 今日完成 / 正常 / 超交期标红 */
/** 预计完成日期（独立一行，避免与状态词拼接溢出） */
function etaDateText(b) {
  return b.etaDate || '暂无报工数据'
}

/** 预计完成状态词：今日可完成 / 超交期 / 完成 */
function etaNoteText(b) {
  if (!b.etaDate) return '—'
  if (b.etaDays === 0) return '今日可完成'
  return b.overrunDelivery ? '超交期' : '预计完成'
}

function buildParams(p) {
  return { keyword: keyword.value || undefined, page: p, pageSize }
}

async function load() {
  loading.value = true
  try {
    const res = await api.get('/tasks/bill-forecast', { params: buildParams(page.value) })
    list.value = res.list || []
    total.value = res.total || 0
    Object.assign(stats, res.stats || {})
  } finally {
    loading.value = false
  }
}

/** 刷新：先短按同步一次（加工单/任务补拉近 3 天已完成，刷新后已完成的订单从预测中移除），再重新加载列表 */
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
    const res = await api.get('/tasks/bill-forecast', { params: buildParams(nextPage) })
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

/** 输入即搜索：关键词防抖 400ms 后自动刷新 */
let kwTimer = null
watch(keyword, () => {
  closePop()
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => reload(1), 400)
})
</script>

<style scoped>
.wf-page {
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
.s-green .stat-ico { color: #10b981; background: rgba(16, 185, 129, 0.12); }
.s-purple .stat-ico { color: #8b5cf6; background: rgba(139, 92, 246, 0.12); }
.s-red .stat-ico { color: #ef4444; background: rgba(239, 68, 68, 0.12); }

.stat-num {
  font-size: 19px;
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

.search-input {
  flex: 1;
}

.search-input :deep(.el-input__wrapper) {
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
  animation: wf-spin 0.9s linear infinite;
}

@keyframes wf-spin {
  to { transform: rotate(360deg); }
}

/* ===== 订单卡片 ===== */
.bill-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}

/* ===== HT 图号分组头 ===== */
.wf-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.wf-group-badge {
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

.wf-group-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-group-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 8px;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}

.wf-group-risk {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
}

.wf-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 13px 14px;
}

.wf-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wf-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-tag {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  border-radius: 999px;
  padding: 1px 8px;
  line-height: 1.6;
}

.st-run { color: var(--primary); background: var(--primary-soft, rgba(0, 122, 255, 0.12)); }

.wf-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-meta {
  margin-top: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.wf-qty {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.wf-due.is-overdue {
  color: #ef4444;
  font-weight: 500;
}

.wf-progress-row {
  margin-top: 9px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.wf-progress {
  flex: 1;
  min-width: 0;
}

.wf-progress :deep(.el-progress-bar__outer) {
  background: var(--muted, rgba(128, 128, 128, 0.12));
}

.wf-pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.wf-count {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ===== 工序占比条 ===== */
.wf-stack-wrap {
  margin-top: 9px;
}

.wf-stack {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
  background: var(--muted, rgba(128, 128, 128, 0.15));
}

.wf-stack-seg {
  position: relative;
  height: 100%;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.18));
  overflow: hidden;
}

.wf-stack-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}

.wf-legend {
  margin-top: 6px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 10.5px;
  color: var(--muted-foreground);
}

.wf-lg {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.wf-lg-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.wf-lg b {
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.wf-lg b.done {
  color: #10b981;
}

.wf-craft-left {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.wf-craft-none {
  margin-top: 9px;
  font-size: 11px;
  color: var(--muted-foreground);
}

/* ===== 近 7 天报工迷你图 ===== */
.wf-bars {
  margin-top: 10px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 10px 6px;
  background: var(--background, transparent);
  position: relative;
}

.wf-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  border-radius: 8px;
  padding: 2px 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease;
}

.wf-col.pop {
  background: var(--primary-soft, rgba(0, 122, 255, 0.1));
}

.wf-bar-wrap {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}

.wf-bar {
  width: 70%;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, var(--primary-light, rgba(0, 122, 255, 0.55)), var(--primary));
  transition: height 0.2s ease;
  pointer-events: none;
}

.wf-bar.zero {
  background: var(--muted, rgba(128, 128, 128, 0.2));
}

.wf-date {
  font-size: 9px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.wf-col.pop .wf-date {
  color: var(--primary);
  font-weight: 600;
}

.wf-week-total {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

/* ===== 当日分工序报工浮层 ===== */
.wf-day-pop {
  position: absolute;
  bottom: calc(100% + 2px);
  z-index: 6;
  min-width: 128px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 8px 10px;
  box-shadow: 0 12px 28px -8px rgba(0, 0, 0, 0.18);
  animation: wdp-in 0.16s ease;
}

@keyframes wdp-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
  }
}

.wdp-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted-foreground);
  padding-bottom: 5px;
  margin-bottom: 5px;
  border-bottom: 1px solid var(--border);
}

.wdp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}

.wdp-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.wdp-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wdp-val {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.wdp-empty {
  padding: 4px 0;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 估算完成 ===== */
.wf-forecast {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px dashed var(--border);
  padding-top: 9px;
}

.wf-fc-item {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-fc-item + .wf-fc-item {
  border-left: 1px solid var(--border);
  padding-left: 10px;
}

.wf-fc-label {
  font-size: 10.5px;
  color: var(--muted-foreground);
}

.wf-fc-val {
  max-width: 100%;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-fc-val.is-risk {
  color: #ef4444;
}

/* 预计完成状态词：独立一行，避免与日期拼接溢出 */
.wf-fc-note {
  max-width: 100%;
  font-size: 10px;
  font-weight: 500;
  color: var(--success);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-fc-note.is-risk {
  color: #ef4444;
}

.wf-fc-note:empty {
  display: none;
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .wf-group {
    grid-column: 1 / -1;
  }
}
</style>
