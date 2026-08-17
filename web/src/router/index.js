import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'
import CraftWorkbench from '../views/CraftWorkbench.vue'
import Profile from '../views/Profile.vue'
import AdminLayout from '../views/admin/AdminLayout.vue'
import AdminUsers from '../views/admin/Users.vue'
import AdminDataReportStats from '../views/admin/datascreen/ReportStats.vue'
import AdminDataBillProgress from '../views/admin/datascreen/BillProgress.vue'
import AdminDataCraftTrend from '../views/admin/datascreen/CraftTrend.vue'
import AdminDataBillForecast from '../views/admin/datascreen/BillForecast.vue'
import AdminFullScreen from '../views/admin/datascreen/FullScreen.vue'

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
      meta: { requiresAuth: true, adminOrMgr: true },
      children: [
        { path: '', redirect: '/admin/data/bill-progress' },
        { path: 'users', name: 'admin-users', component: AdminUsers, meta: { title: '权限管理', adminOnly: true } },
        // 数据大屏：统一分组入口，具体模块走子路由（未来新增模块在此追加）
        { path: 'data', redirect: '/admin/data/bill-progress' },
        { path: 'data/report-stats', name: 'admin-data-report-stats', component: AdminDataReportStats, meta: { title: '报工统计' } },
        { path: 'data/bill-progress', name: 'admin-data-bill-progress', component: AdminDataBillProgress, meta: { title: '加工单进度' } },
        { path: 'data/craft-trend', name: 'admin-data-craft-trend', component: AdminDataCraftTrend, meta: { title: '工序产出趋势' } },
        { path: 'data/bill-forecast', name: 'admin-data-bill-forecast', component: AdminDataBillForecast, meta: { title: '完工预测' } },
      ],
    },
    // 全屏大屏：真正全屏（无侧边栏/顶栏），聚合核心数据，适配电脑大屏
    {
      path: '/admin/fullscreen',
      name: 'admin-fullscreen',
      component: AdminFullScreen,
      meta: { requiresAuth: true, adminOrMgr: true, title: '全屏大屏' },
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) return '/login'
  if (to.path === '/login' && token) return '/'
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  // 管理员界面（含数据大屏）：系统管理员与车间主管可访问
  if (to.meta.adminOrMgr && (!user || !['admin', 'manager'].includes(user.role))) return '/'
  // 仅系统管理员：权限管理等管理功能
  if (to.meta.adminOnly && (!user || user.role !== 'admin')) return '/'
  return true
})

export default router
