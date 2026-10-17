<script setup>
import { computed, onMounted, ref } from 'vue'
import { createSupplier, deleteSupplier as apiDeleteSupplier, getSuppliers, updateSupplier } from '../api/suppliers'

const suppliers = ref([])
const search = ref('')
const loading = ref(false)
const saving = ref(false)
const editingId = ref(null)
const form = ref({ name: '', contact: '', phone: '', address: '' })

const filteredSuppliers = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return suppliers.value
  return suppliers.value.filter(item => [item.name, item.contact, item.phone, item.address]
    .some(value => String(value || '').toLowerCase().includes(query)))
})

const loadSuppliers = async () => {
  loading.value = true
  try {
    const result = await getSuppliers()
    suppliers.value = result?.data || []
  } catch (error) {
    window.$toast?.(error?.error || '获取供应商失败', 'error')
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  editingId.value = null
  form.value = { name: '', contact: '', phone: '', address: '' }
}

const editSupplier = (supplier) => {
  editingId.value = supplier.id
  form.value = {
    name: supplier.name || '',
    contact: supplier.contact || '',
    phone: supplier.phone || '',
    address: supplier.address || ''
  }
}

const saveSupplier = async () => {
  if (!form.value.name.trim()) {
    window.$toast?.('请输入供应商名称', 'warning')
    return
  }
  saving.value = true
  try {
    if (editingId.value) await updateSupplier(editingId.value, form.value)
    else await createSupplier(form.value)
    window.$toast?.(editingId.value ? '供应商已更新' : '供应商已添加', 'success')
    resetForm()
    await loadSuppliers()
  } catch (error) {
    window.$toast?.(error?.error || '保存供应商失败', 'error')
  } finally {
    saving.value = false
  }
}

const removeSupplier = async (supplier) => {
  if (!window.confirm(`确定删除供应商“${supplier.name}”吗？`)) return
  try {
    await apiDeleteSupplier(supplier.id)
    window.$toast?.('供应商已删除', 'success')
    await loadSuppliers()
  } catch (error) {
    window.$toast?.(error?.error || '删除失败，请先解除商品关联', 'error')
  }
}

onMounted(loadSuppliers)
</script>

<template>
  <div class="supplier-page">
    <div class="header-bar">
      <div>
        <h2 class="page-title">供应商管理</h2>
        <p class="subtitle">集中维护供应商资料，并在商品表单中快速筛选关联</p>
      </div>
      <span class="supplier-count">{{ suppliers.length }} 家供应商</span>
    </div>

    <div class="supplier-layout">
      <section class="supplier-form-card">
        <div class="card-header"><h3 class="card-title">{{ editingId ? '编辑供应商' : '新增供应商' }}</h3></div>
        <form class="supplier-form" @submit.prevent="saveSupplier">
          <label>供应商名称 <span class="required">*</span><input v-model="form.name" class="form-input" required /></label>
          <label>联系人<input v-model="form.contact" class="form-input" /></label>
          <label>联系电话<input v-model="form.phone" class="form-input" /></label>
          <label>地址<input v-model="form.address" class="form-input" /></label>
          <div class="form-actions">
            <button v-if="editingId" type="button" class="btn btn-secondary" @click="resetForm">取消编辑</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? '保存中…' : (editingId ? '保存修改' : '添加供应商') }}</button>
          </div>
        </form>
      </section>

      <section class="supplier-list-card">
        <div class="card-header supplier-list-header">
          <h3 class="card-title">供应商列表</h3>
          <input v-model="search" class="form-input supplier-search" placeholder="搜索名称、联系人或电话" />
        </div>
        <div class="table-container" :class="{ loading }">
          <table class="data-table">
            <thead><tr><th>供应商名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="supplier in filteredSuppliers" :key="supplier.id">
                <td><strong>{{ supplier.name }}</strong></td><td>{{ supplier.contact || '-' }}</td><td>{{ supplier.phone || '-' }}</td><td>{{ supplier.address || '-' }}</td>
                <td><div class="supplier-actions"><button class="btn btn-action" @click="editSupplier(supplier)">编辑</button><button class="btn btn-action text-danger" @click="removeSupplier(supplier)">删除</button></div></td>
              </tr>
              <tr v-if="!filteredSuppliers.length"><td colspan="5"><div class="empty-state"><p>{{ search ? '没有匹配的供应商' : '暂无供应商，请先添加' }}</p></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.supplier-page { padding: 28px 32px; max-width: 1440px; margin: 0 auto; }
.supplier-count { color: #64748b; font-size: 14px; }
.supplier-layout { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 20px; align-items: start; }
.supplier-form-card, .supplier-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 3px 12px rgba(15, 23, 42, .05); overflow: hidden; }
.supplier-form { display: grid; gap: 16px; padding: 20px; }
.supplier-form label { display: grid; gap: 6px; font-size: 13px; color: #475569; font-weight: 600; }
.supplier-form .form-input { width: 100%; box-sizing: border-box; }
.supplier-list-header { gap: 16px; align-items: center; }
.supplier-search { max-width: 280px; }
.supplier-actions { display: flex; gap: 8px; }
@media (max-width: 900px) { .supplier-page { padding: 20px 16px; } .supplier-layout { grid-template-columns: 1fr; } .supplier-search { max-width: none; } }
</style>
