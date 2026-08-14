<template>
  <section class="profile-page">
    <!-- 顶部栏（毛玻璃，与管理员界面一致） -->
    <header class="header">
      <div class="header-inner">
        <div class="header-left">
          <button class="back-btn" aria-label="返回" @click="goBack">
            <el-icon :size="18"><Back /></el-icon>
          </button>
          <div class="header-text">
            <h1 class="title">个人中心</h1>
            <p class="subtitle">{{ displayName }} 的信息与登录密码</p>
          </div>
        </div>
        <button class="theme-toggle" aria-label="切换深色模式" :class="{ anim: themeAnim }" @click="onToggleTheme">
          <span class="toggle-icon"><el-icon :size="18"><Moon v-if="isDark" /><Sunny v-else /></el-icon></span>
        </button>
      </div>
    </header>

    <div class="content">
      <!-- 个人信息 -->
      <div class="panel profile-card" v-loading="loading">
        <div class="pc-head">
          <div class="pc-avatar">{{ displayName?.[0] || '工' }}</div>
          <div class="pc-main">
            <div class="pc-line1">
              <span class="pc-name">{{ displayName }}</span>
              <span class="pc-tag" :class="isAdmin ? 'is-admin' : ''">{{ isAdmin ? '管理员' : '工人' }}</span>
            </div>
            <div class="pc-sub">{{ profile?.roleName || '—' }}</div>
          </div>
        </div>
        <div class="pc-rows">
          <div class="pc-row"><span class="k">工号</span><span class="v">{{ profile?.username || '—' }}</span></div>
          <div class="pc-row"><span class="k">岗位</span><span class="v">{{ profile?.roleName || '—' }}</span></div>
          <div class="pc-row">
            <span class="k">部门</span>
            <span class="v">{{ profile?.departmentPathNames || '未分配部门' }}</span>
          </div>
          <div class="pc-row">
            <span class="k">系统角色</span>
            <span class="v">{{ isAdmin ? '管理员' : '工人' }}</span>
          </div>
          <div class="pc-row"><span class="k">快工单账号 ID</span><span class="v">{{ profile?.kgdUserId ?? '—' }}</span></div>
          <div class="pc-row">
            <span class="k">已分配工序</span>
            <span class="v">{{ profile?.hasCraft ? '是' : '否' }}</span>
          </div>
        </div>
      </div>

      <!-- 修改密码 -->
      <div class="panel pwd-card">
        <div class="panel-title">
          <el-icon :size="16"><Lock /></el-icon>
          修改登录密码
        </div>
        <el-form label-position="top" @submit.prevent="submitPwd">
          <el-form-item label="原密码">
            <el-input v-model="oldPwd" type="password" show-password placeholder="请输入原密码" autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="newPwd" type="password" show-password placeholder="至少 6 位" autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="confirmPwd" type="password" show-password placeholder="再次输入新密码" autocomplete="new-password" @keyup.enter="submitPwd" />
          </el-form-item>
          <el-button class="pwd-btn" type="primary" :loading="saving" native-type="submit">保存新密码</el-button>
        </el-form>
        <p class="pwd-note">仅修改本系统的登录密码，不影响快工单；忘记密码可联系管理员重置</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import { isDark as getDark, toggleTheme } from '../utils/theme'

const router = useRouter()
const auth = useAuthStore()

const profile = ref(null)
const loading = ref(false)
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const saving = ref(false)

/* ===== 主题切换 ===== */
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

const displayName = computed(() => profile.value?.name || auth.user?.name || '')
const isAdmin = computed(() => (profile.value?.role || auth.user?.role) === 'admin')

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

async function loadProfile() {
  loading.value = true
  try {
    profile.value = await api.get('/auth/me')
    // 同步最新信息到本地（岗位/部门/角色可能随快工单同步而变化）
    auth.setUser({ ...auth.user, ...profile.value })
  } catch {
    // 401 由拦截器处理跳登录
  } finally {
    loading.value = false
  }
}

async function submitPwd() {
  if (!oldPwd.value) return ElMessage.warning('请输入原密码')
  if (!newPwd.value || newPwd.value.length < 6) return ElMessage.warning('新密码长度至少 6 位')
  if (newPwd.value !== confirmPwd.value) return ElMessage.warning('两次输入的密码不一致')
  saving.value = true
  try {
    await api.post('/auth/me/password', { oldPassword: oldPwd.value, newPassword: newPwd.value })
    ElMessage.success('密码修改成功')
    oldPwd.value = newPwd.value = confirmPwd.value = ''
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '修改失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadProfile)
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: var(--background);
  display: flex;
  flex-direction: column;
}

/* ===== 毛玻璃顶栏（与管理员界面一致） ===== */
.header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.header-inner {
  max-width: 640px;
  margin: 0 auto;
  padding: 12px 16px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.back-btn {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.back-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.header-text {
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--foreground);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--muted-foreground);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 内容区 ===== */
.content {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 卡片面板 ===== */
.panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
}

/* ===== 个人信息 ===== */
.pc-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.pc-avatar {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: var(--primary-soft, rgba(0, 122, 255, 0.12));
  color: var(--primary);
  font-size: 22px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pc-main {
  min-width: 0;
}

.pc-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pc-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pc-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  line-height: 1.6;
}

.pc-tag.is-admin {
  color: var(--primary);
  border-color: rgba(0, 122, 255, 0.35);
  background: var(--primary-soft, rgba(0, 122, 255, 0.1));
}

.pc-sub {
  margin-top: 3px;
  font-size: 13px;
  color: var(--muted-foreground);
}

.pc-rows {
  margin-top: 6px;
}

.pc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}

.pc-row:last-child {
  border-bottom: none;
}

.pc-row .k {
  color: var(--muted-foreground);
  flex-shrink: 0;
}

.pc-row .v {
  color: var(--foreground);
  font-weight: 500;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}

/* ===== 修改密码 ===== */
.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  margin-bottom: 14px;
}

.pwd-btn {
  width: 100%;
  height: 44px;
  border-radius: 13px;
  font-size: 14px;
  font-weight: 500;
  margin-top: 4px;
}

.pwd-note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
}
</style>
