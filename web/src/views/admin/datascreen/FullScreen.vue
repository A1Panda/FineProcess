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
        <button
          class="theme-toggle"
          :class="{ anim: themeAnim }"
          aria-label="切换深色模式"
          title="切换深色模式"
          @click="onToggleTheme"
        >
          <span class="toggle-icon">
            <el-icon :size="15"><Moon v-if="isDark" /><Sunny v-else /></el-icon>
          </span>
        </button>
        <button
          class="fs-btn fs-scroll-toggle"
          :class="{ on: scrollEnabled, off: !scrollEnabled }"
          :aria-label="scrollEnabled ? '自动滚动已开启，点击关闭' : '自动滚动已关闭，点击开启'"
          :title="scrollEnabled ? '自动滚动已开启，点击关闭' : '自动滚动已关闭，点击开启'"
          @click="toggleScroll"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 6.5 12 11.5 17 6.5" />
            <path d="M7 12.5 12 17.5 17 12.5" />
          </svg>
        </button>
        <button class="fs-btn" :class="{ spinning: refreshing }" aria-label="刷新" @click="refreshData">
          <el-icon :size="15"><Refresh /></el-icon>
        </button>
        <button class="fs-btn fs-exit" aria-label="退出全屏" @click="router.push('/admin/data/bill-progress')">
          <el-icon :size="15"><Close /></el-icon>
        </button>
      </div>
    </header>

    <!-- KPI 统计条：点击可联动下方加工单进度 -->
    <div class="fs-kpis">
      <button
        class="fs-kpi k-total"
        :class="{ active: kpiFilter === 'todo' }"
        @click="setKpiFilter('todo')"
      >
        <span class="k-num">{{ fmt(bpStats.noStart) }}</span>
        <span class="k-label">未开始订单</span>
      </button>
      <button
        class="fs-kpi k-unprog"
        :class="{ active: kpiFilter === 'unprog' }"
        @click="setKpiFilter('unprog')"
      >
        <span class="k-num">{{ fmt(bpStats.unprogrammed) }}</span>
        <span class="k-label">未编程</span>
      </button>
      <button
        class="fs-kpi k-run"
        :class="{ active: kpiFilter === 'run' }"
        @click="setKpiFilter('run')"
      >
        <span class="k-num">{{ fmt(bpStats.craftActive) }}</span>
        <span class="k-label">进行中</span>
      </button>
      <button
        class="fs-kpi k-overdue"
        :class="{ active: kpiFilter === 'overdue' }"
        @click="setKpiFilter('overdue')"
      >
        <span class="k-num">{{ fmt(bpStats.overdue) }}</span>
        <span class="k-label">已逾期</span>
      </button>
      <button
        class="fs-kpi k-soon"
        :class="{ active: kpiFilter === 'soon' }"
        @click="setKpiFilter('soon')"
      >
        <span class="k-num">{{ fmt(bpStats.dueSoon) }}</span>
        <span class="k-label">临期(3天内)</span>
      </button>
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
            <g v-for="(d, di) in dailySeries" :key="di" class="fs-trend-day" @click="openDayDetail(d)">
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
        <div class="fs-panel fs-recent-panel" :class="{ 'scroll-off': !scrollEnabled }">
          <div class="fs-panel-head">
            <span class="fs-panel-title">今日报工记录</span>
            <span class="fs-panel-sub">{{ todayStr() }} · 共 {{ recentReports.length }} 次</span>
          </div>
          <div v-if="recentReports.length" class="fs-recent">
            <div v-for="r in recentReports" :key="r.id" class="fs-recent-row">
              <span class="fs-recent-craft" :style="{ color: craftNameColor(r.craftName) }">{{ r.craftName }}</span>
              <span class="fs-recent-goods" :title="r.goodsName">
                <span
                  class="fs-recent-goods-inner"
                  :class="{ 'is-run': r.goodsOverflow && scrollEnabled }"
                  :style="{ '--shift': r.goodsShift + 'px', '--dur': r.goodsDur + 's' }"
                >{{ r.goodsName || '—' }}</span>
              </span>
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
          <span class="fs-panel-sub">{{ kpiFilterLabel }} · 共 {{ filteredBills.length }} 张</span>
        </div>
        <div class="fs-bill-grid">
          <div
            v-for="b in filteredBills"
            :key="b.code"
            class="fs-bill"
            :class="{ 'is-overdue': b.overdue, 'is-today': b.todayReport, 'is-unprog': b.status === 1, 'is-paused': b.status === 5 }"
            @click="openBillDetail(b)"
          >
            <div class="fs-bill-top">
              <span class="fs-bill-code">{{ b.goodsName || '—' }}</span>
              <span class="fs-bill-tag" :class="billCls(b)">{{ billLabel(b) }}</span>
            </div>
            <div class="fs-bill-sub">{{ b.code }} · {{ b.htNo || '—' }}</div>
            <div class="fs-bill-progress">
              <div class="fs-bill-track">
                <i
                  v-for="(c, ci) in b.crafts"
                  :key="ci"
                  :style="{ width: billSegWidth(c, b), background: craftNameColor(c.craftName) }"
                  :title="c.craftName + ' ' + (c.percent || 0) + '%'"
                ></i>
              </div>
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
              <span class="fs-bill-report-side">
                <span v-if="b.todayReport" class="fs-bill-today">
                  <el-icon :size="11"><Clock /></el-icon>今日报工 {{ b.reportTimeText }}
                </span>
                <span v-else-if="b.lastReportTime" class="fs-bill-last">最后报工 {{ b.lastReportTime.slice(5, 16) }}</span>
                <span v-else class="fs-bill-last">暂无报工</span>
              </span>
              <span v-if="b.etaDate" class="fs-bill-eta" :class="{ risk: b.overrunDelivery }">
                <el-icon :size="11"><Calendar /></el-icon>预计 {{ b.etaDate.slice(5) }}
              </span>
            </div>
          </div>
          <div v-if="!filteredBills.length && !loading" class="fs-empty">{{ kpiFilter === 'all' ? '暂无进行中加工单' : '该分类下暂无加工单' }}</div>
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

    <!-- 工序产出趋势：点击柱子查看当日明细 -->
    <el-dialog v-model="dayDlg" :title="dayDetailTitle" width="600px" append-to-body align-center class="fs-dlg-day">
      <div v-if="dayDetail" class="fs-day-detail">
        <!-- 摘要：统一卡片内三列，竖线分隔 -->
        <div class="fs-day-summary">
          <div class="fs-day-sum-cell">
            <em class="fs-day-sum-num is-primary">{{ fmt(dayDetail.valid) }}</em>
            <span class="fs-day-sum-label">良品（件）</span>
          </div>
          <div class="fs-day-sum-cell">
            <em class="fs-day-sum-num" :class="{ 'is-waste': dayDetail.waste > 0 }">{{ fmt(dayDetail.waste) }}</em>
            <span class="fs-day-sum-label">废品（件）</span>
          </div>
          <div class="fs-day-sum-cell">
            <em class="fs-day-sum-num">{{ dayDetail.cnt }}</em>
            <span class="fs-day-sum-label">报工次数</span>
          </div>
        </div>

        <!-- 工序产出：色点 + 名称 + 占比条 + 数值 -->
        <div class="fs-day-section">
          <div class="fs-day-sec-title">工序产出</div>
          <div v-if="dayDetail.segs.length" class="fs-day-list">
            <div v-for="(s, si) in dayDetail.segs" :key="si" class="fs-day-row">
              <i class="fs-chip-dot" :style="{ background: s.color }"></i>
              <span class="fs-day-name">{{ s.name }}</span>
              <span class="fs-day-bar">
                <i class="fs-day-bar-in" :style="{ width: dayPct(s), background: s.color }"></i>
              </span>
              <span class="fs-day-nums">
                <b class="fs-day-valid">{{ fmt(s.valid) }}</b>
                <i v-if="s.waste > 0" class="fs-day-waste">{{ fmt(s.waste) }}</i>
                <em class="fs-day-cnt">{{ s.cnt }}次</em>
              </span>
            </div>
          </div>
          <div v-else class="fs-day-empty">当日暂无报工</div>
        </div>

        <!-- 报工人员：工序色点 + 人员胶囊 -->
        <div class="fs-day-section">
          <div class="fs-day-sec-title">报工人员</div>
          <div v-if="dayDetailWorkers" class="fs-day-list">
            <div v-if="dayDetailWorkers.length" class="fs-day-list-inner">
              <div v-for="g in dayDetailWorkers" :key="g.craft" class="fs-day-wrow">
                <span class="fs-day-wname">
                  <i class="fs-chip-dot" :style="{ background: craftColor(g.craft) }"></i>
                  {{ g.craft }}
                </span>
                <span class="fs-day-wchips">
                  <span v-for="w in g.workers" :key="w.name" class="fs-day-wchip">
                    {{ w.name }} <b>{{ fmt(w.valid) }}</b><em v-if="w.waste > 0" class="fs-day-cw">/{{ fmt(w.waste) }}</em>
                  </span>
                </span>
              </div>
            </div>
            <div v-else class="fs-day-empty">暂无人员明细</div>
          </div>
          <div v-else class="fs-day-empty">加载人员明细…</div>
        </div>
      </div>
    </el-dialog>

    <!-- 加工单进度：点击卡片查看加工单详情 -->
    <el-dialog v-model="billDlg" :title="billDetailTitle" width="600px" append-to-body align-center>
      <div v-if="billDetail" class="fs-bill-detail">
        <!-- 加工单信息卡 -->
        <div class="fs-bill-d-card">
          <div class="fs-bill-d-head">
            <span class="fs-bill-d-goods" :title="billDetail.goodsName">{{ billDetail.goodsName || '—' }}</span>
            <span class="fs-bill-tag" :class="billCls(billDetail)">{{ billLabel(billDetail) }}</span>
          </div>
          <div class="fs-bill-d-meta">
            <span>{{ billDetail.code }} · {{ billDetail.htNo || '—' }}</span>
            <span v-if="billDetail.spec">规格：{{ billDetail.spec }}</span>
            <span>数量：{{ fmt(billDetail.num) }}{{ billDetail.unitName || '' }}</span>
            <span>交期：{{ billDetail.deliveryDate || '—' }}</span>
            <span v-if="billDetail.dueInDays !== null && billDetail.dueInDays !== undefined">
              剩余 {{ billDetail.dueInDays < 0 ? '已逾期 ' + Math.abs(billDetail.dueInDays) + ' 天' : billDetail.dueInDays + ' 天' }}
            </span>
          </div>
        </div>

        <!-- 进度摘要：一张卡片内三列 -->
        <div class="fs-bill-d-summary">
          <div class="fs-bill-d-sum-cell">
            <em class="fs-bill-d-sum-num is-primary">{{ billDetail.progressPercent }}%</em>
            <span class="fs-bill-d-sum-label">整体进度</span>
          </div>
          <div class="fs-bill-d-sum-cell">
            <em class="fs-bill-d-sum-num">{{ billDetail.doneCrafts }}/{{ billDetail.totalCrafts }}</em>
            <span class="fs-bill-d-sum-label">工序完成</span>
          </div>
          <div class="fs-bill-d-sum-cell">
            <em class="fs-bill-d-sum-num" :class="{ 'is-today': billDetail.todayReport }">{{ billDetail.todayReport ? billDetail.reportTimeText : '—' }}</em>
            <span class="fs-bill-d-sum-label">今日报工</span>
          </div>
        </div>

        <!-- 工序进度 -->
        <div class="fs-bill-d-sec-title">工序进度</div>
        <div class="fs-bill-d-list">
          <div v-if="billDetail.crafts.length" class="fs-bill-d-list-inner">
            <div v-for="(c, ci) in billDetail.crafts" :key="ci" class="fs-bill-d-row">
              <i class="fs-chip-dot" :style="{ background: craftNameColor(c.craftName) }"></i>
              <span class="fs-bill-d-craft">{{ c.craftName }}</span>
              <span class="fs-bill-d-status" :class="'fs-ds' + c.status">{{ c.statusName || '—' }}</span>
              <span class="fs-bill-d-bar"><i :style="{ width: Math.max(2, c.percent || 0) + '%', background: craftNameColor(c.craftName) }"></i></span>
              <span class="fs-bill-d-num">
                <b>良{{ fmt(c.validNum) }}</b>
                <em v-if="c.wasteNum > 0" class="fs-bill-d-waste">废{{ fmt(c.wasteNum) }}</em>
                <i class="fs-bill-d-total">/{{ fmt(c.num) }}</i>
              </span>
              <span class="fs-bill-d-pct">{{ c.percent || 0 }}%</span>
            </div>
          </div>
          <div v-else class="fs-day-empty">暂无工序</div>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { isDark as getDark, toggleTheme } from '../../../utils/theme'
import api from '../../../api'

const router = useRouter()

const loading = ref(true)
const refreshing = ref(false)

/* ===== 深色模式切换（与全站 theme-toggle 一致） ===== */
const isDark = ref(getDark())
const themeAnim = ref(false)

function onToggleTheme(e) {
  themeAnim.value = false
  requestAnimationFrame(() => {
    themeAnim.value = true
  })
  window.setTimeout(() => (themeAnim.value = false), 500)
  isDark.value = toggleTheme(e?.currentTarget)
}

/* ===== 加工单进度统计 ===== */
const bpStats = reactive({ unprogrammed: 0, total: 0, inProgress: 0, craftActive: 0, noStart: 0, overdue: 0, dueSoon: 0 })
const bills = ref([])

/* ===== KPI 联动筛选：点击统计卡只显示对应分类的加工单 ===== */
const kpiFilter = ref('all')
const KPI_LABELS = { all: '全部', todo: '未开始订单', unprog: '未编程', run: '进行中', overdue: '已逾期', soon: '临期(3天内)' }
const kpiFilterLabel = computed(() => KPI_LABELS[kpiFilter.value] || '全部')

function setKpiFilter(k) {
  kpiFilter.value = kpiFilter.value === k ? 'all' : k // 再点一次恢复全部
}

/** 过滤后的加工单：all 不过滤；todo=未开始订单（无报工记录 且 所有工序未开工）；run 按工序开工情况 */
const filteredBills = computed(() => {
  const f = kpiFilter.value
  if (f === 'all') return bills.value
  if (f === 'todo') {
    return bills.value.filter(
      (b) =>
        (b.status === 1 || b.status === 2) &&
        !b.lastReportTime &&
        !(b.crafts || []).some((c) => c.status === 2 || c.status === 3),
    )
  }
  if (f === 'unprog') return bills.value.filter((b) => b.status === 1)
  if (f === 'run') return bills.value.filter((b) => (b.crafts || []).some((c) => c.status === 2 || c.status === 3))
  if (f === 'overdue') return bills.value.filter((b) => b.overdue)
  if (f === 'soon') return bills.value.filter((b) => b.dueSoon)
  return bills.value
})

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
    const [bp, ct, rs, rr, bf] = await Promise.all([
      api.get('/tasks/bill-progress', { params: { page: 1, pageSize: 60, status: '1,2,5', sortBy: 'latestReport' } }),
      api.get('/tasks/craft-trend', { params: { days: 7 } }),
      api.get('/tasks/report-stats', { params: { days: 7 } }),
      api.get('/tasks/recent-reports', { params: { today: 1 } }),
      api.get('/tasks/bill-forecast', { params: { page: 1, pageSize: 100 } }),
    ])
    Object.assign(bpStats, bp.stats || {})
    // 完工预测结果按单号索引：预计完成日期 / 剩余天数 / 是否超交期（与预测页口径一致）
    const fcMap = new Map((bf.list || []).map((f) => [f.code, f]))
    // 排序：正常进行中的单在前（今日报工优先），未编程/已暂停排最底
    const t = todayStr()
    const rank = (s) => (s === 1 || s === 5 ? 1 : 0)
    const bpList = [...(bp.list || [])].sort((a, b) => rank(a.status) - rank(b.status))
    bills.value = bpList.map((b) => {
      const fc = fcMap.get(b.code)
      return {
        ...b,
        todayReport: (b.lastReportTime || '').slice(0, 10) === t,
        reportTimeText: (b.lastReportTime || '').slice(11, 16),
        etaDate: fc?.etaDate || null,
        etaDays: fc?.etaDays ?? null,
        overrunDelivery: !!fc?.overrunDelivery,
      }
    })
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
        if (v > 0 || p.waste > 0 || p.cnt > 0) segs.push({ name: c.name, valid: v, waste: p.waste || 0, cnt: p.cnt || 0, color: fsColorOf(ci) })
        valid += v
        waste += p.waste || 0
        cnt += p.cnt || 0
      })
      return { date: d, valid, waste, cnt, segs }
    })
    reportCrafts.value = (rs.crafts || []).map((c) => ({ name: c.name, valid: c.valid, waste: c.waste, cnt: c.cnt, passRate: c.passRate }))
    rsDays.value = rs.days || 7
    recentReports.value = (rr.list || []).map((r) => {
      // 产品名溢出检测：超出约 13 个中文字符宽时自动跑马灯滚动
      const len = (r.goodsName || '').length
      const overflow = len > 13
      return {
        ...r,
        goodsOverflow: overflow,
        goodsShift: overflow ? Math.ceil(len * 10.5 - 148) : 0, // 位移 ≈ 内容宽 - 可视宽
        goodsDur: overflow ? 5 + Math.ceil(len / 6) : 5, // 越长滚得越久（秒）
      }
    })
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
    // 数据就绪后启动自动轮播（今日报工人员，内容超出才滚动；开关关闭时保持静止）
    await nextTick()
    watchFsSize()
    if (scrollEnabled.value) startWorkersCarousel()
  }
}

/* ===== 滚动总开关：今日报工记录跑马灯 + 今日报工人员轮播 同步开启/暂停 ===== */
// 开关状态跟随浏览器记忆（localStorage），刷新/重开页面保持上次设置
const SCROLL_KEY = 'fs-scroll-enabled'
const scrollEnabled = ref(localStorage.getItem(SCROLL_KEY) !== '0')
function toggleScroll() {
  scrollEnabled.value = !scrollEnabled.value
  localStorage.setItem(SCROLL_KEY, scrollEnabled.value ? '1' : '0')
  if (scrollEnabled.value) {
    // 恢复滚动：重置端点停留计数，避免恢复后原地停顿
    workersHold = 0
    nextTick(() => startWorkersCarousel())
  } else {
    stopWorkersCarousel()
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
  // 滚动总开关关闭时不启动（防止 mouseleave 等入口绕过开关重启）
  if (!scrollEnabled.value) return
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
  if (b.status === 5) return '已暂停'
  return b.statusName || ''
}
function billCls(b) {
  if (b.overdue) return 'is-red'
  if (b.dueSoon) return 'is-orange'
  if (b.status === 1) return 'is-gray'
  if (b.status === 5) return 'is-paused'
  return 'is-blue'
}

/* 工序圆环：dasharray = 已完成弧长 + 剩余弧长（周长约 97.39） */
const RING_C = 2 * Math.PI * 15.5
function ringDash(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  return `${(RING_C * p) / 100} ${RING_C}`
}

/* 分段进度条：每个工序一段，宽度 = 该工序完成度 ÷ 工序总数 */
function billSegWidth(c, b) {
  const n = Number(b.totalCrafts) || 0
  if (!n) return '0%'
  const p = Math.max(0, Math.min(100, Number(c.percent) || 0))
  return `${(p / n).toFixed(2)}%`
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

/* 工序产出趋势：点击柱子查看当日明细（含各工序报工人员） */
const dayDlg = ref(false)
const dayDetail = ref(null)
const dayDetailWorkers = ref(null) // [{ craft, workers: [{name, valid, waste, cnt}] }]
const dayDetailTitle = computed(() => (dayDetail.value ? `${dayDetail.value.date} 产出明细` : '产出明细'))
/** 工序良品数占当日总产出的百分比（用于进度条），防除零 */
function dayPct(s) {
  const total = (dayDetail.value?.valid || 0) + (dayDetail.value?.waste || 0)
  if (!total) return '2%'
  return Math.max(2, Math.round(((s.valid + s.waste) / total) * 100)) + '%'
}
/** 按工序名取趋势图颜色（用于报工人员区色点），找不到时用主题主色 */
function craftColor(name) {
  const s = dayDetail.value?.segs?.find((x) => x.name === name)
  return s?.color || 'var(--primary)'
}
async function openDayDetail(d) {
  dayDetail.value = d
  dayDetailWorkers.value = null
  dayDlg.value = true
  try {
    // 按日期拉取当天报工明细，按工序分组统计人员（良品/废品/次数）
    const res = await api.get('/tasks/recent-reports', { params: { limit: 2000, date: d.date } })
    const craftMap = new Map()
    for (const r of res.list || []) {
      const cn = r.craftName || '未知工序'
      if (!craftMap.has(cn)) craftMap.set(cn, new Map())
      const um = craftMap.get(cn)
      const un = r.reportUserName || '未知'
      if (!um.has(un)) um.set(un, { name: un, valid: 0, waste: 0, cnt: 0 })
      const e = um.get(un)
      e.valid += r.validNum || 0
      e.waste += r.wasteNum || 0
      e.cnt += 1
    }
    const arr = []
    for (const [craft, um] of craftMap) {
      arr.push({ craft, workers: [...um.values()].sort((a, b) => b.valid - a.valid || b.cnt - a.cnt) })
    }
    arr.sort((a, b) => (dayDetail.value.segs.findIndex((s) => s.name === a.craft) - dayDetail.value.segs.findIndex((s) => s.name === b.craft)))
    dayDetailWorkers.value = arr
  } catch {
    dayDetailWorkers.value = []
  }
}

/* 加工单进度：点击卡片查看加工单详情 */
const billDlg = ref(false)
const billDetail = ref(null)
const billDetailTitle = computed(() => (billDetail.value ? billDetail.value.code : '加工单详情'))
function openBillDetail(b) {
  billDetail.value = b
  billDlg.value = true
}

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

/* 工序名配色：与「工序产出趋势」图例完全一致（同名工序取同一索引色），未知工序兜底灰色 */
function craftNameColor(name) {
  const idx = trendCrafts.value.findIndex((c) => c.name === name)
  return idx >= 0 ? fsColorOf(idx) : '#64748b'
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
  startPolling()
})
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (pollTimer) clearInterval(pollTimer)
  if (fsResizeObs) fsResizeObs.disconnect()
  if (workersRaf) cancelAnimationFrame(workersRaf)
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
</script>

<style scoped>
.fs-page {
  height: 100vh;
  overflow: hidden;
  padding: 24px 28px 28px;
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
  font-size: 26px;
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
  font-size: 16px;
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

/* 滚动总开关：与其他圆形图标按钮统一；开启=苹果绿 #34c759，关闭=灰色 */
.fs-scroll-toggle {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  color: var(--muted-foreground);
}
.fs-scroll-toggle.on {
  color: #34c759;
  border-color: rgba(52, 199, 89, 0.5);
}
.fs-scroll-toggle.on:hover {
  color: #34c759;
  border-color: #34c759;
  background: rgba(52, 199, 89, 0.08);
}
.fs-scroll-toggle.off {
  opacity: 0.6;
}
.fs-scroll-toggle.off:hover {
  opacity: 1;
}

/* 开关关闭时：今日报工记录的产品名跑马灯同步暂停 */
.fs-scroll-off .fs-recent-goods-inner.is-run {
  animation-play-state: paused;
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
  gap: 14px;
}

.fs-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 18px 10px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.1s;
}

.fs-kpi:hover {
  border-color: color-mix(in srgb, var(--primary) 45%, var(--border));
}

.fs-kpi:active {
  transform: scale(0.97);
}

.fs-kpi.active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, var(--card));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
}

.k-num {
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--foreground);
}

.k-label {
  font-size: 13.5px;
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
  gap: 18px;
  align-items: stretch;
}

.fs-col {
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  padding: 18px;
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
  font-size: 17px;
  font-weight: 700;
  color: var(--foreground);
}

.fs-panel-sub {
  font-size: 12.5px;
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

/* 工序产出趋势柱子：可点击查看当日明细 */
.fs-trend-day {
  cursor: pointer;
}
.fs-trend-day:hover rect {
  filter: brightness(1.15);
}

/* 当日产出明细弹窗：统一分组卡片风格（Apple #007aff / #ef4444） */
.fs-dlg-day .el-dialog__body {
  padding-top: 6px;
}

.fs-day-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 76vh;
  overflow-y: auto;
  padding: 4px;
}

/* 摘要：一张卡片内三列，竖线分隔 */
.fs-day-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 14px;
  overflow: hidden;
}
.fs-day-sum-cell {
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.fs-day-sum-cell + .fs-day-sum-cell {
  border-left: 1px solid var(--border, rgba(148, 163, 184, 0.16));
}
.fs-day-sum-num {
  font-style: normal;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.fs-day-sum-num.is-primary {
  color: #007aff;
}
.fs-day-sum-num.is-waste {
  color: #ef4444;
}
.fs-day-sum-label {
  font-size: 12px;
  color: var(--muted-foreground);
}

/* 分组标题：卡片外灰色小字 */
.fs-day-sec-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted-foreground);
  letter-spacing: 0.02em;
  padding: 0 4px;
  margin-bottom: 6px;
}

/* 统一卡片容器 */
.fs-day-list {
  border-radius: 14px;
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  padding: 4px 14px;
}

/* 工序行：色点 + 名称 + 占比条 + 数值组 */
.fs-day-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  font-size: 14px;
}
.fs-day-row + .fs-day-row {
  border-top: 1px solid var(--border, rgba(148, 163, 184, 0.14));
}
.fs-day-name {
  font-weight: 600;
  min-width: 52px;
}
.fs-day-bar {
  flex: 1;
  min-width: 40px;
  height: 6px;
  border-radius: 999px;
  background: var(--muted, rgba(148, 163, 184, 0.2));
  overflow: hidden;
}
.fs-day-bar-in {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.45s ease;
}
.fs-day-nums {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 96px;
  justify-content: flex-end;
}
.fs-day-valid {
  font-style: normal;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.fs-day-waste {
  font-style: normal;
  font-size: 12px;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
}
.fs-day-cnt {
  font-style: normal;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* 报工人员：工序色点 + 名称 + 人员胶囊 */
.fs-day-wrow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  font-size: 13px;
}
.fs-day-wrow + .fs-day-wrow {
  border-top: 1px solid var(--border, rgba(148, 163, 184, 0.14));
}
.fs-day-wname {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  min-width: 76px;
  flex-shrink: 0;
  padding-top: 4px;
}
.fs-day-wchips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fs-day-wchip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--muted, rgba(148, 163, 184, 0.08));
  border: 1px solid var(--border, rgba(148, 163, 184, 0.14));
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
}
.fs-day-wchip b {
  font-weight: 600;
}
.fs-day-cw {
  font-style: normal;
  font-size: 11px;
  color: #ef4444;
}
.fs-day-empty {
  font-size: 12.5px;
  color: var(--muted-foreground);
  text-align: center;
  padding: 14px 0;
}

/* 加工单详情弹窗：与产出明细统一的分组卡片风格 */
.fs-bill-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 76vh;
  overflow-y: auto;
  padding: 4px;
}

/* 加工单信息卡 */
.fs-bill-d-card {
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 14px;
  padding: 12px 14px;
}
.fs-bill-d-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fs-bill-d-goods {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.fs-bill-d-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--muted-foreground);
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border, rgba(148, 163, 184, 0.18));
}

/* 进度摘要：一张卡片内三列，竖线分隔 */
.fs-bill-d-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 14px;
  overflow: hidden;
}
.fs-bill-d-sum-cell {
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.fs-bill-d-sum-cell + .fs-bill-d-sum-cell {
  border-left: 1px solid var(--border, rgba(148, 163, 184, 0.16));
}
.fs-bill-d-sum-num {
  font-style: normal;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.fs-bill-d-sum-num.is-primary {
  color: #007aff;
}
.fs-bill-d-sum-num.is-today {
  color: #10b981;
}
.fs-bill-d-sum-label {
  font-size: 12px;
  color: var(--muted-foreground);
}

/* 工序进度：分组标题 + 统一卡片 */
.fs-bill-d-sec-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted-foreground);
  letter-spacing: 0.02em;
  padding: 0 4px;
  margin-bottom: 6px;
}
.fs-bill-d-list {
  border-radius: 14px;
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  padding: 4px 14px;
}
.fs-bill-d-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  font-size: 13.5px;
}
.fs-bill-d-row + .fs-bill-d-row {
  border-top: 1px solid var(--border, rgba(148, 163, 184, 0.14));
}
.fs-bill-d-craft {
  font-weight: 600;
  min-width: 44px;
}
.fs-bill-d-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  min-width: 48px;
  text-align: center;
  flex-shrink: 0;
}
.fs-ds1 {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.12);
}
.fs-ds2 {
  color: var(--primary);
  background: rgba(0, 122, 255, 0.12);
}
.fs-ds3 {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}
.fs-ds4 {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
}
.fs-bill-d-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--muted, rgba(148, 163, 184, 0.2));
  overflow: hidden;
  min-width: 60px;
}
.fs-bill-d-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.45s ease;
}
.fs-bill-d-num {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
  white-space: nowrap;
  min-width: 92px;
  justify-content: flex-end;
}
.fs-bill-d-num b {
  font-weight: 700;
}
.fs-bill-d-total {
  font-style: normal;
  color: var(--muted-foreground);
  font-size: 12px;
}
.fs-bill-d-waste {
  font-style: normal;
  font-size: 11.5px;
  color: #ef4444;
}
.fs-bill-d-pct {
  min-width: 40px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 36px 38px 54px;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  font-size: 12px;
}

.fs-recent-row + .fs-recent-row {
  border-top: 1px dashed var(--border);
}

.fs-recent-craft {
  width: 30px;
  flex-shrink: 0;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-recent-goods {
  min-width: 0;
  overflow: hidden;
}

.fs-recent-user {
  min-width: 0;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-recent-num {
  text-align: right;
  font-weight: 700;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.fs-recent-time {
  font-size: 10.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.fs-recent-goods-inner {
  display: inline-block;
  white-space: nowrap;
  max-width: 100%;
  vertical-align: bottom;
}

/* 内容溢出时往返滚动（跑马灯），只滚出超出的部分 */
.fs-recent-goods-inner.is-run {
  animation: fs-marquee var(--dur, 6s) ease-in-out infinite alternate;
  will-change: transform;
}

@keyframes fs-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-1 * var(--shift, 60px)));
  }
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
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
  cursor: pointer;
}

.fs-bill:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
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

/* 已暂停：橙色虚线边框 + 淡橙底 */
.fs-bill.is-paused {
  border-style: dashed;
  border-color: rgba(255, 149, 0, 0.5);
  background: rgba(255, 149, 0, 0.08);
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

.fs-bill-tag.is-paused {
  background: rgba(255, 149, 0, 0.14);
  color: var(--warning);
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
  display: flex;
  gap: 1px;
  height: 6px;
  border-radius: 999px;
  background: var(--muted);
  overflow: hidden;
}

.fs-bill-track i {
  display: block;
  height: 100%;
  flex-shrink: 0;
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

/* 报工时间行：今日报工高亮徽标 + 右侧预计完成日期 */
.fs-bill-report {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: 10.5px;
}

.fs-bill-report-side {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.fs-bill-eta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-weight: 600;
}

.fs-bill-eta.risk {
  color: var(--destructive, #ef4444);
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
