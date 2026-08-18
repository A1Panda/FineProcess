<template>
  <div class="task-card" @click="openMenu">
    <div class="card-top">
      <span class="status-pill" :class="pillClass">{{ task.statusName }}</span>
      <span v-if="task.craftName" class="craft-chip">{{ task.craftName }}</span>
      <span v-if="task.deliveryDate" class="delivery-chip">交期 {{ task.deliveryDate }}</span>
    </div>

    <div
      v-if="dailyNeed"
      class="daily-row"
      :class="dueInfo.overdue ? 'daily-overdue' : ''"
      :title="task.targetDate ? `自定义目标 ${task.targetDate}，点击修改` : '点击设置提前完成日期'"
      @click.stop="openTargetDate"
    >
      <el-icon :size="13"><TrendCharts /></el-icon>
      <span>日均需报 <b>{{ dailyNeed }}{{ task.unitName }}</b></span>
      <span class="daily-sub">
        <template v-if="task.targetDate">目标 {{ task.targetDate.slice(5) }} · {{ dueText }}</template>
        <template v-else>{{ dueText }}</template>
      </span>
      <el-icon class="daily-set" :size="13"><EditPen /></el-icon>
    </div>

    <div class="bill-code" @click.stop="copyCode">
      <el-icon :size="15"><CopyDocument /></el-icon>
      <span class="code">{{ task.produceBillCode }}</span>
      <span v-if="task.spec" class="bill-spec" :title="task.goodsName">｜{{ task.spec }}</span>
    </div>

    <div class="goods" :title="goodsTitle">{{ task.goodsName }}</div>

    <div class="nums">
      <span class="num-item">计划 <b class="strong">{{ task.num }}</b><span class="unit">{{ task.unitName }}</span></span>
      <span v-if="isTerminal || isBiancheng" class="num-item">进行到: <b class="status-name" :style="{ color: statusNameColor }">{{ statusText }}</b></span>
      <template v-else>
        <span class="num-item">良品 <b class="ok">{{ task.validNum }}</b></span>
        <span class="num-item">不良 <b class="bad">{{ task.wasteNum }}</b></span>
        <span class="num-item">剩余 <b class="remain">{{ remaining }}</b></span>
      </template>
    </div>

    <!-- 整张加工单的工序进度：每道工序一根进度条，每道颜色不同，未开始显示灰色 -->
    <div v-if="craftProgress.length" class="progress">
      <div class="progress-title">工序进度</div>
      <div
        v-for="(c, i) in craftProgress"
        :key="c.craftName"
        class="p-row"
        :class="{ current: c.craftName === task.craftName }"
      >
        <span class="p-name" :style="nameStyle(c, i)" :title="c.statusName">{{ c.craftName }}</span>
        <div class="p-bar"><div class="p-fill" :style="fillStyle(c, i)" /></div>
        <span class="p-pct">
          <b class="p-ok">良品：{{ c.validNum || 0 }}</b><b class="p-slash">/</b><b class="p-remain">剩余：{{ remainOf(c) }}</b>
        </span>
      </div>
    </div>

    <!-- HT图号 + 车间：同一排 -->
    <div class="meta-row">
      <span v-if="task.htNo" class="meta">HT图号：{{ task.htNo }}</span>
      <span v-if="task.workshopPathNames" class="meta">车间：{{ task.workshopPathNames }}</span>
    </div>

    <!-- 环绕操作菜单：点击卡片后从点击位置弹出（Teleport 到 body，脱离卡片影响，保证可点击） -->
    <Teleport to="body">
      <div v-if="menuOpen" class="menu-mask" @click="closeMenu"></div>
      <div v-if="menuOpen" class="radial-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }">
        <button
          v-for="(item, idx) in menuItems"
          :key="item.label"
          class="menu-item"
          :class="'tone-' + item.tone"
          :style="{ '--dx': item.dx + 'px', '--dy': item.dy + 'px', '--i': idx }"
          @click="runItem(item)"
        >
          <span class="menu-fab">
            <el-icon :size="20"><component :is="item.icon" /></el-icon>
          </span>
          <span class="menu-label">{{ item.label }}</span>
        </button>
      </div>
    </Teleport>

    <!-- @click.stop：弹窗渲染在卡片内部，阻止关闭按钮/遮罩的点击冒泡到卡片导致弹窗被重新打开 -->
    <div @click.stop>
      <ReportRecordsDialog v-model:visible="recordsVisible" :task="task" @changed="emit('changed')" />

      <!-- 自定义目标完成日期：点击"日均需报"行弹出，设置后日均计算优先使用该日期 -->
      <el-dialog
        v-model="targetDateVisible"
        width="320px"
        align-center
        append-to-body
        class="td-dlg"
        :show-close="false"
      >
        <template #header>
          <div class="td-head">
            <span class="td-head-title">设置目标完成日期</span>
            <span class="td-head-sub">{{ task.produceBillCode }}</span>
          </div>
        </template>

        <div class="td-info">
          <div class="td-info-row">
            <span class="td-info-key">当前剩余</span>
            <b class="td-info-val">{{ remaining }}{{ task.unitName }}</b>
          </div>
          <div class="td-info-row">
            <span class="td-info-key">加工单交期</span>
            <span class="td-info-val">{{ task.deliveryDate || '未设置' }}</span>
          </div>
        </div>

        <el-date-picker
          v-model="targetDateValue"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择目标完成日期"
          class="td-picker"
        />
        <p class="td-tip">日均需报将基于该日期计算，清空日期并保存即恢复默认交期</p>

        <template #footer>
          <div class="td-actions">
            <el-button class="td-cancel" @click="targetDateVisible = false">取消</el-button>
            <el-button type="primary" class="td-save" @click="saveTargetDate">保存</el-button>
          </div>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import ReportRecordsDialog from './ReportRecordsDialog.vue'

const props = defineProps({ task: Object, mode: String })
const emit = defineEmits(['report', 'changed', 'bianchengDone', 'bianchengCancel'])

const recordsVisible = ref(false)

/* ===== 自定义目标完成日期 ===== */
const targetDateVisible = ref(false)
const targetDateValue = ref('')

function openTargetDate() {
  targetDateValue.value = props.task?.targetDate || ''
  targetDateVisible.value = true
}

async function saveTargetDate() {
  // 日期留空 = 恢复默认：清除自定义日期，回退使用加工单交期
  await api.post(`/tasks/${props.task.id}/target-date`, { date: targetDateValue.value || null })
  ElMessage.success(
    targetDateValue.value ? `已设置目标完成日期 ${targetDateValue.value}` : '已恢复默认交期',
  )
  targetDateVisible.value = false
  emit('changed')
}

/** 已终结任务（已完成/已取消等）：无操作按钮，数量区显示当前状态 */
const isTerminal = computed(() => !['未开始', '进行中', '已暂停'].includes(props.task?.statusName))
/** 编程工作台卡片（CraftWorkbench 编程工序传入 mode）：数量区只显示"进行到"当前工序 */
const isBiancheng = computed(() => !!props.mode)
const goodsTitle = computed(() => {
  const spec = props.task?.spec
  return spec ? `${props.task?.goodsName ?? ''}｜${spec}` : (props.task?.goodsName ?? '')
})

/** 剩余待加工数量 = 计划 - 良品（不良品不再重复计入剩余） */
const remaining = computed(() =>
  Math.max(0, (Number(props.task?.num) || 0) - (Number(props.task?.validNum) || 0)),
)

/** 交期信息：剩余天数（不足 1 天按 1 天算，避免除零），是否已逾期。
 *  优先使用自定义目标日期 targetDate，无则回退加工单交期 deliveryDate */
const dueInfo = computed(() => {
  const d = props.task?.targetDate || props.task?.deliveryDate
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  // 按日历天差计算（双方都取当天零点），避免把当天不足 1 天的碎时间向上取整成多一天
  const [y, m, day] = d.split('-').map(Number)
  const due = new Date(y, m - 1, day)
  const t = new Date()
  const today0 = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  const diffDays = Math.round((due - today0) / 86400000)
  return { days: Math.max(1, diffDays), overdue: diffDays < 0 }
})

/** 到交期每天至少加工数 = 剩余 / 剩余天数（向上取整）；已终结或无剩余不显示 */
const dailyNeed = computed(() => {
  if (isTerminal.value || !dueInfo.value) return null
  const rem = remaining.value
  if (rem <= 0) return null
  return Math.ceil(rem / dueInfo.value.days)
})

/** 日均标签的副文本：已逾期显示"已逾期"，否则显示剩余天数 */
const dueText = computed(() => {
  if (!dueInfo.value) return ''
  return dueInfo.value.overdue ? '已逾期' : `剩${dueInfo.value.days}天`
})

/** 整张加工单的工序进度列表（每道工序含完成百分比），由后端按工艺顺序返回 */
const craftProgress = computed(() => props.task?.craftProgress ?? [])

/** 当前进行到的工序：取已开始工序中流程推进到的最新一道；全部未开始则显示"未开始" */
const currentCraftName = computed(() => {
  const progress = props.task?.craftProgress ?? []
  const started = progress.filter((c) => isStarted(c))
  if (!started.length) return '未开始'
  return started[started.length - 1]?.craftName || '未开始'
})

/** 数量区"进行到"文案：编程页按加工单状态显示（未开始=未编程 / 进行中=编程中），其余场景显示当前工序 */
const statusText = computed(() => {
  if (!isBiancheng.value) return currentCraftName.value
  if (props.task?.statusName === '未开始') return '未编程'
  if (props.task?.statusName === '进行中') return '编程中'
  return currentCraftName.value
})

/** 每种工序固定色板（按工序顺序取色）：每种工序颜色不同；未开始用淡色版，已开始用饱和色 */
const CRAFT_COLORS = ['#4e8cff', '#00b578', '#ff9f0a', '#ff5a5f', '#8e5cff', '#00b8d9', '#e44c8f', '#5a7d9a']
/** 已开始（进行到这一步）= 有报工记录（良品或不良数 > 0）；仅开工未报工不算 */
const isStarted = (c) => (Number(c?.validNum) || 0) + (Number(c?.wasteNum) || 0) > 0
const craftColor = (c, i) => CRAFT_COLORS[i % CRAFT_COLORS.length]
const nameStyle = (c, i) => ({
  color: craftColor(c, i),
  opacity: isStarted(c) ? 1 : 0.45,
  fontWeight: isStarted(c) ? 500 : 400,
})

/** "进行到"文案的颜色：与进度条中该工序对应的颜色一致；"未开始/未编程"用灰色 */
const statusNameColor = computed(() => {
  const name = statusText.value
  if (name === '未开始' || name === '未编程') return 'var(--muted-foreground)'
  const idx = (props.task?.craftProgress ?? []).findIndex((c) => c.craftName === name)
  return idx >= 0 ? CRAFT_COLORS[idx % CRAFT_COLORS.length] : 'var(--success)'
})
const fillStyle = (c, i) => {
  const done = Number(c?.validNum) || 0
  const total = done + remainOf(c)
  const w = total > 0 ? Math.round((done / total) * 100) : 0
  return {
    width: w + '%',
    background: craftColor(c, i),
    opacity: isStarted(c) ? 0.9 : 0.25,
  }
}

/** 完成百分比（0-100，后端已限制上限，这里兜底防越界） */
function pct(c) {
  const v = Number(c?.percent) || 0
  return Math.max(0, Math.min(100, v))
}

/** 剩余数量 = 计划数 - 良品数（不考虑不良，下限 0） */
function remainOf(c) {
  return Math.max(0, (Number(c?.num) || 0) - (Number(c?.validNum) || 0))
}

const pillClass = computed(() => {
  const map = { 未开始: 'pill-info', 进行中: 'pill-doing', 已完成: 'pill-done', 已暂停: 'pill-paused', 已取消: 'pill-info' }
  return map[props.task.statusName] || 'pill-info'
})

/* ===== 环绕操作菜单 ===== */
const RADIUS = 82 // 按钮环绕半径
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)

/** 按角度均分环绕一圈，从正上方（12 点方向）开始 */
function polar(i, n) {
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2
  return { dx: Math.round(Math.cos(angle) * RADIUS), dy: Math.round(Math.sin(angle) * RADIUS) }
}

/** 根据任务状态 + 页面模式生成操作项 */
const menuItems = computed(() => {
  const list = []
  if (props.mode === 'biancheng') {
    list.push({ label: '完成编程', icon: 'Check', tone: 'success', run: doBianchengDone })
  } else if (props.mode === 'biancheng-cancel') {
    list.push({ label: '回未开始', icon: 'RefreshLeft', tone: 'warning', run: doBianchengCancel })
  } else {
    const st = props.task?.statusName
    if (st === '未开始') {
      list.push({ label: '开工', icon: 'VideoPlay', tone: 'primary', run: () => act('start') })
    } else if (st === '进行中') {
      list.push({ label: '暂停', icon: 'VideoPause', tone: 'warning', run: () => act('pause') })
      list.push({ label: '报工', icon: 'EditPen', tone: 'primary', run: openReport })
      list.push({ label: '完工', icon: 'CircleCheck', tone: 'success', run: () => act('finish') })
    } else if (st === '已暂停') {
      list.push({ label: '继续', icon: 'VideoPlay', tone: 'primary', run: () => act('start') })
      list.push({ label: '报工', icon: 'EditPen', tone: 'primary', run: openReport })
    } else if (st === '已完成') {
      // 已完成工序允许撤销完工，改回进行中继续加工（如返工、数量未达标误操作等）
      list.push({ label: '回进行中', icon: 'RefreshLeft', tone: 'warning', run: resumeFromDone })
    }
  }
  list.push({ label: '记录', icon: 'Tickets', tone: 'default', run: openRecords })
  return list.map((it, i) => ({ ...it, ...polar(i, list.length) }))
})

function openMenu(e) {
  // 点击点靠近屏幕边缘时向内收，避免按钮溢出屏幕
  const pad = 130
  menuX.value = Math.min(Math.max(e.clientX, pad), window.innerWidth - pad)
  menuY.value = Math.min(Math.max(e.clientY, pad), window.innerHeight - pad)
  menuOpen.value = true
  // 页面滚动时关闭菜单（触摸滑动滚动也会触发）
  window.addEventListener('scroll', closeMenu, { capture: true, once: true })
}

function closeMenu() {
  menuOpen.value = false
  window.removeEventListener('scroll', closeMenu, { capture: true })
}

function runItem(item) {
  closeMenu()
  item.run()
}

onBeforeUnmount(() => {
  window.removeEventListener('scroll', closeMenu, { capture: true })
})

/* ===== 业务操作 ===== */
function openRecords() {
  recordsVisible.value = true
}

function doBianchengDone() {
  emit('bianchengDone', props.task)
}

function doBianchengCancel() {
  emit('bianchengCancel', props.task)
}

async function act(action) {
  // 完工/暂停为敏感操作，先弹窗确认
  if (action === 'finish' || action === 'pause') {
    const isFinish = action === 'finish'
    const msg = isFinish
      ? `确认加工单「${props.task.produceBillCode}」的【${props.task.craftName}】工序已全部完成？`
      : `确认暂停加工单「${props.task.produceBillCode}」的【${props.task.craftName}】工序？`
    try {
      await ElMessageBox.confirm(msg, isFinish ? '完工确认' : '暂停确认', {
        type: 'warning',
        confirmButtonText: isFinish ? '确认完工' : '确认暂停',
      })
    } catch {
      return
    }
  }
  await api.post(`/tasks/${props.task.id}/${action}`)
  const tips = { start: '已开工', pause: '已暂停', finish: '已完工' }
  ElMessage.success(tips[action])
  emit('changed')
}

function openReport() {
  emit('report', props.task)
}

/** 已完成工序撤销完工，改回进行中（可继续报工） */
async function resumeFromDone() {
  try {
    await ElMessageBox.confirm(
      `确认将加工单「${props.task.produceBillCode}」的【${props.task.craftName}】工序改回进行中？`,
      '改回进行中',
      { type: 'warning', confirmButtonText: '确认改回' },
    )
  } catch {
    return
  }
  await api.post(`/tasks/${props.task.id}/start`)
  ElMessage.success('已改回进行中')
  emit('changed')
}

function copyCode() {
  navigator.clipboard?.writeText(props.task.produceBillCode).then(() => ElMessage.success('加工单号已复制'))
}
</script>

<style scoped>
.task-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.task-card:active {
  transform: scale(0.985);
}

.card-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.status-pill {
  font-size: 12px;
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 500;
  flex-shrink: 0;
}

.pill-info {
  background: var(--secondary);
  color: var(--muted-foreground);
}

.pill-doing {
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
}

.pill-done {
  background: rgba(52, 199, 89, 0.12);
  color: var(--success);
}

.pill-paused {
  background: rgba(255, 149, 0, 0.12);
  color: var(--warning);
}

.craft-chip {
  font-size: 12px;
  color: var(--muted-foreground);
  background: var(--secondary);
  border-radius: 999px;
  padding: 3px 10px;
}

.delivery-chip {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--secondary-foreground);
  background: var(--secondary);
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

/* 到交期日均需求：独立提示行，橙色警示，已逾期转红；可点击设置目标日期 */
.daily-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--warning);
  background: rgba(255, 149, 0, 0.1);
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.daily-row:hover {
  background: rgba(255, 149, 0, 0.18);
}

.daily-row:active {
  transform: scale(0.985);
}

.daily-row.daily-overdue:hover {
  background: rgba(255, 77, 79, 0.2);
}

.daily-set {
  flex-shrink: 0;
  opacity: 0.6;
}

.daily-row .el-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.daily-row b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.daily-row.daily-overdue {
  color: var(--destructive);
  background: rgba(255, 77, 79, 0.12);
}

.daily-sub {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.75;
  font-weight: 400;
}

.bill-code {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--muted-foreground);
  cursor: pointer;
}

.bill-code .code {
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bill-spec {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 150px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary, #8a94a6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.goods {
  font-size: 15px;
  font-weight: 500;
  color: var(--foreground);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.nums {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px dashed var(--border);
  border-bottom: 1px dashed var(--border);
  font-size: 13px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.num-item b {
  font-size: 16px;
  font-weight: 600;
  margin: 0 2px;
}

.num-item .strong {
  color: var(--foreground);
}

.num-item .ok {
  color: var(--success);
}

.num-item .bad {
  color: var(--destructive);
}

.num-item .remain {
  color: var(--warning);
}

.num-item .status-name {
  color: var(--success);
  font-weight: 600;
}

.unit {
  font-size: 12px;
  color: var(--muted-foreground);
}

/* ===== 工序进度条 ===== */
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0 4px;
  border-bottom: 1px dashed var(--border);
}

.progress-title {
  font-size: 11px;
  color: var(--muted-foreground);
  letter-spacing: 0.5px;
}

.p-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.p-name {
  width: 44px;
  flex-shrink: 0;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-row.current .p-name {
  color: var(--primary);
  font-weight: 600;
}

.p-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--muted);
  overflow: hidden;
}

.p-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--secondary-foreground);
  opacity: 0.55;
  transition: width 0.3s ease;
}

.p-row.current .p-fill {
  background: var(--primary);
  opacity: 1;
}

.p-pct {
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
  white-space: nowrap;
  display: inline-flex;
  gap: 3px;
  justify-content: flex-end;
}
.p-pct .p-ok {
  color: var(--primary);
  font-weight: 600;
}
.p-pct .p-slash {
  color: var(--muted-foreground);
  opacity: 0.6;
  font-weight: 400;
}
.p-pct .p-remain {
  color: #f59e0b;
  font-weight: 600;
}

.p-row.current .p-pct {
  color: var(--primary);
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--muted-foreground);
}

/* 车间 + 操作提示同一排 */
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.meta-row .meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 环绕操作菜单 ===== */
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 2900;
  background: var(--mask-bg, rgba(29, 29, 31, 0.05));
}

.radial-menu {
  position: fixed;
  z-index: 3000;
  width: 0;
  height: 0;
}

.menu-item {
  position: absolute;
  left: 0;
  top: 0;
  /* 最终落位在环绕半径上（按钮中心对准点击点） */
  transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% + var(--dy, 0px)));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 72px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  animation: menu-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--i) * 0.03s);
}

.menu-fab {
  width: 52px;
  height: 52px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--muted-foreground);
}

.menu-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  background: var(--glass-strong);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
}

.tone-primary .menu-fab {
  background: rgba(0, 122, 255, 0.1);
  border-color: transparent;
  color: var(--primary);
}

.tone-warning .menu-fab {
  background: rgba(255, 149, 0, 0.12);
  border-color: transparent;
  color: var(--warning);
}

.tone-success .menu-fab {
  background: rgba(52, 199, 89, 0.12);
  border-color: transparent;
  color: var(--success);
}

@keyframes menu-pop {
  0% {
    transform: translate(calc(-50% + var(--dx, 0px) * 0.2), calc(-50% + var(--dy, 0px) * 0.2)) scale(0.4);
    opacity: 0;
  }
  60% {
    opacity: 1;
  }
  100% {
    transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% + var(--dy, 0px))) scale(1);
    opacity: 1;
  }
}
</style>
