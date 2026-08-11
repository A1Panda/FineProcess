<template>
  <div class="task-card" @click="openRecords">
    <div class="card-top">
      <span class="status-pill" :class="pillClass">{{ task.statusName }}</span>
      <span v-if="task.craftName" class="craft-chip">{{ task.craftName }}</span>
      <span v-if="task.deliveryDate" class="delivery-chip">交期 {{ task.deliveryDate }}</span>
    </div>

    <div class="bill-code" @click.stop="copyCode">
      <el-icon :size="15"><CopyDocument /></el-icon>
      <span class="code">{{ task.produceBillCode }}</span>
    </div>

    <div class="goods" :title="task.goodsName">{{ task.goodsName }}</div>
    <div v-if="task.spec" class="meta spec-meta">规格：{{ task.spec }}</div>
    <div class="nums">
      <span class="num-item">计划 <b class="strong">{{ task.num }}</b><span class="unit">{{ task.unitName }}</span></span>
      <span v-if="isTerminal" class="num-item">当前状态 <b class="status-name">{{ task.statusName }}</b></span>
      <template v-else>
        <span class="num-item">良品 <b class="ok">{{ task.validNum }}</b></span>
        <span class="num-item">不良 <b class="bad">{{ task.wasteNum }}</b></span>
        <span class="num-item">剩余 <b class="remain">{{ remaining }}</b></span>
      </template>
    </div>

    <!-- 整张加工单的工序进度：每道工序一根进度条，当前工序高亮 -->
    <div v-if="craftProgress.length" class="progress">
      <div class="progress-title">工序进度</div>
      <div
        v-for="c in craftProgress"
        :key="c.craftName"
        class="p-row"
        :class="{ current: c.craftName === task.craftName }"
      >
        <span class="p-name" :title="c.statusName">{{ c.craftName }}</span>
        <div class="p-bar"><div class="p-fill" :style="{ width: pct(c) + '%' }" /></div>
        <span class="p-pct">{{ pct(c) }}%</span>
      </div>
    </div>

    <div v-if="task.htNo" class="meta">HT图号：{{ task.htNo }}</div>

    <div v-if="task.workshopPathNames" class="meta">车间：{{ task.workshopPathNames }}</div>

    <div v-if="mode !== 'biancheng'" class="actions" @click.stop>
      <template v-if="task.statusName === '未开始'">
        <el-button type="primary" round size="small" @click="act('start')">开 工</el-button>
      </template>
      <template v-else-if="task.statusName === '进行中'">
        <el-button round size="small" @click="act('pause')">暂停</el-button>
        <el-button type="warning" round size="small" @click="openReport">报 工</el-button>
        <el-button type="success" round size="small" @click="act('finish')">完工</el-button>
      </template>
      <template v-else-if="task.statusName === '已暂停'">
        <el-button type="primary" round size="small" @click="act('start')">继续</el-button>
        <el-button type="warning" round size="small" @click="openReport">报 工</el-button>
      </template>
      <template v-else>
        <!-- 已终结任务：无操作按钮，当前状态已在数量区显示 -->
      </template>
    </div>

    <div v-if="mode === 'biancheng'" class="actions" @click.stop>
      <el-button type="success" round size="small" class="grow-btn" @click="doBianchengDone">完成编程</el-button>
    </div>

    <div v-if="mode === 'biancheng-cancel'" class="actions" @click.stop>
      <el-button type="warning" round size="small" class="grow-btn" @click="doBianchengCancel">回未开始</el-button>
    </div>

    <div class="records-entry">查看报工记录 ›</div>

    <!-- @click.stop：弹窗渲染在卡片内部，阻止关闭按钮/遮罩的点击冒泡到卡片导致弹窗被重新打开 -->
    <div @click.stop>
      <ReportRecordsDialog v-model:visible="recordsVisible" :task="task" @changed="emit('changed')" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import ReportRecordsDialog from './ReportRecordsDialog.vue'

const props = defineProps({ task: Object, mode: String })
const emit = defineEmits(['report', 'changed', 'bianchengDone', 'bianchengCancel'])

const recordsVisible = ref(false)

/** 已终结任务（已完成/已取消等）：无操作按钮，数量区显示当前状态 */
const isTerminal = computed(() => !['未开始', '进行中', '已暂停'].includes(props.task?.statusName))

/** 剩余待加工数量 = 计划 - 良品（下限 0） */
const remaining = computed(() => {
  const plan = Number(props.task?.num) || 0
  const ok = Number(props.task?.validNum) || 0
  return Math.max(0, plan - ok)
})

/** 整张加工单的工序进度列表（每道工序含完成百分比），由后端按工艺顺序返回 */
const craftProgress = computed(() => props.task?.craftProgress ?? [])

/** 完成百分比（0-100，后端已限制上限，这里兜底防越界） */
function pct(c) {
  const v = Number(c?.percent) || 0
  return Math.max(0, Math.min(100, v))
}

/** 点击卡片查看该加工单的报工记录 */
function openRecords() {
  recordsVisible.value = true
}

async function doBianchengDone() {
  emit('bianchengDone', props.task)
}

async function doBianchengCancel() {
  emit('bianchengCancel', props.task)
}

const pillClass = computed(() => {
  const map = { 未开始: 'pill-info', 进行中: 'pill-doing', 已完成: 'pill-done', 已暂停: 'pill-paused', 已取消: 'pill-info' }
  return map[props.task.statusName] || 'pill-info'
})

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

.craft-chip.current {
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
  font-weight: 500;
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

.bill-code {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--foreground);
  cursor: pointer;
  color: var(--muted-foreground);
}

.bill-code .code {
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.spec-meta {
  font-size: 12px;
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
  width: 38px;
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}

.p-row.current .p-pct {
  color: var(--primary);
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--muted-foreground);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.actions .el-button {
  flex: 1;
}

.grow-btn {
  width: 100%;
}

.records-entry {
  font-size: 12px;
  color: var(--primary);
  text-align: right;
}
</style>
