<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Toast from './components/Toast.vue'
import { getBasicSettings } from './api/settings'
import { login, getCurrentUser, logout, getAuthStatus, bootstrapSuperAdmin } from './api/auth'
import { authState, clearAuthSession, globalStoreName as storeName, hasPermission } from './store'

const route = useRoute()
const router = useRouter()

const isSidebarCollapsed = ref(false)
const loginForm = ref({ username: '', password: '' })
const loginError = ref('')
const setupForm = ref({ username: '', display_name: '', password: '', confirm_password: '' })
const setupError = ref('')
const authMode = ref('login')
const authReady = ref(false)
const setupSubmitting = ref(false)

const fetchStoreName = async () => {
  if (!authState.token) return
  try {
    const res = await getBasicSettings().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      if (json?.data?.store_name) {
        storeName.value = json.data.store_name
      }
    }
  } catch (e) {
    console.error('获取门店名称失败', e)
  }
}

const readAuthStatus = (status) => {
  const value = status?.data ?? status ?? {}
  const hasSuperAdmin = value.hasSuperAdmin ?? value.has_super_admin ?? value.superAdminExists ?? value.super_admin_exists
  const needsSetup = value.needsBootstrap ?? value.needs_bootstrap ?? value.setupRequired ?? value.setup_required
  if (needsSetup !== undefined) return Boolean(needsSetup)
  if (hasSuperAdmin !== undefined) return !Boolean(hasSuperAdmin)
  if (value.initialized !== undefined) return !Boolean(value.initialized)
  return false
}

const initializeAuth = async () => {
  authReady.value = false
  try {
    const status = await getAuthStatus()
    if (!authState.token) {
      authMode.value = readAuthStatus(status) ? 'setup' : 'login'
      authState.initialized = true
      return
    }

    try {
      await getCurrentUser()
      authState.initialized = true
      await fetchStoreName()
    } catch {
      clearAuthSession()
      authMode.value = readAuthStatus(status) ? 'setup' : 'login'
    }
  } catch (error) {
    // A status failure should not block the local login screen. The login or
    // setup request will show the server's actionable error if unavailable.
    authState.initialized = true
    authMode.value = authState.token ? 'login' : 'login'
    console.error('获取认证状态失败', error)
  } finally {
    authReady.value = true
  }
}

onMounted(() => {
  initializeAuth()
  fetchStoreName()
  window.addEventListener('auth:error', handleAuthError)
})
onUnmounted(() => window.removeEventListener('auth:error', handleAuthError))

const handleAuthError = (event) => {
  const status = event?.detail?.status
  if (status === 401) {
    clearAuthSession()
    authState.sessionExpired = true
    authMode.value = 'login'
    loginError.value = '登录状态已失效，请重新登录'
  } else if (status === 403) {
    window.$toast?.('当前账号没有执行此操作的权限', 'error')
  }
}

const submitLogin = async () => {
  loginError.value = ''
  try {
    await login(loginForm.value)
    await fetchStoreName()
    window.$toast?.('登录成功', 'success')
  } catch (error) {
    loginError.value = error?.error || error?.message || '登录失败，请检查账号和密码'
  }
}

const submitBootstrap = async () => {
  setupError.value = ''
  const form = setupForm.value
  if (!form.username.trim() || !form.password) {
    setupError.value = '请填写超级管理员账号和密码'
    return
  }
  if (form.password.length < 6) {
    setupError.value = '密码至少需要6个字符'
    return
  }
  if (form.password !== form.confirm_password) {
    setupError.value = '两次输入的密码不一致'
    return
  }

  setupSubmitting.value = true
  try {
    const payload = await bootstrapSuperAdmin({
      username: form.username.trim(),
      display_name: form.display_name.trim() || form.username.trim(),
      password: form.password
    })
    // Bootstrap can return a session for immediate access. Older servers may
    // only return the created user, in which case perform a normal login.
    if (!authState.token) await login({ username: form.username.trim(), password: form.password })
    await fetchStoreName()
    authMode.value = 'login'
    window.$toast?.('超级管理员已设置', 'success')
  } catch (error) {
    setupError.value = error?.error || error?.message || '初始化失败，请稍后重试'
  } finally {
    setupSubmitting.value = false
  }
}

const handleLogout = async () => {
  await logout()
  authMode.value = 'login'
  loginForm.value = { username: '', password: '' }
  window.$toast?.('已退出登录', 'success')
}
const isMobileNavOpen = ref(false)
const expandReport = ref(false)

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}

const toggleReportMenu = () => {
  if (isSidebarCollapsed.value) {
    isSidebarCollapsed.value = false
  }
  expandReport.value = !expandReport.value
}

const currentTitle = computed(() => {
  if (route.path === '/') return '收银台'
  if (route.path === '/inventory') return '商品与库存'
  if (route.path === '/report') return '销售报表'
  if (route.path === '/settings') return '系统设置'
  if (route.path === '/access-control') return '用户与权限'
  return storeName.value
})

const canSeeAccessControl = computed(() => hasPermission('account.view') || hasPermission('role.view'))
const canUsePos = computed(() => hasPermission('payment.create'))
const canManageInventory = computed(() => hasPermission('order.manage'))
const canViewReports = computed(() => hasPermission('report.view'))
const canViewSettings = computed(() => hasPermission('payment.config.view'))
const displayUserName = computed(() => authState.user?.display_name || authState.user?.name || authState.user?.username || '未登录')
const displayRoleName = computed(() => authState.user?.role?.name || authState.user?.role_name || (authState.user ? '已登录' : '访客'))

const setView = (path) => {
  router.push(path)
  isMobileNavOpen.value = false
}
</script>

<template>
  <div v-if="authReady && authState.token && authState.user" class="app-layout" :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'mobile-nav-open': isMobileNavOpen }">
    <div class="mobile-topbar">
      <button class="mobile-menu-btn" @click="isMobileNavOpen = true" aria-label="打开菜单">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="4" y1="6" x2="20" y2="6"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        </svg>
      </button>
      <div class="mobile-title">{{ currentTitle }}</div>
      <div class="mobile-spacer"></div>
    </div>

    <div class="mobile-overlay" @click="isMobileNavOpen = false" aria-hidden="true"></div>

    <!-- 侧边导航栏 -->
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-icon">🏪</span>
        <span class="logo-text" v-show="!isSidebarCollapsed">{{ storeName }}</span>
      </div>
      <nav class="nav-menu">
        <a v-if="canUsePos"
          href="#" 
          :class="['nav-item', { active: route.path === '/' }]" 
          @click.prevent="setView('/')"
          :title="isSidebarCollapsed ? '收银台' : ''"
        >
          <span class="nav-icon">🛒</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">收银台</span>
        </a>
        <a v-if="canManageInventory"
          href="#" 
          :class="['nav-item', { active: route.path === '/inventory' }]" 
          @click.prevent="setView('/inventory')"
          :title="isSidebarCollapsed ? '商品与库存' : ''"
        >
          <span class="nav-icon">📦</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">商品与库存</span>
        </a>
        <a v-if="hasPermission('order.view')"
          href="#" 
          :class="['nav-item', { active: route.path === '/stock-logs' }]" 
          @click.prevent="setView('/stock-logs')"
          :title="isSidebarCollapsed ? '库存变动报表' : ''"
        >
          <span class="nav-icon">📈</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">库存变动</span>
        </a>
        <div v-if="canViewReports" class="nav-item-group" :class="{ 'is-expanded': expandReport && !isSidebarCollapsed }">
          <a 
            href="#" 
            :class="['nav-item', { active: route.path === '/report' }]" 
            @click.prevent="toggleReportMenu"
            :title="isSidebarCollapsed ? '销售报表' : ''"
          >
            <span class="nav-icon">📊</span>
            <span class="nav-text" v-show="!isSidebarCollapsed">销售报表</span>
            <span class="nav-arrow" v-show="!isSidebarCollapsed">▼</span>
          </a>
          <div class="sub-nav-menu" v-show="expandReport && !isSidebarCollapsed">
            <a href="#" :class="['sub-nav-item', { active: route.query.tab === 'dashboard' || !route.query.tab }]" @click.prevent="setView('/report?tab=dashboard')">
              <span class="sub-nav-text">营业大盘</span>
            </a>
            <a href="#" :class="['sub-nav-item', { active: route.query.tab === 'orders' }]" @click.prevent="setView('/report?tab=orders')">
              <span class="sub-nav-text">订单明细</span>
            </a>
            <a href="#" :class="['sub-nav-item', { active: route.query.tab === 'payments' }]" @click.prevent="setView('/report?tab=payments')">
              <span class="sub-nav-text">支付记录</span>
            </a>
            <a href="#" :class="['sub-nav-item', { active: route.query.tab === 'abnormal' }]" @click.prevent="setView('/report?tab=abnormal')">
              <span class="sub-nav-text">异常订单</span>
            </a>
          </div>
        </div>
        <div class="nav-divider"></div>
        <a v-if="canViewSettings"
          href="#" 
          :class="['nav-item', { active: route.path === '/settings' }]" 
          @click.prevent="setView('/settings')"
          :title="isSidebarCollapsed ? '系统设置' : ''"
        >
          <span class="nav-icon">⚙️</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">系统设置</span>
        </a>
        <a
          v-if="canSeeAccessControl"
          href="#"
          :class="['nav-item', { active: route.path === '/access-control' }]"
          @click.prevent="setView('/access-control')"
          :title="isSidebarCollapsed ? '用户与权限' : ''"
        >
          <span class="nav-icon">👥</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">用户与权限</span>
        </a>
      </nav>
      
      <div class="sidebar-footer">
        <button class="toggle-btn" @click="toggleSidebar" :title="isSidebarCollapsed ? '展开菜单' : '收起菜单'">
          <svg v-if="!isSidebarCollapsed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        
        <div class="user-profile" v-show="!isSidebarCollapsed">
          <div class="avatar">👨‍💼</div>
          <div class="info">
            <div class="name">{{ displayUserName }}</div>
            <div class="status">● {{ displayRoleName }}</div>
          </div>
          <div class="profile-actions">
            <button class="profile-btn" @click="handleLogout">退出</button>
          </div>
        </div>
        <div class="user-profile collapsed" v-show="isSidebarCollapsed">
          <div class="avatar" :title="displayUserName">👨‍💼</div>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <router-view></router-view>
    </main>

    <div class="mobile-tabbar" role="navigation" aria-label="底部导航">
      <button v-if="canUsePos" class="tab-item" :class="{ active: route.path === '/' }" @click="setView('/')">
        <span class="tab-icon">🛒</span>
        <span class="tab-text">收银</span>
      </button>
      <button v-if="canManageInventory" class="tab-item" :class="{ active: route.path === '/inventory' }" @click="setView('/inventory')">
        <span class="tab-icon">📦</span>
        <span class="tab-text">库存</span>
      </button>
      <button v-if="canViewReports" class="tab-item" :class="{ active: route.path === '/report' }" @click="setView('/report?tab=dashboard')">
        <span class="tab-icon">📊</span>
        <span class="tab-text">报表</span>
      </button>
    </div>

  </div>

  <main v-else-if="authReady" class="auth-screen">
    <section class="auth-panel">
      <div class="auth-brand"><span class="auth-brand-mark">M</span><span>MiniShop</span></div>
      <template v-if="authMode === 'setup'">
        <div class="auth-heading">
          <p class="auth-eyebrow">首次使用</p>
          <h1>设置超级管理员</h1>
          <p>请创建唯一的超级管理员账号，之后其他账号由超级管理员统一维护。</p>
        </div>
        <form class="auth-form" @submit.prevent="submitBootstrap">
          <p v-if="setupError" class="login-error">{{ setupError }}</p>
          <label>管理员账号<input v-model="setupForm.username" class="form-input" autocomplete="username" required autofocus /></label>
          <label>显示名称<span class="optional-label">（可选）</span><input v-model="setupForm.display_name" class="form-input" autocomplete="name" /></label>
          <label>密码<input v-model="setupForm.password" class="form-input" type="password" autocomplete="new-password" minlength="6" required /></label>
          <label>确认密码<input v-model="setupForm.confirm_password" class="form-input" type="password" autocomplete="new-password" minlength="6" required /></label>
          <button class="btn btn-primary login-submit" :disabled="setupSubmitting">{{ setupSubmitting ? '设置中…' : '完成设置' }}</button>
        </form>
      </template>
      <template v-else>
        <div class="auth-heading">
          <p class="auth-eyebrow">门店管理后台</p>
          <h1>欢迎回来</h1>
          <p>登录后继续管理商品、订单和门店设置。</p>
        </div>
        <form class="auth-form" @submit.prevent="submitLogin">
          <p v-if="loginError" class="login-error">{{ loginError }}</p>
          <label>账号<input v-model="loginForm.username" class="form-input" autocomplete="username" required autofocus /></label>
          <label>密码<input v-model="loginForm.password" class="form-input" type="password" autocomplete="current-password" required /></label>
          <button class="btn btn-primary login-submit" :disabled="authState.loading">{{ authState.loading ? '登录中…' : '登录' }}</button>
        </form>
      </template>
      <p class="auth-footer">账号由超级管理员管理</p>
    </section>
  </main>
  <main v-else class="auth-screen auth-loading" aria-busy="true">
    <div class="auth-loading-mark">M</div>
    <p>正在检查系统状态…</p>
  </main>
  <Toast />
</template>

<style>
/* 全局现代 SaaS 设计系统变量 */
:root {
  --primary: #4f46e5;
  --primary-hover: #4338ca;
  --primary-light: #e0e7ff;
  --success: #10b981;
  --success-bg: #d1fae5;
  --danger: #ef4444;
  --danger-bg: #fee2e2;
  --warning: #f59e0b;
  --warning-bg: #fef3c7;
  
  --bg-color: #f8fafc;
  --surface: #ffffff;
  --text-main: #0f172a;
  --text-muted: #64748b;
  --border-color: #e2e8f0;
  
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;
  
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
  
  --sidebar-bg: #0f172a;
  --sidebar-hover: #1e293b;
  --sidebar-active: #334155;
  --sidebar-text: #94a3b8;
  --sidebar-text-active: #f8fafc;
}

/* 全局重置 */
body, html {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-main);
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* 布局 */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  width: 240px;
  background-color: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 8px rgba(0,0,0,0.15);
  z-index: 10;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-collapsed .sidebar {
  width: 80px;
}

.logo {
  height: 72px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-collapsed .logo {
  padding: 0;
  justify-content: center;
}

.logo-icon {
  margin-right: 12px;
  font-size: 24px;
}

.sidebar-collapsed .logo-icon {
  margin-right: 0;
}

.nav-menu {
  flex: 1;
  padding: 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: hidden;
}

.sidebar-collapsed .nav-menu {
  padding: 24px 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: var(--sidebar-text);
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
  white-space: nowrap;
}

.sidebar-collapsed .nav-item {
  padding: 12px;
  justify-content: center;
}

.nav-icon {
  margin-right: 12px;
  font-size: 18px;
  opacity: 0.8;
  transition: transform 0.2s;
  min-width: 20px;
  text-align: center;
}

.sidebar-collapsed .nav-icon {
  margin-right: 0;
  font-size: 20px;
}

.nav-item:hover:not(.disabled) {
  color: var(--sidebar-text-active);
  background-color: var(--sidebar-hover);
}
.nav-item:hover:not(.disabled) .nav-icon {
  transform: scale(1.1);
  opacity: 1;
}

.nav-item.active {
  color: #fff;
  background-color: var(--primary);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}
.nav-item.active .nav-icon {
  opacity: 1;
}

.nav-arrow {
  margin-left: auto;
  font-size: 10px;
  color: #9ca3af;
  transition: transform 0.2s;
}
.nav-item-group.is-expanded .nav-arrow {
  transform: rotate(180deg);
}

.sub-nav-menu {
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  padding: 4px 0;
  border-radius: 0 0 8px 8px;
}

.sub-nav-item {
  display: flex;
  align-items: center;
  padding: 10px 16px 10px 48px;
  color: #64748b;
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
}

.sub-nav-item:hover {
  color: var(--primary);
  background: #f1f5f9;
}

.sub-nav-item.active {
  color: var(--primary);
  font-weight: 500;
  background: #eff6ff;
}

.nav-divider {
  height: 1px;
  background-color: rgba(255,255,255,0.05);
  margin: 12px 0;
}

.nav-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(255,255,255,0.05);
}

.toggle-btn {
  background: transparent;
  border: none;
  color: var(--sidebar-text);
  padding: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  border-bottom: 1px solid rgba(255,255,255,0.02);
}

.toggle-btn:hover {
  color: #fff;
  background-color: rgba(255,255,255,0.05);
}

.user-profile {
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}

.user-profile.collapsed {
  padding: 20px 0;
  justify-content: center;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: var(--sidebar-active);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.info .name {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}
.info .status {
  font-size: 12px;
  color: var(--success);
  margin-top: 4px;
}

.profile-actions {
  margin-left: auto;
}

.profile-btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  background: transparent;
  color: var(--sidebar-text);
  padding: 4px 7px;
  font-size: 11px;
  cursor: pointer;
}

.profile-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.5);
}

.login-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.48);
}

.login-modal {
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 26px;
  background: var(--surface);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.login-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.login-head h2 {
  margin: 0;
  font-size: 20px;
}

.login-eyebrow {
  margin: 0 0 5px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-close {
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 24px;
  cursor: pointer;
  line-height: 1;
}

.login-modal label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
}

.login-error {
  margin: 0;
  padding: 9px 11px;
  color: #991b1b;
  background: var(--danger-bg);
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
}

.login-submit {
  width: 100%;
  margin-top: 3px;
}

/* 认证首屏 */
.auth-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px 18px;
  background: #eef2ff;
}

.auth-panel {
  width: min(460px, 100%);
  padding: 34px;
  background: var(--surface);
  border: 1px solid #dbe4ff;
  border-radius: 12px;
  box-shadow: 0 18px 55px rgba(30, 41, 59, 0.14);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-main);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0;
}

.auth-brand-mark,
.auth-loading-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  color: #fff;
  background: var(--primary);
  font-weight: 900;
}

.auth-heading { margin: 34px 0 22px; }
.auth-heading h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: 0; }
.auth-heading p:last-child { color: var(--text-muted); font-size: 13px; line-height: 1.6; }
.auth-eyebrow { margin: 0 0 8px; color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.auth-form { display: flex; flex-direction: column; gap: 14px; }
.auth-form label { display: flex; flex-direction: column; gap: 7px; color: var(--text-main); font-size: 13px; font-weight: 700; }
.optional-label { color: var(--text-muted); font-size: 11px; font-weight: 600; }
.auth-footer { margin: 22px 0 0; color: var(--text-muted); font-size: 12px; text-align: center; }
.auth-loading { color: var(--text-muted); gap: 12px; }
.auth-loading-mark { width: 44px; height: 44px; }
.auth-loading p { margin: 0; font-size: 13px; }

/* 主内容区 */
.main-content {
  flex: 1;
  overflow-y: auto;
  background-color: var(--bg-color);
  position: relative;
}

/* 全局按钮基础样式（为了统一组件内的按钮） */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
}
.btn:focus-visible {
  box-shadow: 0 0 0 2px var(--primary-light);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-sm);
}
.btn-primary:hover:not(:disabled) {
  background-color: var(--primary-hover);
  transform: translateY(-1px);
}

.mobile-topbar,
.mobile-tabbar,
.mobile-overlay {
  display: none;
}

@media (max-width: 900px) {
  .mobile-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    padding: 0 14px;
    background: rgba(248, 250, 252, 0.92);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(226, 232, 240, 0.7);
    z-index: 50;
  }

  .mobile-menu-btn {
    border: 1px solid rgba(226, 232, 240, 0.8);
    background: rgba(255, 255, 255, 0.7);
    width: 44px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-main);
  }

  .mobile-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: var(--text-main);
  }

  .mobile-spacer {
    width: 44px;
  }

  .mobile-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.4);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
    z-index: 40;
  }

  .mobile-nav-open .mobile-overlay {
    opacity: 1;
    pointer-events: auto;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 280px;
    transform: translateX(-110%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 60;
  }

  .mobile-nav-open .sidebar {
    transform: translateX(0);
  }

  .sidebar-collapsed .sidebar {
    width: 280px;
  }

  .sidebar-collapsed .logo,
  .sidebar-collapsed .nav-item {
    justify-content: flex-start;
    padding-left: 20px;
    padding-right: 20px;
  }

  .sidebar-collapsed .logo-icon,
  .sidebar-collapsed .nav-icon {
    margin-right: 12px;
    font-size: 18px;
  }

  .sidebar-collapsed .logo-text,
  .sidebar-collapsed .nav-text,
  .sidebar-collapsed .user-profile {
    display: block !important;
  }

  .toggle-btn {
    display: none;
  }

  .main-content {
    padding-top: 56px;
    padding-bottom: calc(74px + env(safe-area-inset-bottom));
  }

  .mobile-tabbar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(64px + env(safe-area-inset-bottom));
    padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
    background: rgba(248, 250, 252, 0.92);
    backdrop-filter: blur(10px);
    border-top: 1px solid rgba(226, 232, 240, 0.7);
    z-index: 50;
  }

  .tab-item {
    background: transparent;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--text-muted);
    font-weight: 600;
    border-radius: 14px;
    padding: 8px 0;
  }

  .tab-item.active {
    color: var(--primary);
    background: rgba(224, 231, 255, 0.7);
  }

  .tab-icon {
    font-size: 18px;
  }

  .tab-text {
    font-size: 11px;
    letter-spacing: 0.2px;
  }
}
</style>
