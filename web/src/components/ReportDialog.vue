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

    <!-- 商品信息卡：商品名 + 单号 + 进度 -->
    <div v-if="task" class="bill-card">
      <div class="bill-head">
        <div class="bill-goods" :title="task.goodsName">{{ task.goodsName }}</div>
        <span class="bill-code">{{ task.produceBillCode }}</span>
      </div>
      <div class="bill-stats">
        <span class="bs-good">
          已报良品 <b class="bs-num good">{{ task.validNum }}</b>
          <span class="bs-total">/ {{ task.num }} {{ task.unitName }}</span>
        </span>
        <div class="bs-bar"><div class="bs-fill" :style="{ width: donePct + '%' }"></div></div>
        <span class="bs-remain">剩 <b class="bs-num remain">{{ remaining }}</b></span>
      </div>
    </div>

    <!-- 移动端表单：标签置顶，良品/不良品并排 -->
    <el-form label-position="top" class="report-form" @submit.prevent>
      <el-form-item label="报工人" class="field-full">
        <el-select v-model="reporterId" placeholder="选择报工人" filterable clearable style="width: 100%">
          <el-option
            v-for="u in reporterOptions"
            :key="u.kgdUserId ?? u.name"
            :label="u.code ? `${u.name} (${u.code})` : u.name"
            :value="u.kgdUserId"
          />
        </el-select>
      </el-form-item>
      <div class="field-row">
        <el-form-item label="良品数" required class="field-half">
          <el-input-number v-model="form.validNum" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <!-- 未配置不良品项的工序：直接输入不良品数 -->
        <el-form-item v-if="!wasteItemNames.length" label="不良品数" class="field-half">
          <el-input-number v-model="form.wasteNum" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <!-- 已配置不良品项：数量由明细自动汇总（只读展示） -->
        <el-form-item v-else label="不良品数" class="field-half">
          <div class="waste-total" :class="{ none: wasteTotal === 0 }">
            {{ wasteTotal }} <span class="waste-total-hint">由明细汇总</span>
          </div>
        </el-form-item>
      </div>
      <!-- 不良品项（选填）：用户主动勾选要填报的项，避免一长串输入框 -->
      <el-form-item v-if="wasteItemNames.length" label="不良品项（选填）">
        <div class="waste-items">
          <!-- 未展开：添加入口 -->
          <template v-if="!wastePicking">
            <button class="waste-add" type="button" @click="wastePicking = true">
              <el-icon :size="14"><Plus /></el-icon>
              <span>添加不良品项</span>
              <span v-if="selectedWasteItems.length" class="waste-add-num">{{ selectedWasteItems.length }}</span>
            </button>
          </template>

          <!-- 展开：勾选网格 -->
          <template v-else>
            <div class="waste-grid">
              <button
                v-for="name in wasteItemNames"
                :key="name"
                type="button"
                class="waste-chip"
                :class="{ on: selectedWasteItems.includes(name) }"
                @click="toggleWasteItem(name)"
              >
                {{ name }}
              </button>
            </div>
            <button class="waste-done" type="button" @click="wastePicking = false">完成</button>
          </template>

          <!-- 已选输入行 -->
          <div v-for="name in selectedWasteItems" :key="name" class="waste-row">
            <span class="waste-name">{{ name }}</span>
            <el-input-number
              v-model="form.wasteItems[name]"
              :min="0"
              :precision="0"
              :controls="false"
              placeholder="0"
              style="width: 110px"
            />
            <button class="waste-del" type="button" aria-label="移除" @click="removeWasteItem(name)">
              <el-icon :size="12"><Close /></el-icon>
            </button>
          </div>
        </div>
      </el-form-item>
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

const form = reactive({ validNum: 0, wasteNum: 0, workingMinutes: undefined, isFinish: false, remark: '', wasteItems: {} })
const submitting = ref(false)

/** 当前工序配置的不良品项（来自快工单工序 waste_item_names），用于报工明细选择 */
const wasteItemNames = ref([])
/** 用户主动勾选的不良品项（仅这些显示输入框） */
const selectedWasteItems = ref([])
/** 是否正在展开勾选网格 */
const wastePicking = ref(false)
let craftsCache = null
/** 不良品项字典（全企业，name → code 编号），提交时映射编号（传名称会报「不良品项不存在」） */
const wasteDict = ref([])

/** 勾选/取消勾选不良品项 */
function toggleWasteItem(name) {
  const i = selectedWasteItems.value.indexOf(name)
  if (i >= 0) {
    selectedWasteItems.value.splice(i, 1)
    delete form.wasteItems[name]
  } else {
    selectedWasteItems.value.push(name)
    if (!(name in form.wasteItems)) form.wasteItems[name] = 0
  }
}

/** 移除已选不良品项 */
function removeWasteItem(name) {
  const i = selectedWasteItems.value.indexOf(name)
  if (i >= 0) selectedWasteItems.value.splice(i, 1)
  delete form.wasteItems[name]
}

async function loadWasteItems() {
  const craftName = props.task?.craftName
  wasteItemNames.value = []
  selectedWasteItems.value = []
  wastePicking.value = false
  if (!craftName) return
  try {
    if (!craftsCache) craftsCache = (await api.get('/crafts')) ?? []
    const c = craftsCache.find((x) => x.name === craftName)
    wasteItemNames.value = (c?.wasteItemNames ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    wasteItemNames.value = []
  }
  // 不良品项字典（name → code），弹窗打开时拉一次，带后端缓存
  try {
    wasteDict.value = (await api.get('/crafts/waste-items')) ?? []
  } catch {
    wasteDict.value = []
  }
}

/** 报工人选择：候选 = 外部人员名单（含当日编码）按工序可报工人过滤 + 当前用户兜底 */
const allUsers = ref([])
const reporterOptions = ref([])
const reporterId = ref()

async function loadReporters() {
  // 外部人员名单（含当日编码），失败则降级为本地用户列表
  let external = null
  try {
    external = (await api.get('/auth/reporters')) ?? null // [{ name, code, kgdUserId }]
  } catch {
    external = null
  }
  // 本地用户：姓名 → 快工单 kgdUserId 的兜底映射
  try {
    allUsers.value = (await api.get('/auth/users')) ?? []
  } catch {
    allUsers.value = []
  }
  const taskNames = (props.task?.reportableUserNames ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const me = allUsers.value.find((u) => u.kgdUserId === auth.user?.kgdUserId)
  const meName = me?.name ?? auth.user?.name

  // 候选姓名 = 工序可报工人 ∪ 当前用户（去重）
  const names = [...new Set(taskNames)]
  if (meName && !names.includes(meName)) names.push(meName)

  const extBy = new Map((external ?? []).map((e) => [e.name, e]))
  const localBy = new Map(allUsers.value.map((u) => [u.name, u]))
  reporterOptions.value = names
    .map((n) => {
      const ext = extBy.get(n)
      const loc = localBy.get(n)
      return {
        kgdUserId: ext?.kgdUserId ?? loc?.kgdUserId ?? null,
        name: n,
        code: ext?.code ?? null,
      }
    })
    .filter((o) => o.kgdUserId != null || o.name === meName)
  reporterId.value = me?.kgdUserId ?? reporterOptions.value[0]?.kgdUserId
}

/** 剩余待加工数量 = 计划 - 已报良品 */
const remaining = computed(() =>
  Math.max(0, (Number(props.task?.num) || 0) - (Number(props.task?.validNum) || 0)),
)

/** 不良品明细自动汇总（配置了不良品项的工序，不良品总数由此得出） */
const wasteTotal = computed(() =>
  Object.values(form.wasteItems).reduce((s, n) => s + (Number(n) || 0), 0),
)

/** 已完成百分比（0-100），用于进度条 */
const donePct = computed(() => {
  const num = Number(props.task?.num) || 0
  if (num <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(((Number(props.task?.validNum) || 0) / num) * 100)))
})

watch(
  () => props.task,
  (t) => {
    if (t) {
      form.validNum = remaining.value
      form.wasteNum = 0
      form.workingMinutes = undefined
      form.isFinish = false
      form.remark = ''
      form.wasteItems = {}
      loadReporters()
      loadWasteItems()
    }
  },
)

async function submit() {
  // 配置了不良品项的工序：总数由明细汇总得出；未配置的用输入框值
  const wasteNum = wasteItemNames.value.length ? wasteTotal.value : Number(form.wasteNum)
  if (form.validNum <= 0 && wasteNum <= 0) {
    ElMessage.warning('请至少填写良品数或不良品数')
    return
  }
  submitting.value = true
  try {
    const rep = reporterOptions.value.find((o) => o.kgdUserId === reporterId.value)
    // 不良品项明细：仅提交数量>0 的项；wasteItemCode 映射为字典编号（快工单要求编号，传名称报「不良品项不存在」）
    const codeByName = new Map(wasteDict.value.map((w) => [w.name, w.code]))
    const wasteItems = Object.entries(form.wasteItems)
      .filter(([, n]) => Number(n) > 0)
      .map(([name, n]) => ({ wasteItemCode: codeByName.get(name) ?? name, num: Number(n) }))
    const res = await api.post('/report', {
      produceCraftId: props.task.id,
      validNum: Number(form.validNum),
      wasteNum,
      isFinish: form.isFinish,
      workingMinutes: form.workingMinutes ?? undefined,
      remark: form.remark || undefined,
      wasteItems: wasteItems.length ? wasteItems : undefined,
      reportUserId: reporterId.value ?? auth.user?.kgdUserId,
      reportUserName: rep?.name ?? auth.user?.name,
    })
    // 报工累计良品达到计划数：系统已自动将该工序标记为完成
    if (res?.data?.autoDone) {
      ElMessage.success('累计良品已达计划数，该工序已自动完工')
    } else {
      ElMessage.success('报工成功')
    }
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
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.bill-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.bill-code {
  flex-shrink: 0;
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--muted-foreground);
}

.bill-goods {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--foreground);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  word-break: break-all;
}

/* ===== 统计区：单行（已报良品 + 进度条 + 剩余） ===== */
.bill-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  font-variant-numeric: tabular-nums;
}

.bs-good {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.bs-num {
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}

.bs-num.good {
  color: var(--success);
}

.bs-total {
  font-size: 11.5px;
  color: var(--muted-foreground);
}

.bs-bar {
  flex: 1;
  min-width: 0;
  height: 5px;
  border-radius: 999px;
  background: var(--muted);
  overflow: hidden;
}

.bs-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--success), #4cd964);
  transition: width 0.4s ease;
}

.bs-remain {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-foreground);
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
}

.bs-num.remain {
  color: var(--warning);
}

/* ===== 表单 ===== */
.report-form {
  /* 滚动交给弹窗 body 统一处理，避免嵌套滚动 */
  padding: 2px;
}

.report-form :deep(.el-form-item) {
  margin-bottom: 11px;
}

.report-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.report-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.4;
  padding-bottom: 4px;
}

.field-row {
  display: flex;
  gap: 10px;
}

.field-row .field-half {
  flex: 1;
  min-width: 0;
}

/* ===== 不良品项明细 ===== */
.waste-items {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  box-sizing: border-box;
}

/* 添加入口：虚线胶囊 */
.waste-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 34px;
  padding: 0 14px;
  border: 1.5px dashed var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.waste-add:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft, rgba(0, 122, 255, 0.06));
}

.waste-add-num {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  font-variant-numeric: tabular-nums;
}

/* 勾选网格 */
.waste-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.waste-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--background, transparent);
  color: var(--muted-foreground);
  font-size: 12.5px;
  line-height: 1;
  text-align: center;
  /* 长文本（如"三坐标检测不良"）单行省略，避免换行导致网格高度不齐 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.waste-chip.on {
  color: #fff;
  border-color: transparent;
  background: var(--primary);
}

.waste-done {
  align-self: flex-end;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  padding: 2px 6px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.waste-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.waste-row + .waste-row {
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.waste-name {
  font-size: 13px;
  color: var(--foreground);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.waste-del {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  background: var(--muted, rgba(128, 128, 128, 0.1));
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.waste-del:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
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
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.finish-check :deep(.el-checkbox__label) {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
}

/* 不良品汇总展示（替代输入框，由明细求和） */
.waste-total {
  width: 100%;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
}

.waste-total.none {
  color: var(--muted-foreground);
}

.waste-total-hint {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--muted-foreground);
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
