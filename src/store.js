import { reactive, ref } from 'vue'

export const globalStoreName = ref('店小易')

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem('mini-shop-auth-user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const authState = reactive({
  token: typeof localStorage !== 'undefined' ? localStorage.getItem('mini-shop-auth-token') || '' : '',
  user: readStoredUser(),
  permissions: [],
  initialized: false,
  loading: false,
  sessionExpired: false,
  loginError: ''
})

export const setAuthSession = ({ token, user, permissions } = {}) => {
  if (token !== undefined) {
    authState.token = token || ''
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem('mini-shop-auth-token', token)
      else localStorage.removeItem('mini-shop-auth-token')
    }
  }
  if (user !== undefined) {
    authState.user = user || null
    if (typeof localStorage !== 'undefined') {
      if (user) localStorage.setItem('mini-shop-auth-user', JSON.stringify(user))
      else localStorage.removeItem('mini-shop-auth-user')
    }
  }
  if (permissions !== undefined) authState.permissions = Array.isArray(permissions) ? permissions : []
  authState.sessionExpired = false
  authState.initialized = true
}

export const clearAuthSession = () => {
  authState.token = ''
  authState.user = null
  authState.permissions = []
  authState.initialized = true
  authState.sessionExpired = false
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('mini-shop-auth-token')
    localStorage.removeItem('mini-shop-auth-user')
  }
}

export const hasPermission = (permission) => {
  if (!permission) return true
  if (!authState.initialized) return true
  if (authState.user?.is_superuser || authState.user?.isSuperuser) return true
  return authState.permissions.includes('*') || authState.permissions.includes(permission)
}
