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
        <span class="k-num">{{ fmt(bpStats.unprogrammed + (bpStats.craftActive || 0)) }}</span>
        <span class="k-label">未开始订单</span>
      </div>
      <div class="fs-kpi k-unprog">
        <span class="k-num">{{ fmt(bpStats.unprogrammed) }}</span>
        <span class="k-label">未编程</span>
      </div>
      <div class="fs-kpi k-run">
        <span class="k-num">{{ fmt(bpStats.craftActive) }}</span>
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

    <!-- 主体网格：左列辅助数据，右列加工单进度（主体） -->
    <div v-loading="loading" class="fs-grid">
      <!-- 左列：工序产出趋势 + 报工统计 -->
      <div class="fs-col">
        <!-- 工序产出趋势（近 7 天堆叠柱） -->
        <div class="fs-panel">
          <div class="fs-panel-head">
            <span class="fs-panel-title">工序产出趋势</span>
            <span class="fs-panel-sub">近 {{ trendDays.length }} 天良品/废品</span>
          </div>
          <svg ref="fsSvgEl" class="fs-svg" :viewBox="`0 0 ${fsW} ${fsH}`" preserveAspectRatio="xMidYMid meet">
            <g v-for="(gv, gi) in trendGrid" :key="gi">
              <line :x1="fsPadL" :x2="fsW - fsPadR" :y1="gv.y" :y2="gv.y" class="fs-grid-line" />
              <text :x="fsPadL - 6" :y="gv.y + 3.5" class="fs-axis-text" text-anchor="end">{{ fmt(gv.label) }}</text>
            </g>
            <g v-for="(d, di) in dailySeries" :key="di">
              <g>
                <title>{{ d.date }}：良品 {{ fmt(d.valid) }} 件 · 废品 {{ fmt(d.waste) }} 件 · 报工 {{ d.cnt }} 次</title>
                <!-- 各工序良品段：按工序顺序从下往上堆叠，颜色区分 -->
                <rect
                  v-for="(s, si) in d.segs"
                  :key="si"
                  :x="fsXAt(di) - fsBarW / 2"
                  :y="fsStackVal(fsSegCum(d.segs, si))"
                  :width="fsBarW"
                  :height="fsStackH(s.valid)"
                  rx="1"
                  :fill="s.color"
                  opacity="0.92"
                >
                  <title>{{ s.name }}：良品 {{ fmt(s.valid) }} 件</title>
                </rect>
                <!-- 废品：叠加在最顶部（红） -->
                <rect
                  v-if="d.waste > 0"
                  :x="fsXAt(di) - fsBarW / 2"
                  :y="fsStackVal(d.valid + d.waste)"
                  :width="fsBarW"
                  :height="fsStackH(d.waste)"
                  rx="1"
                  fill="#ef4444"
                  opacity="0.85"
                >
                  <title>废品 {{ fmt(d.waste) }} 件</title>
                </rect>
              </g>
            </g>
            <g v-for="(d, di) in trendTicks" :key="di">
              <text :x="fsXAt(d.i)" :y="fsH - 8" class="fs-axis-text" text-anchor="middle">{{ d.label }}</text>
            </g>
          </svg>
          <!-- 各工序汇总：色点 + 工序名（纯图例，不显示数量、不滚动） -->
          <div class="fs-craft-strip">
            <div v-for="(c, ci) in trendCrafts" :key="c.name" class="fs-craft-chip">
              <i class="fs-chip-dot" :style="{ background: fsColorOf(ci) }"></i>
              <span class="fs-craft-name">{{ c.name }}</span>
            </div>
            <div v-if="trendWasteTotal > 0" class="fs-craft-chip">
              <i class="fs-chip-dot" style="background:#ef4444"></i>
              <span class="fs-craft-name">废品</span>
            </div>
          </div>
        </div>

        <!-- 报工统计（工序 + 产线/组） -->
        <div class="fs-panel">
          <div class="fs-panel-head">
            <span class="fs-panel-title">报工统计</span>
            <span class="fs-panel-sub">近 {{ rsDays }} 天按工序</span>
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
        </div>

        <!-- 今日报工记录：全部记录 + 已过多长时间（占左列剩余空间，内部滚动） -->
        <div class="fs-panel fs-recent-panel">
          <div class="fs-panel-head">
            <span class="fs-panel-title">今日报工记录</span>
            <span class="fs-panel-sub">{{ todayStr() }} · 共 {{ recentReports.length }} 次</span>
          </div>
          <div v-if="recentReports.length" class="fs-recent">
            <div v-for="r in recentReports" :key="r.id" class="fs-recent-row">
              <span class="fs-recent-craft">{{ r.craftName }}</span>
              <span class="fs-recent-user">{{ r.reportUserName || '—' }}</span>
              <span class="fs-recent-num">{{ fmt(r.validNum) }}<em v-if="r.wasteNum > 0" class="fs-today-cw">/{{ fmt(r.wasteNum) }}</em></span>
              <span class="fs-recent-time">{{ agoText(r.reportTime) }}</span>
            </div>
          </div>
          <div v-else class="fs-empty">暂无报工记录</div>
        </div>
      </div>

      <!-- 中列（主体）：加工单进度，今日报工优先 -->
      <div class="fs-main">
        <div class="fs-panel fs-bills">
        <div class="fs-panel-head">
          <span class="fs-panel-title">加工单进度</span>
          <span class="fs-panel-sub">今日报工优先 · 共 {{ bills.length }} 张</span>
        </div>
        <div class="fs-bill-grid">
          <div
            v-for="b in bills"
            :key="b.code"
            class="fs-bill"
            :class="{ 'is-overdue': b.overdue, 'is-today': b.todayReport, 'is-unprog': b.status === 1 }"
          >
            <div class="fs-bill-top">
              <span class="fs-bill-code">{{ b.goodsName || '—' }}</span>
              <span class="fs-bill-tag" :class="billCls(b)">{{ billLabel(b) }}</span>
            </div>
            <div class="fs-bill-sub">{{ b.code }} · {{ b.htNo || '—' }}</div>
            <div class="fs-bill-progress">
              <div class="fs-bill-track"><i :style="{ width: b.progressPercent + '%' }"></i></div>
              <span class="fs-bill-pct">{{ b.progressPercent }}%</span>
              <span class="fs-bill-cnt">{{ b.doneCrafts }}/{{ b.totalCrafts }} 序</span>
            </div>
            <!-- 各工序圆形进度环 -->
            <div class="fs-bill-rings">
              <div v-for="(c, ci) in b.crafts" :key="ci" class="fs-ring">
                <svg viewBox="0 0 36 36" class="fs-ring-svg">
                  <circle cx="18" cy="18" r="15.5" class="fs-ring-bg" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.5"
                    class="fs-ring-fg"
                    :class="'st' + c.status"
                    :stroke-dasharray="ringDash(c.percent)"
                    transform="rotate(-90 18 18)"
                  />
                  <text x="18" y="21.5" class="fs-ring-text" text-anchor="middle">{{ c.percent }}%</text>
                </svg>
                <span class="fs-ring-name">{{ c.craftName }}</span>
              </div>
            </div>
            <div class="fs-bill-report">
              <span v-if="b.todayReport" class="fs-bill-today">
                <el-icon :size="11"><Clock /></el-icon>今日报工 {{ b.reportTimeText }}
              </span>
              <span v-else-if="b.lastReportTime" class="fs-bill-last">最后报工 {{ b.lastReportTime.slice(5, 16) }}</span>
              <span v-else class="fs-bill-last">暂无报工</span>
            </div>
          </div>
          <div v-if="!bills.length && !loading" class="fs-empty">暂无进行中加工单</div>
        </div>
        </div>
      </div>

      <!-- 右列：今日报工情况 + 今日报工人员 -->
      <div class="fs-today-col">
        <!-- 今日报工情况 -->
        <div class="fs-panel">
          <div class="fs-panel-head">
            <span class="fs-panel-title">今日报工情况</span>
            <span class="fs-panel-sub">{{ todayStr() }} · 近 24 小时报工汇总</span>
          </div>
          <div v-if="todayStats.persons > 0" class="fs-today">
            <div class="fs-today-stats">
              <div class="fs-today-stat">
                <span class="fs-today-num" style="color: var(--primary)">{{ fmt(todayStats.valid) }}</span>
                <span class="fs-today-label">今日良品（件）</span>
              </div>
              <div class="fs-today-stat">
                <span class="fs-today-num" style="color:#ef4444">{{ fmt(todayStats.waste) }}</span>
                <span class="fs-today-label">今日废品（件）</span>
              </div>
              <div class="fs-today-stat">
                <span class="fs-today-num">{{ fmt(todayStats.cnt) }}</span>
                <span class="fs-today-label">报工次数</span>
              </div>
              <div class="fs-today-stat">
                <span class="fs-today-num" style="color:#10b981">{{ fmt(todayStats.persons) }}</span>
                <span class="fs-today-label">报工人员</span>
              </div>
            </div>
            <!-- 今日各工序 mini 对比 -->
            <div v-if="todayCrafts.length" class="fs-today-crafts">
              <div v-for="c in todayCrafts" :key="c.name" class="fs-today-craft">
                <span class="fs-today-cname">{{ c.name }}</span>
                <span class="fs-today-cbar"><i :style="{ width: todayBarPct(c), background: c.color }"></i></span>
                <span class="fs-today-cnum">{{ fmt(c.valid) }}<em v-if="c.waste > 0" class="fs-today-cw">/{{ fmt(c.waste) }}</em></span>
              </div>
            </div>
          </div>
          <div v-else class="fs-empty">今日暂无报工数据</div>
        </div>

        <!-- 今日报工人员（占右列剩余空间，内部滚动） -->
        <div class="fs-panel fs-workers-panel">
          <div class="fs-panel-head">
            <span class="fs-panel-title">今日报工人员</span>
            <span class="fs-panel-sub">{{ todayWorkers.length }} 人 · 按产量降序</span>
          </div>
          <div ref="workersListEl" class="fs-workers" @mouseenter="stopWorkersCarousel" @mouseleave="startWorkersCarousel">
            <div v-for="(w, wi) in todayWorkers" :key="w.name" class="fs-worker">
              <span class="fs-worker-rank" :style="{ color: rankColor(wi) }">{{ wi + 1 }}</span>
              <span class="fs-worker-name">{{ w.name }}</span>
              <span class="fs-worker-line">{{ w.line }}</span>
              <span class="fs-worker-num">{{ fmt(w.valid) }}<em v-if="w.waste > 0" class="fs-today-cw">/{{ fmt(w.waste) }}</em></span>
            </div>
          </div>
          <div v-if="!todayWorkers.length" class="fs-empty">今日暂无报工</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../../../api'

const router = useRouter()

const loading = ref(true)
const refreshing = ref(false)

/* ===== 加工单进度统计 ===== */
const bpStats = reactive({ unprogrammed: 0, total: 0, inProgress: 0, overdue: 0, dueSoon: 0 })
const bills = ref([])

/* 今日日期（本地时区，YYYY-MM-DD），用于标记今日报工的单 */
function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ===== 工序产出趋势 ===== */
const trendDays = ref([])
const trendCrafts = ref([])

/* 近 7 天废品总数（chips 汇总展示） */
const trendWasteTotal = computed(() =>
  (trendCrafts.value || []).reduce((s, c) => s + (c.waste || 0), 0),
)

/* ===== 报工统计 ===== */
const reportCrafts = ref([])
const rsDays = ref(7)

/* ===== 最近报工（每次报工 + 已过时长） ===== */
const recentReports = ref([])

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；依赖 now 每秒刷新 */
function agoText(t) {
  if (!t) return ''
  void now.value
  const ts = new Date(t.replace(/-/g, '/')).getTime()
  if (Number.isNaN(ts)) return t
  const diff = Math.max(0, Date.now() - ts)
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} 天前`
  return t.slice(0, 10)
}

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
    const [bp, ct, rs, rr] = await Promise.all([
      api.get('/tasks/bill-progress', { params: { page: 1, pageSize: 60, status: '1,2', sortBy: 'latestReport' } }),
      api.get('/tasks/craft-trend', { params: { days: 7 } }),
      api.get('/tasks/report-stats', { params: { days: 7 } }),
      api.get('/tasks/recent-reports', { params: { today: 1 } }),
    ])
    Object.assign(bpStats, bp.stats || {})
    // 未编程单置顶（最需要处理），其余保持后端 latestReport 顺序（今日报工优先）
    const t = todayStr()
    const bpList = [...(bp.list || [])].sort((a, b) => Number(a.status === 1) - Number(b.status === 1))
    bills.value = bpList.map((b) => ({
      ...b,
      todayReport: (b.lastReportTime || '').slice(0, 10) === t,
      reportTimeText: (b.lastReportTime || '').slice(11, 16),
    }))
    trendDays.value = ct.daysList || []
    trendCrafts.value = (ct.crafts || []).map((c) => ({ name: c.name, valid: c.totals.valid, waste: c.totals.waste, cnt: c.totals.cnt, passRate: c.totals.passRate }))
    // 每日明细：按工序分色堆叠（segs 从下往上），废品叠加顶部
    dailySeries.value = (ct.daysList || []).map((d, i) => {
      let valid = 0
      let waste = 0
      let cnt = 0
      const segs = []
      ;(ct.crafts || []).forEach((c, ci) => {
        const p = c.points[i] || {}
        const v = p.valid || 0
        if (v > 0) segs.push({ name: c.name, valid: v, color: fsColorOf(ci) })
        valid += v
        waste += p.waste || 0
        cnt += p.cnt || 0
      })
      return { date: d, valid, waste, cnt, segs }
    })
    reportCrafts.value = (rs.crafts || []).map((c) => ({ name: c.name, valid: c.valid, waste: c.waste, cnt: c.cnt, passRate: c.passRate }))
    rsDays.value = rs.days || 7
    recentReports.value = rr.list || []
    // 今日报工情况：craft-trend 最后一天即今日（后端最少返回 7 天），t 已在上面定义
    const lastIdx = dailySeries.value.length - 1
    const last = dailySeries.value[lastIdx]
    if (last && last.date === t) {
      // 今日报工人员：从 report-stats 的人员 days 明细精确统计（含产线），按产量降序
      const workers = []
      for (const u of rs.users || []) {
        const d = (u.days || []).find((x) => (x.date || '').slice(0, 10) === t)
        if (d && ((d.valid || 0) > 0 || (d.waste || 0) > 0 || (d.cnt || 0) > 0)) {
          workers.push({ name: u.name, line: u.line || '未分组', valid: d.valid || 0, waste: d.waste || 0, cnt: d.cnt || 0 })
        }
      }
      workers.sort((a, b) => b.valid + b.waste - (a.valid + a.waste))
      todayWorkers.value = workers
      todayStats.value = {
        valid: last.valid,
        waste: last.waste,
        cnt: last.cnt,
        persons: workers.length,
      }
      // 今日各工序（含废品）
      todayCrafts.value = (ct.crafts || [])
        .map((c, ci) => {
          const p = (c.points || [])[lastIdx] || {}
          return { name: c.name, valid: p.valid || 0, waste: p.waste || 0, cnt: p.cnt || 0, color: fsColorOf(ci) }
        })
        .filter((c) => c.valid > 0 || c.waste > 0)
    } else {
      todayStats.value = { valid: 0, waste: 0, cnt: 0, persons: 0 }
      todayCrafts.value = []
      todayWorkers.value = []
    }
  } finally {
    loading.value = false
    // 数据就绪后启动自动轮播（今日报工人员，内容超出才滚动）
    await nextTick()
    watchFsSize()
    startWorkersCarousel()
  }
}

/* ===== 大屏自动轮播：今日报工人员纵向（慢速平滑往返 + 端点停留） ===== */
const workersListEl = ref(null)
let workersRaf = null
let workersDir = 1
let workersPos = 0
let workersHold = 0
const CAROUSEL_HOLD = 90 // 端点停留约 1.5 秒（60fps）
const WORKERS_SPEED = 0.4 // 人员列表每帧 0.4px（约 24px/s）

function startWorkersCarousel() {
  const el = workersListEl.value
  if (!el || workersRaf) return
  // 重启时清零残留的端点停留计数，避免恢复滚动后原地停顿
  workersHold = 0
  workersPos = el.scrollTop
  const step = () => {
    const max = el.scrollHeight - el.clientHeight
    if (max <= 2) {
      workersRaf = null
      return
    }
    // 端点停留：到边后先停一会，再反向滚回
    if (workersHold > 0) {
      workersHold--
      workersRaf = requestAnimationFrame(step)
      return
    }
    workersPos += workersDir * WORKERS_SPEED
    if (workersPos >= max) {
      workersPos = max
      workersDir = -1
      workersHold = CAROUSEL_HOLD
    } else if (workersPos <= 0) {
      workersPos = 0
      workersDir = 1
      workersHold = CAROUSEL_HOLD
    }
    el.scrollTop = workersPos
    workersRaf = requestAnimationFrame(step)
  }
  workersRaf = requestAnimationFrame(step)
}
function stopWorkersCarousel() {
  if (workersRaf) cancelAnimationFrame(workersRaf)
  workersRaf = null
}

/* ===== 今日报工情况（days=1 独立汇总） ===== */
const todayStats = ref({ valid: 0, waste: 0, cnt: 0, persons: 0 })
const todayCrafts = ref([])
const todayWorkers = ref([])

/** 今日各工序条宽：相对今日最大工序良品归一（至少 5% 可见） */
function todayBarPct(c) {
  const arr = todayCrafts.value
  const max = Math.max(1, ...arr.map((x) => x.valid || 0))
  return `${Math.max(5, Math.round(((c.valid || 0) / max) * 100))}%`
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
  if (b.status === 1) return '未编程'
  return b.statusName || ''
}
function billCls(b) {
  if (b.overdue) return 'is-red'
  if (b.dueSoon) return 'is-orange'
  if (b.status === 1) return 'is-gray'
  return 'is-blue'
}

/* 工序圆环：dasharray = 已完成弧长 + 剩余弧长（周长约 97.39） */
const RING_C = 2 * Math.PI * 15.5
function ringDash(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  return `${(RING_C * p) / 100} ${RING_C}`
}

/* ===== 工序产出趋势 SVG 布局 ===== */
const fsSvgEl = ref(null)
const fsW = 500
const fsH = ref(220) // 动态跟随容器宽高比，让图表内容铺满、贴合文本
const fsPadL = 56
const fsPadR = 12
const fsPadT = 12
const fsPadB = 24
const fsBarInset = 12 // 柱状图左右内边距，避免贴边
const fsPlotW = fsW - fsPadL - fsPadR
const fsPlotH = computed(() => fsH.value - fsPadT - fsPadB)

// 监听 SVG 实际尺寸，动态调整 viewBox 高度使内容占满（meet 不产生留白）
let fsResizeObs = null
function watchFsSize() {
  if (fsResizeObs) fsResizeObs.disconnect()
  const el = fsSvgEl.value
  if (!el) return
  fsResizeObs = new ResizeObserver((entries) => {
    const r = entries[0]?.target.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return
    const h = Math.round((fsW * r.height) / r.width)
    if (h >= 140 && h <= 480 && h !== fsH.value) fsH.value = h
  })
  fsResizeObs.observe(el)
}

const nDays = computed(() => Math.max(1, trendDays.value.length))

/** Y 轴上限：按数据最大值自动分段取整（留 8% 余量，柱顶不贴边且网格整齐） */
function niceMax(v) {
  if (v <= 0) return 1
  const need = v * 1.08
  const pow = Math.pow(10, Math.floor(Math.log10(need)))
  const d = need / pow
  const nice = d <= 1 ? 1 : d <= 1.5 ? 1.5 : d <= 2 ? 2 : d <= 2.5 ? 2.5 : d <= 3 ? 3 : d <= 4 ? 4 : d <= 5 ? 5 : 10
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
    arr.push({ label: val, y: fsPadT + fsPlotH.value - (fsPlotH.value * i) / 4 })
  }
  return arr
})
function fsStackVal(v) {
  return fsPadT + fsPlotH.value - (fsPlotH.value * v) / stackYMax.value
}
function fsStackH(v) {
  return (fsPlotH.value * v) / stackYMax.value
}

/** 各工序段累计到第 i 段（含）的良品总量，用于堆叠定位 */
function fsSegCum(segs, i) {
  let s = 0
  for (let k = 0; k <= i; k++) s += segs[k].valid
  return s
}

/* 工序分色：与按日汇总图表保持一致 */
const FS_COLORS = ['#007aff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
function fsColorOf(i) {
  return FS_COLORS[i % FS_COLORS.length]
}
function fsXAt(i) {
  const inner = fsPlotW - fsBarInset * 2
  return nDays.value === 1 ? fsPadL + fsPlotW / 2 : fsPadL + fsBarInset + (i / (nDays.value - 1)) * inner
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

onMounted(() => {
  load()
  clockTimer = setInterval(() => (now.value = new Date()), 1000)
  nextTick(watchFsSize)
})
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (fsResizeObs) fsResizeObs.disconnect()
  if (workersRaf) cancelAnimationFrame(workersRaf)
})
</script>

<style scoped>
.fs-page {
  height: 100vh;
  overflow: hidden;
  padding: 20px 24px 24px;
  background: var(--background);
  display: flex;
  flex-direction: column;
  gap: 14px;
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

/* ===== 主体网格：左右两列等宽，中列加工单进度为主 ===== */
.fs-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.7fr) minmax(0, 2.4fr) minmax(260px, 0.7fr);
  gap: 16px;
  align-items: stretch;
}

.fs-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  /* 左列整体限制在视口内，超出的内容在内部滚动 */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  padding-right: 2px;
}

.fs-panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  padding: 16px;
}

/* 工序产出趋势面板：占据左列更多空间，图表尽可能放大展示 */
.fs-col > .fs-panel:first-child {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.fs-col > .fs-panel:first-child .fs-svg {
  /* 图表占据 chips 上方全部空间，随面板高度自适应放大 */
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
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

/* ===== 坐标文字（保证可读，不随列宽过度缩小） ===== */
.fs-axis-text {
  font-size: 14px;
  font-weight: 600;
  fill: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

/* 各工序汇总 chips：色点标识，兼作图例；固定一行，左右两端对齐均匀分布 */
.fs-craft-strip {
  display: flex;
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 6px;
  /* 沉底显示，把上方空间让给柱状图 */
  margin-top: auto;
  padding-top: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding-bottom: 2px;
  /* 防止 flex 子项被压缩换行 */
  min-width: 0;
}

.fs-craft-strip::-webkit-scrollbar {
  display: none;
}

.fs-craft-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--muted);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.fs-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.fs-craft-name {
  color: var(--foreground);
  font-weight: 600;
}

.fs-craft-num {
  font-weight: 700;
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

/* ===== 今日报工记录 ===== */
/* 面板占左列剩余高度，列表超出时内部滚动 */
.fs-recent-panel {
  flex: 1 1 0;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}

.fs-recent-panel .fs-recent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  padding-right: 2px;
}

.fs-recent {
  display: flex;
  flex-direction: column;
}

.fs-recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
}

.fs-recent-row + .fs-recent-row {
  border-top: 1px dashed var(--border);
}

.fs-recent-craft {
  width: 42px;
  flex-shrink: 0;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-recent-user {
  flex: 1;
  min-width: 0;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-recent-num {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.fs-recent-time {
  flex-shrink: 0;
  width: 64px;
  font-size: 10.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.fs-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 右列主容器：今日报工 + 加工单进度 ===== */
.fs-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

/* ===== 右列：今日报工情况 + 今日报工人员 ===== */
.fs-today-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  padding-right: 2px;
}

/* ===== 今日报工情况 ===== */
.fs-today-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.fs-today-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--muted, rgba(128, 128, 128, 0.06));
}

.fs-today-num {
  font-size: 18px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.fs-today-label {
  font-size: 10.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
}

/* 今日各工序 mini 对比 */
.fs-today-crafts {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fs-today-craft {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.fs-today-cname {
  width: 44px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-today-cbar {
  flex: 1;
  height: 9px;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.12));
  overflow: hidden;
}

.fs-today-cbar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  opacity: 0.85;
  transition: width 0.3s ease;
}

.fs-today-cnum {
  width: 62px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.fs-today-cw {
  font-style: normal;
  color: #ef4444;
  font-size: 11px;
}

/* 今日报工人员列表 */
/* 面板占右列剩余高度，列表超出时内部滚动 */
.fs-workers-panel {
  flex: 1 1 0;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}

.fs-workers-panel .fs-workers {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  padding-right: 2px;
}

.fs-workers {
  display: flex;
  flex-direction: column;
}

.fs-worker {
  display: grid;
  grid-template-columns: 16px 64px 1fr 58px;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  font-size: 12px;
}

.fs-worker + .fs-worker {
  border-top: 1px dashed var(--border);
}

.fs-worker-rank {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.fs-worker-name {
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-worker-line {
  font-size: 10.5px;
  color: var(--muted-foreground);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-worker-num {
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* ===== 加工单进度（主体面板） ===== */
.fs-bills {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.fs-bill-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start;
  gap: 10px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  padding-right: 2px;
}

.fs-bill {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--background);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.fs-bill.is-overdue {
  border-color: rgba(255, 59, 48, 0.4);
}

/* 未编程：灰色虚线边框 + 淡灰底，与进行中区分 */
.fs-bill.is-unprog {
  border-style: dashed;
  border-color: rgba(128, 128, 128, 0.45);
  background: rgba(128, 128, 128, 0.05);
}

/* 今日有报工的加工单：蓝色高亮边框 + 淡蓝底 */
.fs-bill.is-today {
  border-color: rgba(0, 122, 255, 0.45);
  background: rgba(0, 122, 255, 0.05);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* 各工序圆形进度环：环 + 百分比 + 工序名，横向排列 */
.fs-bill-rings {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px 18px;
  margin-top: 10px;
  padding: 10px 6px 4px;
  border-radius: 12px;
  background: var(--muted, rgba(128, 128, 128, 0.05));
}

.fs-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 44px;
}

.fs-ring-svg {
  width: 44px;
  height: 44px;
  display: block;
}

.fs-ring-bg {
  fill: none;
  stroke: var(--border);
  stroke-width: 3.5;
}

.fs-ring-fg {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.4s ease;
}

.fs-ring-fg.st3 {
  stroke: var(--success, #34c759);
}

.fs-ring-fg.st2 {
  stroke: var(--primary);
}

.fs-ring-fg.st1 {
  stroke: #cbd5e1;
}

.fs-ring-fg.st4 {
  stroke: var(--warning);
}

/* 环内百分比文字 */
.fs-ring-text {
  font-size: 9.5px;
  font-weight: 700;
  fill: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.fs-ring-name {
  font-size: 10.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 报工时间行：今日报工高亮徽标 */
.fs-bill-report {
  margin-top: 8px;
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 10.5px;
}

.fs-bill-today {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  color: var(--primary);
  font-weight: 600;
  background: rgba(0, 122, 255, 0.1);
  border-radius: 999px;
  padding: 1px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-bill-last {
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
