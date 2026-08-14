<template>
  <div class="page admin-layout">
    <!-- 顶部栏（毛玻璃） -->
    <header class="header">
      <div class="header-inner">
        <div class="header-left">
          <button class="back-btn" aria-label="返回工作台" @click="router.push('/')">
            <el-icon :size="18"><Back /></el-icon>
          </button>
          <div class="header-text">
            <h1 class="title">管理员界面</h1>
            <p class="subtitle">当前管理员：{{ auth.user?.name }}</p>
          </div>
        </div>
        <div class="header-right">
          <button class="theme-toggle" aria-label="切换深色模式" :class="{ anim: themeAnim }" @click="onToggleTheme">
            <span class="toggle-icon"><el-icon :size="18"><Moon v-if="isDark" /><Sunny v-else /></el-icon></span>
          </button>
          <el-dropdown popper-class="user-popper" @command="onCommand">
            <div class="avatar" :aria-label="auth.user?.name">{{ avatarChar }}</div>
            <template #dropdown>
              <el-dropdown-menu>
                <!-- 用户信息头：头像 + 姓名 + 岗位 -->
                <div class="up-head">
                  <div class="up-avatar">{{ avatarChar }}</div>
                  <div class="up-id">
                    <div class="up-name">{{ auth.user?.name }}</div>
                    <div class="up-role">{{ roleNameText }}</div>
                  </div>
                </div>
                <div class="up-perm">
                  <el-icon :size="14"><Lock /></el-icon>
                  <span>{{ permissionText }}</span>
                </div>
                <el-dropdown-item command="profile">
                  <el-icon :size="14"><User /></el-icon>个人中心
                </el-dropdown-item>
                <el-dropdown-item divided command="workbench">
                  <el-icon :size="14"><HomeFilled /></el-icon>返回工作台
                </el-dropdown-item>
                <el-dropdown-item command="logout" class="up-logout">
                  <el-icon :size="14"><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- 移动端：分段控件导航 -->
      <nav class="seg-nav" aria-label="管理员功能导航">
        <div class="seg-control">
          <button
            v-for="t in tabs"
            :key="t.path"
            class="seg-item"
            :class="{ active: $route.path === t.path }"
            @click="router.push(t.path)"
          >
            <el-icon :size="15"><component :is="t.icon" /></el-icon>
            <span>{{ t.label }}</span>
          </button>
        </div>
      </nav>
    </header>

    <div class="admin-body">
      <!-- 桌面端：左侧功能导航 -->
      <aside class="admin-side">
        <el-menu class="side-menu" :default-active="$route.path" router>
          <el-menu-item index="/admin/users">
            <el-icon><User /></el-icon>
            <span>权限管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/data">
            <el-icon><DataAnalysis /></el-icon>
            <span>数据大屏</span>
            <span class="menu-tag">开发中</span>
          </el-menu-item>
        </el-menu>
      </aside>

      <!-- 内容区 -->
      <main class="admin-main">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { isDark as getDark, toggleTheme } from '../../utils/theme'

const router = useRouter()
const auth = useAuthStore()

const tabs = [
  { path: '/admin/users', label: '权限管理', icon: 'User' },
  { path: '/admin/data', label: '数据大屏', icon: 'DataAnalysis' },
]

const avatarChar = computed(() => auth.user?.name?.[0] || '管')

/** 岗位名：优先显示快工单岗位（如 系统管理员），无则按系统角色兜底 */
const roleNameText = computed(
  () => auth.user?.roleName || (auth.user?.role === 'admin' ? '管理员' : '工人'),
)

const permissionText = computed(() =>
  auth.user?.role === 'admin' ? '管理员：可管理用户权限与系统功能' : '工人：无管理员权限',
)

function onCommand(cmd) {
  if (cmd === 'logout') {
    auth.logout()
    router.push('/login')
  } else if (cmd === 'workbench') {
    router.push('/')
  } else if (cmd === 'profile') {
    router.push('/profile')
  }
}

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
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: var(--background);
}

/* ===== 毛玻璃顶栏 ===== */
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
  max-width: 1024px;
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

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.avatar {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--primary);
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
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

/* ===== 移动端分段控件导航 ===== */
.seg-nav {
  max-width: 1024px;
  margin: 0 auto;
  padding: 0 16px 10px;
}

.seg-control {
  display: flex;
  background: rgba(128, 128, 128, 0.12);
  border-radius: 999px;
  padding: 3px;
}

.seg-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.seg-item.active {
  background: var(--card);
  color: var(--foreground);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
}

/* ===== 桌面端布局 ===== */
.admin-body {
  max-width: 1024px;
  margin: 0 auto;
  padding: 20px 16px 32px;
}

.admin-side {
  display: none;
}

@media (min-width: 768px) {
  .admin-body {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }

  .seg-nav {
    display: none;
  }

  .admin-side {
    display: block;
    width: 200px;
    flex-shrink: 0;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    position: sticky;
    top: 78px;
  }

  .side-menu {
    border-right: none;
    background: transparent;
  }

  .side-menu :deep(.el-menu-item) {
    color: var(--muted-foreground);
    height: 44px;
  }

  .side-menu :deep(.el-menu-item:hover) {
    background: var(--muted, rgba(128, 128, 128, 0.08));
    color: var(--foreground);
  }

  .side-menu :deep(.el-menu-item.is-active) {
    background: var(--primary-soft, rgba(59, 130, 246, 0.1));
    color: var(--primary);
    font-weight: 600;
  }

  .menu-tag {
    margin-left: auto;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--muted-foreground);
    line-height: 1.6;
  }

  .admin-main {
    flex: 1;
    min-width: 0;
  }
}
</style>
