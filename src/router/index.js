import { createRouter, createWebHistory } from 'vue-router'
import PosTerminal from '../views/PosTerminal.vue'
import InventoryManager from '../views/InventoryManager.vue'
import SalesReport from '../views/SalesReport.vue'
import SettingsPage from '../views/SettingsPage.vue'
import StockLogsReport from '../views/StockLogsReport.vue'
import AccessControl from '../views/AccessControl.vue'
import SuppliersManagement from '../views/SuppliersManagement.vue'
import InventoryAlerts from '../views/InventoryAlerts.vue'
import { authState, hasPermission } from '../store'

const routes = [
  {
    path: '/',
    name: 'PosTerminal',
    component: PosTerminal,
    meta: { permission: 'payment.create' }
  },
  {
    path: '/inventory',
    name: 'InventoryManager',
    component: InventoryManager,
    meta: { permission: 'order.manage' }
  },
  {
    path: '/inventory-alerts',
    name: 'InventoryAlerts',
    component: InventoryAlerts,
    meta: { permission: 'order.view' }
  },
  {
    path: '/suppliers',
    name: 'SuppliersManagement',
    component: SuppliersManagement,
    meta: { permission: 'order.manage' }
  },
  {
    path: '/report',
    name: 'SalesReport',
    component: SalesReport,
    meta: { permission: 'report.view' }
  },
  {
    path: '/settings',
    name: 'SettingsPage',
    component: SettingsPage,
    meta: { permission: 'payment.config.view' }
  },
  {
    path: '/stock-logs',
    name: 'StockLogsReport',
    component: StockLogsReport,
    meta: { permission: 'order.view' }
  },
  {
    path: '/access-control',
    name: 'AccessControl',
    component: AccessControl,
    meta: { permissions: ['account.view', 'role.view'] }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const required = to.meta?.permission
  const anyOf = Array.isArray(to.meta?.permissions) ? to.meta.permissions : []
  if ((!required && !anyOf.length) || !authState.token) return true
  // App.vue holds the view until the session and permissions have been
  // hydrated. Allow the pending navigation through so the completed request
  // can re-evaluate it without briefly exposing an unauthorized screen.
  if (!authState.initialized || !authState.permissionsLoaded) return true
  if ((required && hasPermission(required)) || (anyOf.length && anyOf.some(hasPermission))) return true
  // Keep the default route as an intentional blank workspace when the account
  // cannot use the cash register. Other authorized routes remain available.
  if (to.path === '/' && required === 'payment.create') return false
  const fallback = routes.find((route) => {
    const permission = route.meta?.permission
    const permissions = Array.isArray(route.meta?.permissions) ? route.meta.permissions : []
    return permission ? hasPermission(permission) : permissions.some(hasPermission)
  })
  return fallback ? { path: fallback.path, replace: true } : false
})

export default router
