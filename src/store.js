import { reactive, ref } from 'vue'

export const globalStoreName = ref('店小易')

const AUTH_TOKEN_KEY = 'mini-shop-auth-token'
const AUTH_USER_KEY = 'mini-shop-auth-user'
const AUTH_PERMISSIONS_KEY = 'mini-shop-auth-permissions'

const readStoredPermissions = () => {
  if (typeof localStorage === 'undefined') return { value: [], present: false }
  try {
    const raw = localStorage.getItem(AUTH_PERMISSIONS_KEY)
    if (raw == null) return { value: [], present: false }
    const value = JSON.parse(raw)
    return { value: Array.isArray(value) ? value.filter(Boolean) : [], present: true }
  } catch {
    return { value: [], present: false }
  }
}

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const storedPermissions = readStoredPermissions()

export const authState = reactive({
  token: typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) || '' : '',
  user: readStoredUser(),
  permissions: storedPermissions.value,
  permissionsLoaded: storedPermissions.present,
  initialized: false,
  loading: false,
  sessionExpired: false,
  loginError: ''
})

export const setAuthSession = ({ token, user, permissions } = {}) => {
  if (token !== undefined) {
    authState.token = token || ''
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
      else localStorage.removeItem(AUTH_TOKEN_KEY)
    }
  }
  if (user !== undefined) {
    authState.user = user || null
    if (typeof localStorage !== 'undefined') {
      if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
      else localStorage.removeItem(AUTH_USER_KEY)
    }
  }
  if (permissions !== undefined) {
    authState.permissions = Array.isArray(permissions) ? permissions.filter(Boolean) : []
    authState.permissionsLoaded = true
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTH_PERMISSIONS_KEY, JSON.stringify(authState.permissions))
    }
  }
  authState.sessionExpired = false
  authState.initialized = true
}

export const clearAuthSession = () => {
  authState.token = ''
  authState.user = null
  authState.permissions = []
  authState.permissionsLoaded = true
  authState.initialized = true
  authState.sessionExpired = false
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    localStorage.removeItem(AUTH_PERMISSIONS_KEY)
  }
}

// Keep an already-open tab in sync when another tab logs in or out. The
// permission flag stays false until the corresponding permission payload has
// arrived, so a transient token/user update cannot expose an operable screen.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_TOKEN_KEY) {
      authState.token = event.newValue || ''
      authState.initialized = false
      authState.permissionsLoaded = false
      if (!authState.token) {
        authState.user = null
        authState.permissions = []
        authState.permissionsLoaded = true
        authState.initialized = true
      }
      return
    }
    if (event.key === AUTH_USER_KEY) {
      try {
        authState.user = event.newValue ? JSON.parse(event.newValue) : null
      } catch {
        authState.user = null
      }
      if (!authState.user) {
        authState.permissions = []
        authState.permissionsLoaded = true
        authState.initialized = Boolean(!authState.token)
      }
      return
    }
    if (event.key === AUTH_PERMISSIONS_KEY) {
      try {
        const value = event.newValue ? JSON.parse(event.newValue) : []
        authState.permissions = Array.isArray(value) ? value.filter(Boolean) : []
      } catch {
        authState.permissions = []
      }
      authState.permissionsLoaded = true
      authState.initialized = true
    }
  })
}

export const hasPermission = (permission) => {
  if (!permission) return true
  if (!authState.initialized) return true
  if (!authState.permissionsLoaded) return false
  if (authState.user?.is_superuser || authState.user?.isSuperuser) return true
  return authState.permissions.includes('*') || authState.permissions.includes(permission)
}
