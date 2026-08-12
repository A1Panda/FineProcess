<template>
  <el-dialog
    v-model="visible"
    width="92%"
    :style="{ maxWidth: '420px' }"
    destroy-on-close
  >
    <!-- 自定义标题：报工 + 工序徽章 -->
    <template #header>
      <div class="dlg-header">
        <span class="dlg-title">报工</span>
        <span v-if="task?.craftName" class="chip chip-craft">{{ task.craftName }}</span>
      </div>
    </template>

    <!-- 商品信息卡：单号 + 商品名 + 计划/已报统计 -->
    <div v-if="task" class="bill-card">
      <div class="bill-code">
        <el-icon :size="13"><CopyDocument /></el-icon>
        <span class="code">{{ task.produceBillCode }}</span>
      </div>
      <div class="bill-goods" :title="task.goodsName">{{ task.goodsName }}</div>
      <div class="bill-stats">
        <span class="stat">计划 <b>{{ task.num }}</b><span class="unit">{{ task.unitName }}</span></span>
        <span class="stat">已报良品 <b class="ok">{{ task.validNum }}</b></span>
        <span class="stat">剩余待加工 <b class="remain">{{ remaining }}</b></span>
      </div>
    </div>

    <!-- 移动端表单：标签置顶，良品/不良品并排 -->
    <el-form label-position="top" class="report-form" @submit.prevent>
      <el-form-item label="报工人" class="field-full">
        <el-select v-model="reporterId" placeholder="选择报工人" filterable clearable style="width: 100%">
          <el-option
            v-for="u in reporterOptions"
            :key="u.kgdUserId"
            :label="u.name"
            :value="u.kgdUserId"
          />
        </el-select>
      </el-form-item>
      <div class="field-row">
        <el-form-item label="良品数" required class="field-half">
          <el-input-number v-model="form.validNum" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="不良品数" class="field-half">
          <el-input-number v-model="form.wasteNum" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
      </div>
      <el-form-item label="用时（分）">
        <el-input-number v-model="form.workingMinutes" :min="0" :precision="0" :controls="false" placeholder="选填" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" placeholder="选填" />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="form.isFinish" class="finish-check">本次报工后该任务完工</el-checkbox>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dlg-footer">
        <el-button class="ft-btn" @click="visible = false">取消</el-button>
        <el-button class="ft-btn" type="primary" :loading="submitting" @click="submit">提交报工</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useAuthStore } from '../stores/auth'

const props = defineProps({ task: Object })
const visible = defineModel('visible')
const emit = defineEmits(['success'])

const auth = useAuthStore()

const form = reactive({ validNum: 0, wasteNum: 0, workingMinutes: undefined, isFinish: false, remark: '' })
const submitting = ref(false)

/** 报工人选择：候选 = 该工序任务可报工人（快工单按工序配置）+ 当前用户兜底 */
const allUsers = ref([])
const reporterOptions = ref([])
const reporterId = ref()

async function loadReporters() {
  try {
    allUsers.value = (await api.get('/auth/users')) ?? []
  } catch {
    allUsers.value = []
  }
  const taskNames = (props.task?.reportableUserNames ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const opts = allUsers.value.filter((u) => taskNames.includes(u.name))
  const me = allUsers.value.find((u) => u.kgdUserId === auth.user?.kgdUserId)
  if (me && !opts.some((o) => o.kgdUserId === me.kgdUserId)) opts.unshift(me)
  reporterOptions.value = opts
  reporterId.value = me?.kgdUserId ?? opts[0]?.kgdUserId
}

/** 剩余待加工数量 = 计划 - 已报良品 */
const remaining = computed(() =>
  Math.max(0, (Number(props.task?.num) || 0) - (Number(props.task?.validNum) || 0)),
)

watch(
  () => props.task,
  (t) => {
    if (t) {
      form.validNum = remaining.value
      form.wasteNum = 0
      form.workingMinutes = undefined
      form.isFinish = false
      form.remark = ''
      loadReporters()
    }
  },
)

async function submit() {
  if (form.validNum <= 0 && form.wasteNum <= 0) {
    ElMessage.warning('请至少填写良品数或不良品数')
    return
  }
  submitting.value = true
  try {
    const rep = reporterOptions.value.find((o) => o.kgdUserId === reporterId.value)
    await api.post('/report', {
      produceCraftId: props.task.id,
      validNum: Number(form.validNum),
      wasteNum: Number(form.wasteNum),
      isFinish: form.isFinish,
      workingMinutes: form.workingMinutes ?? undefined,
      remark: form.remark || undefined,
      reportUserId: reporterId.value ?? auth.user?.kgdUserId,
      reportUserName: rep?.name ?? auth.user?.name,
    })
    ElMessage.success('报工成功')
    visible.value = false
    emit('success')
  } catch {
    /* 拦截器已提示 */
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* ===== 弹窗标题 ===== */
.dlg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dlg-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--foreground);
  letter-spacing: -0.01em;
}

.chip {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
}

.chip-craft {
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
  font-weight: 500;
}

/* ===== 商品信息卡 ===== */
.bill-card {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bill-code {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted-foreground);
  min-width: 0;
}

.bill-code .code {
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  color: var(--foreground);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ===== 统计条：单行紧凑排布 ===== */
.bill-stats {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 4px;
  font-size: 12px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.stat {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  white-space: nowrap;
}

.stat + .stat {
  border-left: 1px solid var(--border);
}

.stat b {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
}

.stat .ok {
  color: var(--success);
}

.stat .remain {
  color: var(--warning);
}

.stat .unit {
  font-size: 11px;
}

.stat .remain {
  color: var(--warning);
}

.stat .unit {
  font-size: 11px;
}

/* ===== 表单 ===== */
.report-form {
  max-height: 56vh;
  overflow-y: auto;
  padding: 2px;
}

.report-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.report-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.report-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.4;
  padding-bottom: 6px;
}

.field-row {
  display: flex;
  gap: 10px;
}

.field-row .field-half {
  flex: 1;
  min-width: 0;
}

.report-form :deep(.el-input-number) {
  width: 100%;
}

.report-form :deep(.el-input__wrapper),
.report-form :deep(.el-textarea__inner) {
  border-radius: 10px;
}

.report-form :deep(.el-input__inner) {
  font-variant-numeric: tabular-nums;
}

/* ===== 完工勾选 ===== */
.finish-check {
  width: 100%;
  height: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 122, 255, 0.06);
  border: 1px solid rgba(0, 122, 255, 0.16);
  border-radius: 12px;
  padding: 12px 14px;
  box-sizing: border-box;
}

.finish-check :deep(.el-checkbox__label) {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
}

/* ===== 底部按钮 ===== */
.dlg-footer {
  display: flex;
  gap: 10px;
  width: 100%;
}

.dlg-footer .ft-btn {
  flex: 1;
  height: 44px;
  margin: 0;
  font-size: 15px;
}
</style>
