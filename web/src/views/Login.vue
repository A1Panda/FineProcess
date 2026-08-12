<template>
  <div class="login-page">
    <div class="login-inner">
      <!-- 品牌区 -->
      <div class="brand">
        <div class="brand-logo">
          <img class="brand-logo-img" :src="logoUrl" alt="公司 Logo" />
        </div>
        <h1 class="title">青岛航天石墨工序管理系统</h1>
        <p class="subtitle">快工单 · 车间作业平台</p>
      </div>

      <!-- 表单卡 -->
      <div class="login-card">
        <el-form :model="form" @submit.prevent="submit">
          <label class="field-label" for="username">工号</label>
          <el-form-item>
            <el-input
              id="username"
              v-model="form.username"
              size="large"
              placeholder="请输入工号"
              prefix-icon="User"
              clearable
              autocomplete="username"
            />
          </el-form-item>
          <label class="field-label" for="password">密码</label>
          <el-form-item>
            <el-input
              id="password"
              v-model="form.password"
              size="large"
              type="password"
              placeholder="请输入密码"
              prefix-icon="Lock"
              show-password
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </el-form-item>
          <div class="login-options">
            <el-checkbox v-model="remember">记住密码（下次自动登录）</el-checkbox>
          </div>
          <el-button
            class="login-btn"
            type="primary"
            size="large"
            native-type="submit"
            :loading="loading"
            data-dom-id="login-submit"
          >
            登 录
          </el-button>
        </el-form>
        <p class="hint">登录遇到问题？请联系车间管理员</p>
      </div>

      <p class="version">快工单 v2.4.1</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import logoUrl from '../assets/logo-md.jpg'

const router = useRouter()
const auth = useAuthStore()

const form = ref({ username: '', password: '' })
const loading = ref(false)
const remember = ref(false)
const SAVED_KEY = 'kgd_saved_creds'
// 密码仅做简单混淆（本地局域网系统），配合 localStorage 实现"记住密码自动登录"
const enc = (s) => btoa(encodeURIComponent(s))
const dec = (s) => decodeURIComponent(atob(s))

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved?.username) {
      form.value.username = saved.username
      form.value.password = saved.password ? dec(saved.password) : ''
      remember.value = true
    }
  } catch {
    // 本地数据损坏则忽略，用户手动输入
  }
}

async function submit(auto = false) {
  if (!form.value.username || !form.value.password) {
    if (!auto) ElMessage.warning('请输入工号和密码')
    return
  }
  loading.value = true
  try {
    await auth.login(form.value.username, form.value.password)
    if (remember.value) {
      localStorage.setItem(
        SAVED_KEY,
        JSON.stringify({ username: form.value.username, password: enc(form.value.password) }),
      )
    } else {
      localStorage.removeItem(SAVED_KEY)
    }
    if (!auto) ElMessage.success('登录成功')
    router.push('/')
  } catch (e) {
    if (!auto) ElMessage.error(e.response?.data?.message || '登录失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadSaved()
  // 有记住的密码时自动登录，免去手动输入
  if (remember.value && form.value.password) submit(true)
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--background);
  display: flex;
  justify-content: center;
  padding: 48px 24px 32px;
}

.login-inner {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand {
  text-align: center;
  margin-bottom: 40px;
}

.brand-logo {
  width: 76px;
  height: 76px;
  margin: 0 auto;
  border-radius: 20px;
  background: #fff;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.brand-logo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.title {
  margin: 24px 0 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--foreground);
}

.subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--muted-foreground);
}

.login-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 24px 20px;
  box-shadow: var(--shadow-sm);
}

.field-label {
  display: block;
  font-size: 13px;
  color: var(--muted-foreground);
  margin-bottom: 8px;
}

.login-options {
  display: flex;
  justify-content: flex-start;
  margin: 0 0 18px;
}

.login-btn {
  width: 100%;
  font-size: 16px;
  letter-spacing: 0.2em;
}

.hint {
  margin: 16px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted-foreground);
}

.version {
  margin: 32px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
</style>
