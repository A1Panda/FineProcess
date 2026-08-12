import { defineStore } from 'pinia'
import api from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null'),
  }),
  actions: {
    async login(username, password) {
      const data = await api.post('/auth/login', { username, password })
      this.token = data.accessToken
      this.user = data.user
      localStorage.setItem('token', data.accessToken)
      localStorage.setItem('user', JSON.stringify(data.user))
    },
    /** 用后端返回的最新用户信息刷新本地（登录后岗位/权限可能变化） */
    setUser(user) {
      this.user = user
      localStorage.setItem('user', JSON.stringify(user))
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
  },
})
