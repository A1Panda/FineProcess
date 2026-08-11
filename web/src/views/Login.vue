<template>
  <div class="login-page">
    <div class="login-inner">
      <!-- 品牌区 -->
      <div class="brand">
        <div class="brand-logo">
          <el-icon :size="30"><Briefcase /></el-icon>
        </div>
        <h1 class="title">工序管理系统</h1>
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const form = ref({ username: '', password: '' })
const loading = ref(false)

async function submit() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入工号和密码')
    return
  }
  loading.value = true
  try {
    await auth.login(form.value.username, form.value.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '登录失败')
  } finally {
    loading.value = false
  }
}
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
  width: 64px;
  height: 64px;
  margin: 0 auto;
  border-radius: 18px;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
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
