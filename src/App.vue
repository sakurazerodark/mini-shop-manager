<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Toast from './components/Toast.vue'
import { getBasicSettings } from './api/settings'
import { globalStoreName as storeName } from './store'

const route = useRoute()
const router = useRouter()

const isSidebarCollapsed = ref(false)

const fetchStoreName = async () => {
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

onMounted(() => {
  fetchStoreName()
})
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
  return storeName.value
})

const setView = (path) => {
  router.push(path)
  isMobileNavOpen.value = false
}
</script>

<template>
  <div class="app-layout" :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'mobile-nav-open': isMobileNavOpen }">
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
        <a 
          href="#" 
          :class="['nav-item', { active: route.path === '/' }]" 
          @click.prevent="setView('/')"
          :title="isSidebarCollapsed ? '收银台' : ''"
        >
          <span class="nav-icon">🛒</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">收银台</span>
        </a>
        <a 
          href="#" 
          :class="['nav-item', { active: route.path === '/inventory' }]" 
          @click.prevent="setView('/inventory')"
          :title="isSidebarCollapsed ? '商品与库存' : ''"
        >
          <span class="nav-icon">📦</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">商品与库存</span>
        </a>
        <a 
          href="#" 
          :class="['nav-item', { active: route.path === '/stock-logs' }]" 
          @click.prevent="setView('/stock-logs')"
          :title="isSidebarCollapsed ? '库存变动报表' : ''"
        >
          <span class="nav-icon">📈</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">库存变动</span>
        </a>
        <div class="nav-item-group" :class="{ 'is-expanded': expandReport && !isSidebarCollapsed }">
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
        <a 
          href="#" 
          :class="['nav-item', { active: route.path === '/settings' }]" 
          @click.prevent="setView('/settings')"
          :title="isSidebarCollapsed ? '系统设置' : ''"
        >
          <span class="nav-icon">⚙️</span>
          <span class="nav-text" v-show="!isSidebarCollapsed">系统设置</span>
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
            <div class="name">店长 (Admin)</div>
            <div class="status">● 在线</div>
          </div>
        </div>
        <div class="user-profile collapsed" v-show="isSidebarCollapsed">
          <div class="avatar" title="店长 (Admin)">👨‍💼</div>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <router-view></router-view>
    </main>

    <div class="mobile-tabbar" role="navigation" aria-label="底部导航">
      <button class="tab-item" :class="{ active: route.path === '/' }" @click="setView('/')">
        <span class="tab-icon">🛒</span>
        <span class="tab-text">收银</span>
      </button>
      <button class="tab-item" :class="{ active: route.path === '/inventory' }" @click="setView('/inventory')">
        <span class="tab-icon">📦</span>
        <span class="tab-text">库存</span>
      </button>
      <button class="tab-item" :class="{ active: route.path === '/report' }" @click="setView('/report?tab=dashboard')">
        <span class="tab-icon">📊</span>
        <span class="tab-text">报表</span>
      </button>
    </div>

    <!-- 全局提示组件 -->
    <Toast />
  </div>
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
