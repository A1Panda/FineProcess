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
      </div>
    </div>

    <!-- 移动端表单：标签置顶，良品/不良品并排 -->
    <el-form label-position="top" class="report-form" @submit.prevent>
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
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({ task: Object })
const visible = defineModel('visible')
const emit = defineEmits(['success'])

const form = reactive({ validNum: 0, wasteNum: 0, workingMinutes: undefined, isFinish: false, remark: '' })
const submitting = ref(false)

watch(
  () => props.task,
  (t) => {
    if (t) {
      form.validNum = Number(t.num || 0)
      form.wasteNum = 0
      form.workingMinutes = undefined
      form.isFinish = false
      form.remark = ''
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
    await api.post('/report', {
      produceCraftId: props.task.id,
      validNum: Number(form.validNum),
      wasteNum: Number(form.wasteNum),
      isFinish: form.isFinish,
      workingMinutes: form.workingMinutes ?? undefined,
      remark: form.remark || undefined,
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

.bill-stats {
  display: flex;
  gap: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 0;
  font-size: 12px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}

.stat {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
}

.stat + .stat {
  border-left: 1px solid var(--border);
}

.stat b {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  margin: 0 2px;
}

.stat .ok {
  color: var(--success);
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
