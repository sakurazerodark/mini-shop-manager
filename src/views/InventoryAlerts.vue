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
.alert-page { padding: 28px 32px; max-width: 1440px; margin: 0 auto; }
.alert-summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; padding: 20px 24px; border: 1px solid #fed7aa; border-radius: 8px; background: #fff7ed; color: #9a3412; }
.alert-summary > div { display: flex; gap: 8px; align-items: baseline; }.summary-label { font-weight: 600; }.alert-summary strong { font-size: 28px; }.alert-summary .form-input { max-width: 300px; background: #fff; }.alert-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }.muted { color: #94a3b8; font-size: 12px; margin-top: 3px; }.danger-text { color: #dc2626; font-weight: 600; }.alert-badge { color: #b91c1c; background: #fee2e2; padding: 4px 8px; border-radius: 999px; font-size: 12px; }
@media (max-width: 700px) { .alert-page { padding: 20px 16px; }.alert-summary { align-items: stretch; flex-direction: column; }.alert-summary .form-input { max-width: none; } }
</style>
