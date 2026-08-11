<template>
  <el-dialog
    v-model="visible"
    :title="`报工记录 · ${props.task?.produceBillCode || ''}`"
    width="92%"
    :style="{ maxWidth: '520px' }"
    append-to-body
    destroy-on-close
  >
    <!-- 自定义标题：报工记录 + 加工单号 -->
    <template #header>
      <div class="dlg-header">
        <span class="dlg-title">报工记录</span>
        <span class="dlg-code">{{ props.task?.produceBillCode || '' }}</span>
      </div>
    </template>

    <!-- 商品信息卡 -->
    <div v-if="props.task" class="bill-card">
      <div class="bill-goods" :title="props.task.goodsName">{{ props.task.goodsName }}</div>
      <div class="bill-meta">
        <span v-if="props.task.craftName" class="chip chip-craft">{{ props.task.craftName }}</span>
        <span v-if="props.task.htNo" class="chip">HT {{ props.task.htNo }}</span>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <el-empty v-else-if="!records.length" description="暂无报工记录" />
    <div v-else class="records">
      <div v-for="(r, i) in records" :key="r.id" class="record-item">
        <div class="row-top">
          <span class="seq">{{ records.length - i }}</span>
          <span class="craft-name">{{ r.craftName }}</span>
          <span class="row-right">
            <span class="user">{{ r.reportUser }}</span>
            <button v-if="canEdit(r)" class="edit-btn" @click="startEdit(r)">
              <el-icon :size="12"><EditPen /></el-icon>
              修改
            </button>
          </span>
        </div>

        <!-- 三列统计：良品 / 不良品 / 工时 -->
        <div class="row-nums">
          <div class="stat">
            <span class="stat-key">良品</span>
            <span class="stat-val good">{{ r.validNum }}<span class="unit">{{ r.unitName }}</span></span>
          </div>
          <div class="stat">
            <span class="stat-key">不良品</span>
            <span class="stat-val bad">{{ r.wasteNum }}<span class="unit">{{ r.unitName }}</span></span>
          </div>
          <div v-if="Number(r.workingMinutes) > 0" class="stat">
            <span class="stat-key">工时</span>
            <span class="stat-val work">{{ r.workingMinutes }}<span class="unit">分</span></span>
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
import { ElMessage } from 'element-plus'
import { EditPen } from '@element-plus/icons-vue'
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

const editingId = ref(null)
const saving = ref(false)
const editForm = reactive({ validNum: 0, wasteNum: 0, workingMinutes: 0, remark: '' })

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

watch(visible, (v) => {
  if (v && props.task?.produceBillCode) {
    editingId.value = null
    loadRecords()
  }
})

/** 只能修改自己的报工 */
function canEdit(r) {
  return r.reportUserId && currentUserId.value && String(r.reportUserId) === String(currentUserId.value)
}

function startEdit(r) {
  editingId.value = r.id
  editForm.validNum = Number(r.validNum) || 0
  editForm.wasteNum = Number(r.wasteNum) || 0
  editForm.workingMinutes = Number(r.workingMinutes) || 0
  editForm.remark = r.remark || ''
}

async function saveEdit() {
  if (!editingId.value) return
  saving.value = true
  try {
    await api.put(`/report/${editingId.value}`, {
      billCode: props.task.produceBillCode,
      validNum: Number(editForm.validNum) || 0,
      wasteNum: Number(editForm.wasteNum) || 0,
      workingMinutes: Number(editForm.workingMinutes) || 0,
      remark: editForm.remark?.trim() || '',
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

/* ===== 商品信息卡 ===== */
.bill-card {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bill-goods {
  font-size: 14px;
  font-weight: 500;
  color: var(--foreground);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.bill-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
  max-height: 60vh;
  overflow-y: auto;
  margin: 0 -2px;
  padding: 2px;
}

.record-item {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--shadow-sm);
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
}

.row-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.user {
  font-size: 12px;
  color: var(--muted-foreground);
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--primary);
  background: rgba(0, 122, 255, 0.1);
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.edit-btn:active {
  opacity: 0.7;
}

/* ===== 三列统计 ===== */
.row-nums {
  display: flex;
  gap: 0;
  margin-top: 10px;
  background: var(--muted);
  border-radius: 12px;
  padding: 10px 0;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.stat + .stat {
  border-left: 1px solid var(--border);
}

.stat-key {
  font-size: 11px;
  color: var(--muted-foreground);
}

.stat-val {
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
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

.edit-actions .el-button {
  min-width: 88px;
}
</style>
