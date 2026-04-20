<script setup>
import { ref, onMounted } from 'vue'
import { getAllStockLogs } from '../api/products'
import { formatDateTime } from '../utils/format'

const logs = ref([])
const loading = ref(true)
const page = ref(1)
const limit = ref(20)
const totalPages = ref(1)

const fetchLogs = async (p = 1) => {
  page.value = p
  loading.value = true
  try {
    const res = await getAllStockLogs({ page: p, limit: limit.value }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const data = await res.json()
      logs.value = data.data || []
      totalPages.value = data.meta?.totalPages || 1
    } else {
      const err = await res.json().catch(() => ({}))
      window.$toast('获取数据失败: ' + (err.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('网络错误', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchLogs()
})

const formatChangeType = (type) => {
  const map = { init: '期初建档', restock: '进货入库', sell: '销售扣减', loss: '报损出库', adjust: '盘点校准' }
  return map[type] || type
}

const getTypeColor = (type) => {
  const map = { init: 'bg-primary', restock: 'bg-success', sell: 'bg-warning', loss: 'bg-danger', adjust: 'bg-info' }
  return map[type] || 'bg-secondary'
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">📦 库存变动报表</h1>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="fetchLogs(1)">刷新</button>
      </div>
    </div>

    <div class="card">
      <div class="table-container" :class="{ loading: loading }">
        <table class="data-table">
          <thead>
            <tr>
              <th>变动时间</th>
              <th>商品名称</th>
              <th>条码</th>
              <th>变动类型</th>
              <th>变动数量</th>
              <th>单位成本 / 售价</th>
              <th>操作人/原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td class="time-cell">{{ formatDateTime(log.created_at) }}</td>
              <td>{{ log.product_name || '-' }}</td>
              <td class="text-muted">{{ log.product_barcode || '-' }}</td>
              <td><span class="type-tag" :class="getTypeColor(log.change_type)">{{ formatChangeType(log.change_type) }}</span></td>
              <td>
                <strong :class="log.change_qty > 0 ? 'color-success' : 'color-danger'">
                  {{ log.change_qty > 0 ? '+' : '' }}{{ log.change_qty }} {{ log.product_unit || '' }}
                </strong>
              </td>
              <td class="text-muted">
                <span v-if="log.unit_cost_price != null">成 ¥{{ Number(log.unit_cost_price).toFixed(2) }}</span>
                <span v-if="log.unit_retail_price != null" style="margin-left: 8px;">售 ¥{{ Number(log.unit_retail_price).toFixed(2) }}</span>
              </td>
              <td class="text-muted">{{ log.operator }}</td>
            </tr>
            <tr v-if="logs.length === 0">
              <td colspan="7" class="empty-state">
                <div class="empty-icon">📂</div>
                <p>暂无库存变动记录</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div class="pagination" v-if="totalPages > 1">
        <button class="btn btn-secondary" :disabled="page <= 1" @click="fetchLogs(page - 1)">上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <button class="btn btn-secondary" :disabled="page >= totalPages" @click="fetchLogs(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container { padding: 24px; max-width: 1400px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 24px; font-weight: 600; color: var(--text-main); margin: 0; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); padding: 24px; }
.table-container { overflow-x: auto; min-height: 300px; position: relative; }
.table-container.loading { opacity: 0.6; pointer-events: none; }
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.data-table th { background: var(--bg-color); padding: 12px 16px; text-align: left; font-weight: 600; color: var(--text-main); border-bottom: 2px solid var(--border-color); white-space: nowrap; }
.data-table td { padding: 14px 16px; border-bottom: 1px solid var(--border-color); vertical-align: middle; color: var(--text-main); }
.data-table tr:hover td { background-color: var(--bg-color); }
.time-cell { font-family: monospace; color: var(--text-muted); white-space: nowrap; }
.type-tag { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; color: #fff; }
.bg-primary { background-color: var(--primary); }
.bg-success { background-color: var(--success); }
.bg-warning { background-color: var(--warning); }
.bg-danger { background-color: var(--danger); }
.bg-info { background-color: #00bcd4; }
.bg-secondary { background-color: var(--text-muted); }
.color-success { color: var(--success); }
.color-danger { color: var(--danger); }
.text-muted { color: var(--text-muted); font-size: 14px; }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
.empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); }
.page-info { font-weight: 500; color: var(--text-main); }
</style>