<template>
  <el-dialog
    v-model="visible"
    :title="`报工记录 · ${props.task?.produceBillCode || ''}`"
    width="92%"
    class="records-dlg"
    append-to-body
    destroy-on-close
  >
    <!-- 自定义标题：报工记录 + 加工单号 + 条数 -->
    <template #header>
      <div class="dlg-header">
        <span class="dlg-title">报工记录</span>
        <span class="dlg-code">{{ props.task?.produceBillCode || '' }}</span>
        <span class="dlg-count">共 {{ displayRecords.length }} 条</span>
      </div>
    </template>

    <!-- 商品信息 + 工序过滤（合并为一张卡片） -->
    <div v-if="props.task" class="bill-card">
      <div class="bill-goods" :title="props.task.goodsName">{{ props.task.goodsName }}</div>
      <div v-if="props.task.craftName" class="bill-filter">
        <div class="bill-meta">
          <span v-if="props.task.craftName" class="chip chip-craft">{{ props.task.craftName }}</span>
          <span v-if="props.task.htNo" class="chip">HT {{ props.task.htNo }}</span>
        </div>
        <div class="filter-switch">
          <span class="filter-label">只显示「{{ props.task.craftName }}」工序报工</span>
          <button
            class="toggle"
            :class="{ on: onlyCraft }"
            role="switch"
            :aria-checked="onlyCraft"
            @click="toggleOnlyCraft"
          >
            <span class="knob"></span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <el-empty v-else-if="!displayRecords.length" :description="onlyCraft ? '该工序暂无报工记录' : '暂无报工记录'" />
    <div v-else class="records">
      <div v-for="({ r, idx }) in displayRecords" :key="r.id" class="record-item">
        <div class="row-top">
          <span class="seq">{{ records.length - idx }}</span>
          <span class="craft-name">{{ r.craftName }}</span>
          <div v-if="canEdit(r)" class="row-actions">
            <button class="edit-btn" aria-label="修改" @click="startEdit(r)">
              <el-icon :size="14"><EditPen /></el-icon>
            </button>
            <button class="del-btn" aria-label="删除" @click="removeReport(r)">
              <el-icon :size="14"><Delete /></el-icon>
            </button>
          </div>
        </div>

        <!-- 副信息行：报工时间 + 报工人 -->
        <div class="row-sub">
          <span v-if="r.reportTime" class="report-time">{{ r.reportTime }}</span>
          <span class="user">{{ r.reportUser }}</span>
        </div>

        <!-- 三列统计：良品 / 不良品 / 工时 -->
        <div class="row-nums">
          <div class="stat">
            <span class="stat-key">良品</span>
            <span class="stat-val good">{{ r.validNum }}<span class="unit">{{ r.unitName }}</span></span>
          </div>
          <div
            class="stat stat-waste"
            :class="{ clickable: wasteDetail(r).length > 0, expanded: expandedId === r.id }"
            @click="toggleWaste(r)"
          >
            <span class="stat-key">不良品</span>
            <span class="stat-val bad">{{ r.wasteNum }}<span class="unit">{{ r.unitName }}</span></span>
            <svg
              v-if="wasteDetail(r).length"
              class="waste-arrow"
              :class="{ open: expandedId === r.id }"
              viewBox="0 0 16 16"
              width="10"
              height="10"
            >
              <path d="M3 5.5 8 10.5 13 5.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <div v-if="Number(r.workingMinutes) > 0" class="stat">
            <span class="stat-key">工时</span>
            <span class="stat-val work">{{ r.workingMinutes }}<span class="unit">分</span></span>
          </div>
        </div>

        <!-- 不良品项明细：点击"不良品"展开 -->
        <div v-if="expandedId === r.id && wasteDetail(r).length" class="waste-detail">
          <span class="waste-title">不良品原因</span>
          <div class="waste-chips">
            <span v-for="w in wasteDetail(r)" :key="w.code || w.name" class="waste-chip">
              <span class="wc-name">{{ wasteName(w) }}</span>
              <span class="wc-num">×{{ w.num }}</span>
            </span>
          </div>
        </div>

        <div v-if="r.remark || Number(r.validMoney) > 0" class="row-meta">
          <span v-if="r.remark" class="remark">备注：{{ r.remark }}</span>
          <span v-if="Number(r.validMoney) > 0" class="money">{{ r.priceModeName }} ¥{{ r.validMoney }}</span>
        </div>

        <!-- 内联编辑表单：仅自己的报工可修改 -->
        <div v-if="editingId === r.id" class="edit-panel">
          <div class="edit-title">修改报工</div>
          <div class="edit-fields">
            <label class="field">
              <span class="field-label">良品</span>
              <el-input-number v-model="editForm.validNum" :min="0" :controls="false" size="small" />
            </label>
            <label class="field">
              <span class="field-label">不良品</span>
              <el-input-number v-model="editForm.wasteNum" :min="0" :controls="false" size="small" />
            </label>
            <label class="field">
              <span class="field-label">工时(分)</span>
              <el-input-number v-model="editForm.workingMinutes" :min="0" :controls="false" size="small" />
            </label>
          </div>
          <!-- 不良品项数量：修改现有明细的数量，0 表示移除该项 -->
          <div v-if="editWasteItems.length" class="edit-waste">
            <span class="edit-waste-title">不良品项数量（0 = 移除）</span>
            <div v-for="w in editWasteItems" :key="w.code" class="edit-waste-row">
              <span class="ew-name">{{ wasteName(w) }}</span>
              <el-input-number v-model="w.num" :min="0" :controls="false" size="small" style="width: 100px" />
            </div>
          </div>
          <el-input v-model="editForm.remark" size="small" placeholder="备注（可选）" clearable />
          <div class="edit-actions">
            <el-button round size="small" @click="editingId = null">取消</el-button>
            <el-button type="primary" round size="small" :loading="saving" @click="saveEdit">保存修改</el-button>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen } from '@element-plus/icons-vue'
import api from '../api'
import { useAuthStore } from '../stores/auth'

const props = defineProps({ task: Object })
const emit = defineEmits(['changed'])
const visible = defineModel('visible')

const auth = useAuthStore()

/** 当前登录用户的快工单用户ID（用于判断哪些报工可修改） */
const currentUserId = computed(() => auth.user?.kgdUserId ?? '')

const records = ref([])
const loading = ref(false)

/** 只显示当前工序报工的开关（按工序名记忆到 localStorage，下次打开自动恢复） */
const onlyCraft = ref(false)
function onlyCraftKey() {
  return `reportDialog:onlyCraft:${props.task?.craftName || ''}`
}
watch(
  () => props.task?.craftName,
  (name) => {
    onlyCraft.value = !!name && localStorage.getItem(onlyCraftKey()) === '1'
  },
  { immediate: true },
)
function toggleOnlyCraft() {
  onlyCraft.value = !onlyCraft.value
  try {
    localStorage.setItem(onlyCraftKey(), onlyCraft.value ? '1' : '0')
  } catch (e) {
    /* 隐私模式等场景下写入失败时忽略 */
  }
}
/** 过滤后的记录（保留原始序号）：开关开启时仅保留与任务工序一致的报工 */
const displayRecords = computed(() => {
  const all = records.value.map((r, idx) => ({ r, idx }))
  if (!onlyCraft.value || !props.task?.craftName) return all
  return all.filter(({ r }) => r.craftName === props.task.craftName)
})

const editingId = ref(null)
const saving = ref(false)
const editForm = reactive({ validNum: 0, wasteNum: 0, workingMinutes: 0, remark: '' })
/** 编辑中的不良品项明细（[{code,name,num}]，num 可改，0 = 移除） */
const editWasteItems = ref([])

/** 当前展开不良品项明细的记录 id */
const expandedId = ref(null)
/** 不良品项字典（code → name），本地报工未同步时 name 为空，用字典反查 */
const wasteDict = ref([])

async function loadRecords() {
  records.value = []
  loading.value = true
  try {
    const data = await api.get(`/report/bill/${encodeURIComponent(props.task.produceBillCode)}`)
    records.value = data.list ?? []
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

async function loadWasteDict() {
  try {
    wasteDict.value = (await api.get('/crafts/waste-items')) ?? []
  } catch {
    wasteDict.value = []
  }
}

/** 记录的不良品项明细（可能为空数组） */
function wasteDetail(r) {
  return Array.isArray(r.wasteItems) ? r.wasteItems : []
}

/** 不良品项显示名：优先记录自带 name（同步数据），否则用字典 code→name 映射 */
function wasteName(w) {
  if (w.name) return w.name
  const hit = wasteDict.value.find((d) => d.code === w.code)
  return hit ? hit.name : w.code || '未知'
}

/** 点击"不良品"：有明细时切换展开 */
function toggleWaste(r) {
  if (!wasteDetail(r).length) return
  expandedId.value = expandedId.value === r.id ? null : r.id
}

// 编辑明细数量时自动同步不良品总数（保持与明细合计一致）
watch(
  editWasteItems,
  (items) => {
    editForm.wasteNum = items.reduce((s, w) => s + (Number(w.num) || 0), 0)
  },
  { deep: true },
)

watch(visible, (v) => {
  if (v && props.task?.produceBillCode) {
    editingId.value = null
    expandedId.value = null
    loadRecords()
    loadWasteDict()
  }
})

/** 能否操作（修改/删除）：优先按创建者（代报时创建者=操作人），否则按报工人（历史/同步记录） */
function canEdit(r) {
  if (!currentUserId.value) return false
  const owner = r.creatorId ? String(r.creatorId) : String(r.reportUserId)
  return !!owner && owner === String(currentUserId.value)
}

/** 删除报工记录（仅自己的）：二次确认后调用后端，后端透传快工单删除 */
async function removeReport(r) {
  try {
    await ElMessageBox.confirm(
      `确定删除这条【${r.craftName}】报工记录吗？删除后不可恢复。`,
      '删除报工',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  try {
    await api.delete(`/report/${r.id}?billCode=${encodeURIComponent(props.task.produceBillCode)}`)
    ElMessage.success('报工记录已删除')
    editingId.value = null
    await loadRecords()
    // 通知任务卡刷新良品/不良数（服务端已重算缓存）
    emit('changed')
  } catch {
    /* 拦截器已提示 */
  }
}

function startEdit(r) {
  editingId.value = r.id
  editForm.validNum = Number(r.validNum) || 0
  editForm.wasteNum = Number(r.wasteNum) || 0
  editForm.workingMinutes = Number(r.workingMinutes) || 0
  editForm.remark = r.remark || ''
  // 拷贝现有不良品项明细供编辑（不改原记录对象）
  editWasteItems.value = wasteDetail(r).map((w) => ({ code: w.code, name: w.name || '', num: Number(w.num) || 0 }))
}

async function saveEdit() {
  if (!editingId.value) return
  saving.value = true
  try {
    // 不良品项：数量>0 的项提交（整组覆盖，[] = 清空）；无明细记录保持 undefined 不触碰
    const wasteItems = editWasteItems.value.length
      ? editWasteItems.value.filter((w) => Number(w.num) > 0).map((w) => ({ wasteItemCode: w.code, num: Number(w.num) }))
      : undefined
    await api.put(`/report/${editingId.value}`, {
      billCode: props.task.produceBillCode,
      validNum: Number(editForm.validNum) || 0,
      wasteNum: Number(editForm.wasteNum) || 0,
      workingMinutes: Number(editForm.workingMinutes) || 0,
      remark: editForm.remark?.trim() || '',
      wasteItems,
    })
    ElMessage.success('报工记录已修改')
    editingId.value = null
    await loadRecords()
    // 通知任务卡刷新良品/不良数（服务端已重算缓存）
    emit('changed')
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* ===== 弹窗标题 ===== */
.dlg-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dlg-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--foreground);
  letter-spacing: -0.01em;
}

.dlg-code {
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dlg-count {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

/* ===== 商品信息卡 ===== */
.bill-card {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bill-goods {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--foreground);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

.bill-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.chip {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}

.chip-craft {
  background: rgba(0, 122, 255, 0.1);
  border-color: transparent;
  color: var(--primary);
  font-weight: 500;
}

/* ===== 工序过滤（chips 与开关同一行） ===== */
.bill-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.filter-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin-left: auto;
  flex-shrink: 0;
}

.filter-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 手机窄屏适配：文字允许换行、行内可自然折行，避免截断 */
@media (max-width: 480px) {
  .bill-filter {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .filter-switch {
    margin-left: 0;
    width: 100%;
  }

  .filter-label {
    flex: 1;
    font-size: 12px;
    line-height: 1.35;
    white-space: normal;
    text-overflow: clip;
    overflow: visible;
  }
}

/* 开关（Apple 风格） */
.toggle {
  flex-shrink: 0;
  width: 42px;
  height: 25px;
  border-radius: 999px;
  border: none;
  background: rgba(128, 128, 128, 0.3);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
  position: relative;
  cursor: pointer;
  transition: background 0.22s ease, box-shadow 0.22s ease;
  padding: 0;
}

.toggle:active .knob {
  width: 24px;
}

.toggle .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1.5px 3px rgba(0, 0, 0, 0.28);
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.15s ease;
}

.toggle.on {
  background: var(--primary, #007aff);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04), 0 0 0 3px rgba(0, 122, 255, 0.18);
}

.toggle.on .knob {
  transform: translateX(17px);
}

.loading {
  text-align: center;
  color: var(--muted-foreground);
  padding: 24px 0;
  font-size: 13px;
}

/* ===== 记录列表 ===== */
.records {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 桌面端适配 ===== */
/* 弹窗 append-to-body 挂载在 body 下，scoped 选择器匹配不到，必须用 :global */
:global(.records-dlg) {
  max-width: 520px;
}

@media (min-width: 768px) {
  :global(.records-dlg) {
    max-width: 600px;
  }

  /* 记录行紧凑化：标题行 + 副信息/统计并排 */
  .record-item {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 18px;
    align-items: center;
    padding: 10px 14px;
  }

  .record-item .row-top {
    grid-column: 1 / -1;
  }

  .record-item .row-sub {
    margin: 0;
  }

  .record-item .row-nums {
    margin-top: 0;
    justify-content: flex-end;
    padding: 6px 14px;
  }

  .record-item .waste-detail,
  .record-item .row-meta,
  .record-item .edit-panel {
    grid-column: 1 / -1;
  }
}

.record-item {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
}

.row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seq {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.craft-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.edit-btn,
.del-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.edit-btn {
  color: var(--primary);
  background: rgba(0, 122, 255, 0.1);
}

.del-btn {
  color: var(--destructive);
  background: rgba(239, 68, 68, 0.1);
}

.edit-btn:active,
.del-btn:active {
  transform: scale(0.9);
  opacity: 0.75;
}

/* ===== 副信息行：时间 + 报工人 ===== */
.row-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 4px;
}

.report-time {
  font-size: 11.5px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
  letter-spacing: 0.01em;
}

.report-time::after {
  content: '·';
  margin-left: 10px;
  color: var(--border);
}

.user {
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  opacity: 0.85;
}

/* ===== 三列统计 ===== */
.row-nums {
  display: flex;
  gap: 0;
  margin-top: 10px;
  background: var(--muted);
  border-radius: 12px;
  padding: 10px 6px;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0 8px;
}

.stat + .stat {
  border-left: 1px solid var(--border);
}

.stat-key {
  font-size: 11px;
  color: var(--muted-foreground);
}

.stat-val {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.stat-val .unit {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted-foreground);
  margin-left: 3px;
}

.stat-val.good {
  color: var(--success);
}

.stat-val.bad {
  color: var(--destructive);
}

/* 不良品统计：有明细时可点击展开 */
.stat-waste {
  position: relative;
  cursor: default;
}

.stat-waste.clickable {
  cursor: pointer;
}

.stat-waste.clickable .stat-key {
  color: var(--destructive);
}

.waste-arrow {
  position: absolute;
  top: 3px;
  right: 10px;
  color: var(--muted-foreground);
  opacity: 0.7;
  transition: transform 0.2s ease, opacity 0.15s ease;
  pointer-events: none;
}

.stat-waste.clickable .waste-arrow {
  color: var(--destructive);
  opacity: 1;
}

.waste-arrow.open {
  transform: rotate(180deg);
}

.stat-waste.clickable:active {
  opacity: 0.6;
}

/* ===== 不良品项明细（点击展开） ===== */
.waste-detail {
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.waste-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--destructive);
  letter-spacing: 0.02em;
}

.waste-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.waste-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12.5px;
}

.wc-name {
  color: var(--foreground);
  font-weight: 500;
}

.wc-num {
  color: var(--destructive);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stat-val.work {
  color: var(--primary);
}

/* ===== 备注 / 金额 ===== */
.row-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.5;
}

.remark {
  max-width: 100%;
  overflow-wrap: break-word;
}

/* ===== 内联编辑表单 ===== */
.edit-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
  letter-spacing: 0.02em;
}

.edit-fields {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.field {
  flex: 1;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--muted-foreground);
}

.edit-fields :deep(.el-input-number) {
  width: 100%;
}

.edit-fields :deep(.el-input__wrapper) {
  border-radius: 10px;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* ===== 编辑区不良品项数量 ===== */
.edit-waste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
}

.edit-waste-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  letter-spacing: 0.02em;
}

.edit-waste-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ew-name {
  font-size: 13px;
  color: var(--foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-waste-row :deep(.el-input-number) {
  flex-shrink: 0;
}

.edit-waste-row :deep(.el-input__wrapper) {
  border-radius: 8px;
}

.edit-actions .el-button {
  min-width: 88px;
}
</style>
