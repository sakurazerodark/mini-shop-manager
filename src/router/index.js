import { createRouter, createWebHistory } from 'vue-router'
import PosTerminal from '../views/PosTerminal.vue'
import InventoryManager from '../views/InventoryManager.vue'
import SalesReport from '../views/SalesReport.vue'
import SettingsPage from '../views/SettingsPage.vue'

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
    component: SettingsPage
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
