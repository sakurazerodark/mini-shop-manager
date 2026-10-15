import { createRouter, createWebHistory } from 'vue-router'
import PosTerminal from '../views/PosTerminal.vue'
import InventoryManager from '../views/InventoryManager.vue'
import SalesReport from '../views/SalesReport.vue'
import SettingsPage from '../views/SettingsPage.vue'
import StockLogsReport from '../views/StockLogsReport.vue'
import AccessControl from '../views/AccessControl.vue'
import { authState, hasPermission } from '../store'

const routes = [
  {
    path: '/',
    name: 'PosTerminal',
    component: PosTerminal
  },
  {
    path: '/inventory',
    name: 'InventoryManager',
    component: InventoryManager
  },
  {
    path: '/report',
    name: 'SalesReport',
    component: SalesReport
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
    component: StockLogsReport
  },
  {
    path: '/access-control',
    name: 'AccessControl',
    component: AccessControl,
    meta: { permission: 'account.view' }
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
  if ((required && hasPermission(required)) || (anyOf.length && anyOf.some(hasPermission))) return true
  return { path: '/', replace: true }
})

export default router
