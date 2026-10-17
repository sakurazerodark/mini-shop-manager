<script setup>
import { computed, onMounted, ref } from 'vue'
import { getProducts } from '../api/products'

const products = ref([])
const loading = ref(false)
const search = ref('')
const allAlertProducts = computed(() => products.value.filter(item => Number(item.stock || 0) <= Number(item.min_stock || 0)))
const alertProducts = computed(() => allAlertProducts.value
  .filter(item => {
    const query = search.value.trim().toLowerCase()
    return !query || String(item.name || '').toLowerCase().includes(query) || String(item.barcode || '').toLowerCase().includes(query)
  }))

const loadAlerts = async () => {
  loading.value = true
  try {
    const result = await getProducts()
    products.value = result?.data || []
  } catch (error) {
    window.$toast?.(error?.error || '获取库存预警失败', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(loadAlerts)
</script>

<template>
  <div class="alert-page">
    <div class="header-bar">
      <div><h2 class="page-title">库存预警</h2><p class="subtitle">库存低于或达到预警阈值的商品会出现在这里</p></div>
      <button class="btn btn-primary" @click="loadAlerts">刷新预警</button>
    </div>
    <section class="alert-summary">
      <div><span class="summary-label">当前预警</span><strong>{{ allAlertProducts.length }}</strong><span>种商品</span></div>
      <input v-model="search" class="form-input" placeholder="搜索商品名称或条码" />
    </section>
    <section class="alert-list-card">
      <div class="table-container" :class="{ loading }">
        <table class="data-table">
          <thead><tr><th>商品</th><th>条码</th><th>当前库存</th><th>预警阈值</th><th>缺口</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="product in alertProducts" :key="product.id">
              <td><strong>{{ product.name }}</strong><div class="muted">{{ product.brand || '未设置品牌' }}</div></td>
              <td>{{ product.barcode || '-' }}</td><td>{{ product.stock }} {{ product.unit }}</td><td>{{ product.min_stock }} {{ product.unit }}</td>
              <td class="danger-text">{{ Math.max(0, Number(product.min_stock || 0) - Number(product.stock || 0)).toFixed(2) }} {{ product.unit }}</td>
              <td><span class="alert-badge">需要补货</span></td>
            </tr>
            <tr v-if="!alertProducts.length"><td colspan="6"><div class="empty-state"><p>{{ search ? '没有匹配的预警商品' : '库存充足，暂无预警' }}</p></div></td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.alert-page { padding: 28px 32px 40px; max-width: 1480px; margin: 0 auto; }
.header-bar { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 20px; }.page-title { margin: 0 0 5px; color: var(--text-main); font-size: 25px; letter-spacing: -.3px; }.subtitle { margin: 0; color: var(--text-muted); font-size: 13px; }
.alert-summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; padding: 18px 22px; border: 1px solid #f4c6b9; border-radius: 8px; background: #fff8f5; color: #9b4535; }
.alert-summary > div { display: flex; gap: 8px; align-items: baseline; }.summary-label { font-weight: 600; }.alert-summary strong { font-size: 28px; }.alert-summary .form-input { max-width: 300px; background: #fff; }.alert-list-card { background: #fff; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-sm); }.table-container { overflow-x: auto; min-height: 320px; }.table-container.loading { opacity: .58; pointer-events: none; }.data-table { width: 100%; border-collapse: collapse; }.data-table th { padding: 11px 20px; background: #f8f9fb; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 12px; font-weight: 700; text-align: left; white-space: nowrap; }.data-table td { padding: 14px 20px; border-bottom: 1px solid #edf0f4; color: var(--text-main); font-size: 13px; white-space: nowrap; }.data-table tbody tr:hover td { background: #fffaf8; }.muted { color: #94a3b8; font-size: 12px; margin-top: 3px; }.danger-text { color: var(--danger); font-weight: 700; }.alert-badge { color: #a74736; background: #fde9e4; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }.empty-state { padding: 60px 20px; color: var(--text-muted); text-align: center; }
.form-input { min-height: 40px; padding: 9px 11px; border: 1px solid var(--border-color); border-radius: 5px; background: #fff; color: var(--text-main); outline: none; }.form-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
@media (max-width: 700px) { .alert-page { padding: 20px 16px; }.alert-summary { align-items: stretch; flex-direction: column; }.alert-summary .form-input { max-width: none; } }
</style>
