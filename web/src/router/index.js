import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'
import CraftWorkbench from '../views/CraftWorkbench.vue'
import Profile from '../views/Profile.vue'
import AdminLayout from '../views/admin/AdminLayout.vue'
import AdminUsers from '../views/admin/Users.vue'
import AdminData from '../views/admin/datascreen.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: Login },
    { path: '/', name: 'dashboard', component: Dashboard, meta: { requiresAuth: true } },
    { path: '/dashboard', redirect: '/' },
    { path: '/craft/:name', name: 'craft', component: CraftWorkbench, meta: { requiresAuth: true } },
    { path: '/profile', name: 'profile', component: Profile, meta: { requiresAuth: true } },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true, adminOnly: true },
      children: [
        { path: '', redirect: '/admin/users' },
        { path: 'users', name: 'admin-users', component: AdminUsers, meta: { title: '权限管理' } },
        { path: 'data', name: 'admin-data', component: AdminData, meta: { title: '数据大屏' } },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) return '/login'
  if (to.path === '/login' && token) return '/'
  // 管理员专用页面：非管理员重定向回工作台
  if (to.meta.adminOnly) {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!user || user.role !== 'admin') return '/'
  }
  return true
})

export default router
