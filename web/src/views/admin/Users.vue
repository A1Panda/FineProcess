<template>
  <section class="users-page">
    <!-- 工具栏：说明 + 同步按钮 -->
    <div class="toolbar">
      <p class="page-note">账号由快工单通讯录同步生成，初始密码 kgd123456；同步仅刷新姓名/岗位，不覆盖已改密码</p>
      <el-button class="sync-btn" type="primary" :loading="syncing" @click="syncUsers">
        <el-icon v-if="!syncing" :size="16"><Refresh /></el-icon>
        从快工单同步用户
      </el-button>
    </div>

    <!-- 用户列表（iOS 分组列表） -->
    <div v-loading="loading" class="user-panel">
      <div class="list-head">本地用户<span class="list-count">{{ users.length }}</span></div>
      <div class="user-cell" v-for="u in users" :key="u.id">
        <div class="uc-avatar">{{ u.name?.[0] || '工' }}</div>
        <div class="uc-main">
          <div class="uc-line1">
            <span class="uc-name">{{ u.name }}</span>
            <span
              class="uc-tag"
              :class="u.role === 'admin' ? 'is-admin' : u.role === 'manager' ? 'is-manager' : ''"
            >
              {{ u.role === 'admin' ? '管理员' : u.role === 'manager' ? '生产主管' : '工人' }}
            </span>
          </div>
          <div class="uc-sub">{{ u.username }} · {{ u.roleName || '—' }}</div>
          <div class="uc-dept">
            <el-icon :size="13"><OfficeBuilding /></el-icon>
            <span>{{ u.departmentPathNames || '未分配部门' }}</span>
          </div>
        </div>
        <button class="uc-edit" @click="openReset(u)">
          <el-icon :size="14"><EditPen /></el-icon>
          改密
        </button>
      </div>
      <div v-if="!loading && users.length === 0" class="empty">
        <el-icon :size="36"><User /></el-icon>
        <p class="empty-text">暂无本地用户</p>
        <p class="empty-desc">点击上方按钮从快工单同步用户账号</p>
      </div>
    </div>

    <!-- 修改密码弹窗 -->
    <el-dialog
      v-model="resetVisible"
      title="修改登录密码"
      width="min(92vw, 400px)"
      align-center
      destroy-on-close
    >
      <div class="reset-target">
        用户：<b>{{ resetUser?.name }}</b>
        <span class="reset-sub">{{ resetUser?.username }}</span>
      </div>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="新密码">
          <el-input v-model="newPwd" type="password" show-password placeholder="至少 6 位" autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="confirmPwd" type="password" show-password placeholder="再次输入新密码" autocomplete="new-password" @keyup.enter="submitReset" />
        </el-form-item>
      </el-form>
      <p class="reset-note">仅修改本地登录密码，不影响快工单账号；忘记新密码可再次重置</p>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="submitReset">确定</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const users = ref([])
const loading = ref(false)
const syncing = ref(false)

/* ===== 修改密码 ===== */
const resetVisible = ref(false)
const resetUser = ref(null)
const newPwd = ref('')
const confirmPwd = ref('')
const resetting = ref(false)

function openReset(u) {
  resetUser.value = u
  newPwd.value = ''
  confirmPwd.value = ''
  resetVisible.value = true
}

async function submitReset() {
  if (!newPwd.value || newPwd.value.length < 6) {
    ElMessage.warning('新密码长度至少 6 位')
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  resetting.value = true
  try {
    await api.post(`/auth/users/${resetUser.value.id}/password`, { password: newPwd.value })
    ElMessage.success(`已重置「${resetUser.value.name}」的登录密码`)
    resetVisible.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '修改失败')
  } finally {
    resetting.value = false
  }
}

async function loadUsers() {
  loading.value = true
  try {
    users.value = await api.get('/auth/users')
  } finally {
    loading.value = false
  }
}

async function syncUsers() {
  syncing.value = true
  try {
    const res = await api.post('/auth/sync-users')
    const { created = 0, removed = 0 } = res || {}
    if (created || removed) {
      ElMessage.success(`同步完成：新增 ${created} 个，删除 ${removed} 个`)
    } else {
      ElMessage.success('同步完成，无变更')
    }
    await loadUsers()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

onMounted(loadUsers)
</script>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
}

.sync-btn {
  width: 100%;
  height: 44px;
  border-radius: 13px;
  font-size: 14px;
  font-weight: 500;
}

/* ===== 用户列表（iOS 分组列表） ===== */
.user-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  min-height: 120px;
}

.list-head {
  padding: 12px 16px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 6px;
}

.list-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted-foreground);
  opacity: 0.8;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  -webkit-tap-highlight-color: transparent;
}

.uc-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--primary-soft, rgba(0, 122, 255, 0.12));
  color: var(--primary);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.uc-main {
  min-width: 0;
  flex: 1;
}

.uc-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.uc-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uc-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  line-height: 1.6;
}

.uc-tag.is-admin {
  color: var(--primary);
  border-color: rgba(0, 122, 255, 0.35);
  background: var(--primary-soft, rgba(0, 122, 255, 0.1));
}

.uc-tag.is-manager {
  color: #e6a23c;
  border-color: rgba(230, 162, 60, 0.4);
  background: rgba(230, 162, 60, 0.1);
}

.uc-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uc-dept {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted-foreground);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uc-edit {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.uc-edit:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft, rgba(0, 122, 255, 0.08));
}

/* ===== 修改密码弹窗 ===== */
.reset-target {
  margin-bottom: 14px;
  font-size: 14px;
  color: var(--foreground);
}

.reset-sub {
  margin-left: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.reset-note {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
}

/* ===== 空状态 ===== */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 16px;
  color: var(--muted-foreground);
  border-top: 1px solid var(--border);
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

/* ===== 桌面端：两列网格卡片 ===== */
@media (min-width: 768px) {
  .toolbar {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .page-note {
    max-width: 480px;
  }

  .sync-btn {
    width: auto;
    min-width: 180px;
    height: 40px;
  }

  .user-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    background: transparent;
    border: none;
    border-radius: 0;
    overflow: visible;
  }

  .list-head {
    grid-column: 1 / -1;
    padding: 0 4px 4px;
  }

  .user-cell {
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--card);
  }

  .empty {
    grid-column: 1 / -1;
    border: 1px dashed var(--border);
    border-radius: 16px;
    background: transparent;
  }
}

/* ===== 超宽桌面端：三列网格卡片 ===== */
@media (min-width: 1280px) {
  .user-panel {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
