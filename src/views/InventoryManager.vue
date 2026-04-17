<script setup>
import { ref, computed, onMounted } from 'vue'
import { getProducts, getDeletedProducts, getProductByBarcode, lookupBarcode, createProduct, updateProduct, deleteProduct as apiDeleteProduct, restoreProduct, productLoss, productRestock, productAdjust, getProductLogs, updateProductPrices, getProductPriceLogs } from '../api/products'
import { getSuppliers, createSupplier, deleteSupplier as apiDeleteSupplier } from '../api/suppliers'
import { getBarcodeLookup, updateBarcodeLookup, getCostingMode, updateCostingMode } from '../api/settings'

const products = ref([])
const deletedProducts = ref([])
const nameInputRef = ref(null)
const viewMode = ref('list') // 'list' | 'add' | 'deleted'
const costingMode = ref('avg')
const imagePreview = ref('')
const isBarcodeLookupLoading = ref(false)
const showBarcodeConfigModal = ref(false)
const barcodeProvider = ref('tanshuapi')
const tanshuapiKey = ref('')
const tanshuapiKeySet = ref(false)

const newProduct = ref({
  barcode: '',
  name: '',
  brand: '',
  supplier_ids: [],
  category_id: 1,
  cost_price: 0,
  retail_price: 0,
  stock: 10,
  min_stock: 5,
  unit: '件',
  is_weighing: false,
  image_url: '',
  image_base64: '',
  image_mime: '',
  expiry_date: ''
})

const editingProductId = ref(null)

const searchQuery = ref('')
const filteredProducts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return products.value
  return products.value.filter(p => 
    (p.name && p.name.toLowerCase().includes(query)) || 
    (p.barcode && p.barcode.toLowerCase().includes(query))
  )
})

const suppliers = ref([])
const filteredDeletedProducts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return deletedProducts.value
  return deletedProducts.value.filter(p => 
    (p.name && p.name.toLowerCase().includes(query)) || 
    (p.barcode && p.barcode.toLowerCase().includes(query))
  )
})

const getUploadUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (window.location.protocol === 'file:') {
    return `http://localhost:8080${url}`
  }
  return url
}

const fetchSuppliers = async () => {
  try {
    const res = await getSuppliers().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      suppliers.value = json.data || []
    }
  } catch (e) {
    console.error('获取供应商失败', e)
  }
}

// 供应商管理弹窗
const showSupplierModal = ref(false)
const newSupplier = ref({ name: '', contact: '', phone: '', address: '' })

const addSupplier = async () => {
  if (!newSupplier.value.name) return window.$toast('请输入供应商名称', 'warning')
  try {
    const res = await createSupplier(newSupplier.value).then(data => ({ ok: true, text: () => Promise.resolve('{}') })).catch(e => ({ ok: false, text: () => Promise.resolve(JSON.stringify(e)) }))
    if (res.ok) {
      window.$toast('添加供应商成功', 'success')
      newSupplier.value = { name: '', contact: '', phone: '', address: '' }
      fetchSuppliers()
    } else {
      const text = await res.text()
      try {
        const data = JSON.parse(text)
        window.$toast(data.error || '添加失败', 'error')
      } catch {
        window.$toast('添加失败：服务端异常', 'error')
      }
    }
  } catch (e) {
    console.error(e)
    window.$toast('网络错误', 'error')
  }
}

const deleteSupplier = async (id) => {
  const confirmed = await showConfirm('确定删除此供应商吗？')
  if (!confirmed) return
  try {
    const res = await apiDeleteSupplier(id).then(data => ({ ok: true, text: () => Promise.resolve('{}') })).catch(e => ({ ok: false, text: () => Promise.resolve(JSON.stringify(e)) }))
    if (res.ok) {
      window.$toast('删除成功', 'success')
      fetchSuppliers()
    } else {
      const text = await res.text()
      try {
        const data = JSON.parse(text)
        window.$toast(data.error || '删除失败', 'error')
      } catch {
        window.$toast('删除失败：服务端异常', 'error')
      }
    }
  } catch (e) {
    console.error(e)
    window.$toast('网络错误', 'error')
  }
}

const fetchBarcodeLookupSettings = async () => {
  try {
    const res = await getBarcodeLookup().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) return
    const json = await res.json()
    barcodeProvider.value = json?.data?.provider || 'tanshuapi'
    tanshuapiKeySet.value = Boolean(json?.data?.tanshuapi_key_set)
  } catch (e) {
    console.error(e)
  }
}

const saveBarcodeLookupSettings = async () => {
  try {
    const payload = { provider: barcodeProvider.value }
    if (tanshuapiKey.value.trim()) payload.tanshuapi_key = tanshuapiKey.value.trim()
    const res = await updateBarcodeLookup(payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('条码识别配置已保存', 'success')
      showBarcodeConfigModal.value = false
      tanshuapiKey.value = ''
      fetchBarcodeLookupSettings()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('保存失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('保存失败，网络错误', 'error')
  }
}

const fetchCostingMode = async () => {
  try {
    const res = await getCostingMode().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) return
    const json = await res.json()
    costingMode.value = json?.data?.costing_mode || 'avg'
  } catch (e) {
    console.error(e)
  }
}

const setCostingMode = async (mode) => {
  if (mode !== 'avg' && mode !== 'fifo') return
  try {
    const res = await updateCostingMode({ costing_mode: mode }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      costingMode.value = mode
      window.$toast('成本核算模式已切换', 'success')
      fetchProducts()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('切换失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('切换失败，网络错误', 'error')
  }
}

const fetchProducts = async () => {
  try {
    const res = await getProducts().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    const json = await res.json()
    products.value = json.data || []
  } catch (error) {
    console.error('获取商品失败', error)
  }
}

const fetchDeletedProducts = async () => {
  try {
    const res = await getDeletedProducts().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    const json = await res.json()
    deletedProducts.value = json.data || []
  } catch (error) {
    console.error('获取已删除商品失败', error)
  }
}

const handleRestoreProduct = async (id) => {
  try {
    const res = await restoreProduct(id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('商品恢复成功', 'success')
      fetchProducts()
      fetchDeletedProducts()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('恢复失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (error) {
    console.error('恢复商品失败', error)
    window.$toast('恢复失败，网络错误', 'error')
  }
}

const handleBarcodeEnter = () => {
  lookupBarcodeAndFill()
}

const lookupBarcodeAndFill = async () => {
  const code = String(newProduct.value.barcode || '').trim()
  if (!code) return
  isBarcodeLookupLoading.value = true
  try {
    const res = await lookupBarcode(code).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) {
      if (res.status === 404) {
        window.$toast('未识别到条码信息', 'warning')
      } else {
        const err = await res.json().catch(() => ({}))
        window.$toast('识别失败: ' + (err.error || '未知错误'), 'error')
      }
      if (nameInputRef.value) nameInputRef.value.focus()
      return
    }
    const json = await res.json()
    const data = json?.data || {}
    if (!newProduct.value.name && data.name) {
      newProduct.value.name = data.name
    }
    if (!newProduct.value.image_base64 && data.image_url && !imagePreview.value) {
      newProduct.value.image_url = data.image_url
      imagePreview.value = getUploadUrl(data.image_url)
    }
  } catch (e) {
    console.error(e)
  } finally {
    isBarcodeLookupLoading.value = false
    if (nameInputRef.value) nameInputRef.value.focus()
  }
}

const onSelectImage = (e) => {
  const file = e?.target?.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result || '')
    imagePreview.value = result
    newProduct.value.image_base64 = result
    newProduct.value.image_mime = file.type || ''
    newProduct.value.image_url = ''
  }
  reader.readAsDataURL(file)
}

const clearImage = () => {
  imagePreview.value = ''
  newProduct.value.image_base64 = ''
  newProduct.value.image_mime = ''
  newProduct.value.image_url = ''
}

const addProduct = async (continueAdding = false) => {
  if (!newProduct.value.barcode || !newProduct.value.name) {
    window.$toast('条码和商品名不能为空！', 'warning')
    return
  }

  try {
    const isEdit = editingProductId.value !== null
    let res;
    if (isEdit) {
      res = await updateProduct(editingProductId.value, newProduct.value).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    } else {
      res = await createProduct(newProduct.value).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    }
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error("解析 JSON 失败", e);
      window.$toast('服务器返回异常', 'error');
      return;
    }

    if (res.ok) {
        window.$toast(isEdit ? '商品修改成功' : '添加成功', 'success')
        fetchProducts()
        newProduct.value = { barcode: '', name: '', brand: '', supplier_ids: [], category_id: 1, cost_price: 0, retail_price: 0, stock: 10, min_stock: 5, unit: '件', is_weighing: false, image_url: '', image_base64: '', image_mime: '', expiry_date: '' }
        imagePreview.value = ''
        editingProductId.value = null
      
      if (!continueAdding || isEdit) {
        viewMode.value = 'list'
      } else {
        if (nameInputRef.value) {
           nameInputRef.value.focus()
        }
      }
    } else {
      window.$toast((isEdit ? '修改失败: ' : '添加失败: ') + (data.error || '未知错误'), 'error')
    }
  } catch (error) {
    console.error('请求失败', error)
    window.$toast('请求失败，请检查网络连接', 'error')
  }
}

const openEditProduct = (p) => {
  editingProductId.value = p.id
  let sIds = []
  try {
    if (p.supplier_ids) sIds = JSON.parse(p.supplier_ids)
  } catch (e) {
    console.error('Failed to parse supplier_ids', e)
  }

  newProduct.value = {
    barcode: p.barcode || '',
    name: p.name || '',
    brand: p.brand || '',
    supplier_ids: sIds,
    category_id: p.category_id || 1,
    cost_price: p.cost_price || 0,
    retail_price: p.retail_price || 0,
    stock: p.stock || 0,
    min_stock: p.min_stock || 5,
    unit: p.unit || '件',
    is_weighing: p.is_weighing === 1 || p.is_weighing === true,
    image_url: p.image_url || '',
    image_base64: '',
    image_mime: '',
    expiry_date: p.expiry_date || ''
  }
  imagePreview.value = getUploadUrl(p.image_url) || ''
  viewMode.value = 'add'
}

// 确认弹窗组件状态
const confirmDialog = ref({
  show: false,
  message: '',
  onConfirm: null
})

const showConfirm = (message) => {
  return new Promise((resolve) => {
    confirmDialog.value = {
      show: true,
      message,
      onConfirm: () => {
        confirmDialog.value.show = false
        resolve(true)
      },
      onCancel: () => {
        confirmDialog.value.show = false
        resolve(false)
      }
    }
  })
}

const deleteProduct = async (id) => {
  const confirmed = await showConfirm('确定要删除此商品吗？删除后可在"已删除"列表中找回。')
  if (!confirmed) return

  try {
    const res = await apiDeleteProduct(id).then(data => ({ ok: true, text: () => Promise.resolve('{}') })).catch(e => ({ ok: false, text: () => Promise.resolve(JSON.stringify(e)) }))
    if (res.ok) {
      window.$toast('已移至已删除列表', 'success')
      fetchProducts()
      fetchDeletedProducts()
    } else {
      const data = await res.json()
      window.$toast('删除失败: ' + data.error, 'error')
    }
  } catch (error) {
    console.error('删除商品失败', error)
    window.$toast('删除失败，网络错误', 'error')
  }
}

const submitLoss = async () => {
  if (lossQty.value <= 0) {
    window.$toast('报损数量必须大于0', 'warning')
    return
  }
  
  try {
    const res = await productLoss(currentProduct.value.id, { loss_qty: lossQty.value, reason: lossReason.value }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('报损登记成功', 'success')
      showLossModal.value = false
      fetchProducts()
    } else {
      const data = await res.json()
      window.$toast('报损失败: ' + data.error, 'error')
    }
  } catch (error) {
    console.error('报损请求失败', error)
    window.$toast('报损失败，网络错误', 'error')
  }
}

// === 新增：库存管理高级功能 ===
const currentProduct = ref(null)

const showRestockModal = ref(false)
const restockQty = ref(0)
const restockReason = ref('')
const restockCostPrice = ref(null)
const restockRetailPrice = ref(null)

const showAdjustModal = ref(false)
const adjustQty = ref(0)
const adjustReason = ref('')
const adjustCostPrice = ref(null)

const showLogsModal = ref(false)
const stockLogs = ref([])

// 报损相关状态
const showLossModal = ref(false)
const lossQty = ref(0)
const lossReason = ref('')

const openRestock = (p) => {
  currentProduct.value = p
  restockQty.value = 1
  restockReason.value = '日常进货'
  restockCostPrice.value = Number(p.last_cost_price || p.cost_price || 0)
  restockRetailPrice.value = Number(p.retail_price || 0)
  showRestockModal.value = true
}

const submitRestock = async () => {
  if (restockQty.value <= 0) return window.$toast('入库数量必须大于0', 'warning')
  try {
    const payload = { qty: restockQty.value, reason: restockReason.value }
    if (restockCostPrice.value != null && restockCostPrice.value !== '') payload.cost_price = restockCostPrice.value
    if (restockRetailPrice.value != null && restockRetailPrice.value !== '') payload.retail_price = restockRetailPrice.value
    const res = await productRestock(currentProduct.value.id, payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('入库成功', 'success')
      showRestockModal.value = false
      fetchProducts()
    } else {
      const data = await res.json()
      window.$toast('入库失败: ' + data.error, 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('入库失败，网络错误', 'error')
  }
}

const openAdjust = (p) => {
  currentProduct.value = p
  adjustQty.value = p.stock
  adjustReason.value = '月末盘点校准'
  adjustCostPrice.value = Number(p.last_cost_price || p.cost_price || 0)
  showAdjustModal.value = true
}

const submitAdjust = async () => {
  if (adjustQty.value < 0) return window.$toast('实际库存不能小于0', 'warning')
  try {
    const payload = { actual_qty: adjustQty.value, reason: adjustReason.value }
    if (adjustCostPrice.value != null && adjustCostPrice.value !== '') payload.cost_price = adjustCostPrice.value
    const res = await productAdjust(currentProduct.value.id, payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('盘点校准成功', 'success')
      showAdjustModal.value = false
      fetchProducts()
    } else {
      const data = await res.json()
      window.$toast('盘点失败: ' + data.error, 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('盘点失败，网络错误', 'error')
  }
}

const openLoss = (p) => {
  currentProduct.value = p
  lossQty.value = 1
  lossReason.value = '损耗报废'
  showLossModal.value = true
}

const openLogs = async (p) => {
  currentProduct.value = p
  showLogsModal.value = true
  stockLogs.value = []
  try {
    const res = await getProductLogs(p.id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const data = await res.json()
      stockLogs.value = data.data
    }
  } catch (e) {
    console.error(e)
  }
}

const formatChangeType = (type) => {
  const map = { 'sell': '销售扣减', 'loss': '损耗报废', 'restock': '入库补货', 'adjust': '盘点校准', 'init': '初始化入库' }
  return map[type] || type
}
const getTypeColor = (type) => {
  const map = { 'sell': 'color-danger', 'loss': 'color-danger', 'restock': 'color-success', 'adjust': 'color-warning' }
  return map[type] || 'color-muted'
}

const showPriceModal = ref(false)
const priceCost = ref(0)
const priceRetail = ref(0)
const priceReason = ref('')

const openPriceModal = (p) => {
  currentProduct.value = p
  priceCost.value = Number(p.last_cost_price || p.cost_price || 0)
  priceRetail.value = Number(p.retail_price || 0)
  priceReason.value = '日常调价'
  showPriceModal.value = true
}

const submitPriceUpdate = async () => {
  try {
    const res = await updateProductPrices(currentProduct.value.id, { cost_price: priceCost.value, retail_price: priceRetail.value, reason: priceReason.value }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('改价成功', 'success')
      showPriceModal.value = false
      fetchProducts()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('改价失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('改价失败，网络错误', 'error')
  }
}

const showPriceLogsModal = ref(false)
const priceLogs = ref([])

const openPriceLogs = async (p) => {
  currentProduct.value = p
  showPriceLogsModal.value = true
  priceLogs.value = []
  try {
    const res = await getProductPriceLogs(p.id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const data = await res.json()
      priceLogs.value = data.data || []
    }
  } catch (e) {
    console.error(e)
  }
}

const formatPriceType = (t) => {
  const map = { retail: '零售价', last_cost: '最近进价', avg_cost: '库存平均成本' }
  return map[t] || t
}

const getSupplierNames = (idsJson) => {
  if (!idsJson) return '未指定供应商'
  try {
    const ids = JSON.parse(idsJson)
    if (!Array.isArray(ids) || ids.length === 0) return '未指定供应商'
    const names = ids.map(id => suppliers.value.find(s => s.id === id)?.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : '未指定供应商'
  } catch {
    return '未指定供应商'
  }
}

onMounted(() => {
  fetchBarcodeLookupSettings()
  fetchCostingMode()
  fetchProducts()
  fetchDeletedProducts()
  fetchSuppliers()
})
</script>

<template>
  <div class="inventory-container">
    <div class="header-bar">
      <h2 class="page-title">{{ viewMode === 'list' ? '商品与库存管理' : (viewMode === 'deleted' ? '已删除商品' : '新增商品') }}</h2>
      <div class="header-actions">
        <div v-if="viewMode === 'list'" class="segmented">
          <button class="seg-btn" :class="{ active: costingMode === 'avg' }" @click="setCostingMode('avg')">均价</button>
          <button class="seg-btn" :class="{ active: costingMode === 'fifo' }" @click="setCostingMode('fifo')">FIFO</button>
        </div>
        <button @click="viewMode = 'add'; editingProductId = null; newProduct = { barcode: '', name: '', brand: '', supplier_id: '', category_id: 1, cost_price: 0, retail_price: 0, stock: 10, min_stock: 5, unit: '件', is_weighing: false, image_url: '', image_base64: '', image_mime: '', expiry_date: '' }; imagePreview = '';" class="btn btn-primary" v-if="viewMode === 'list' || viewMode === 'deleted'">
          <span class="icon">+</span> 录入新商品
        </button>
        <button @click="showSupplierModal = true" class="btn btn-secondary" v-if="viewMode === 'list' || viewMode === 'deleted'">
          <span class="icon">🏢</span> 供应商管理
        </button>
        <button @click="showBarcodeConfigModal = true" class="btn btn-secondary" v-if="viewMode === 'list' || viewMode === 'deleted'">
          <span class="icon">⚙️</span> 条码设置
        </button>
        <button @click="viewMode = 'deleted'" class="btn btn-secondary btn-danger-outline" v-if="viewMode === 'list'">
          <span class="icon">🗑️</span> 已删除
        </button>
        <button v-if="viewMode === 'add' || viewMode === 'deleted'" @click="viewMode = 'list'" class="btn btn-secondary">
          返回列表
        </button>
      </div>
    </div>

    <div class="content-wrapper">
      <!-- 视图：添加商品表单 -->
      <div v-if="viewMode === 'add'" class="add-product-container">
        <div class="add-product-card">
          <div class="form-body">
            <div class="form-row">
              <div class="form-group col">
                <label>商品条码 <span class="help-text">支持扫码枪</span></label>
                <div class="input-with-action">
                  <input v-model="newProduct.barcode" @keyup.enter="handleBarcodeEnter" type="text" placeholder="扫描条码后可自动识别商品信息" class="form-input" autofocus />
                  <button class="btn btn-secondary btn-xs" type="button" @click="lookupBarcodeAndFill" :disabled="isBarcodeLookupLoading">
                    {{ isBarcodeLookupLoading ? '识别中' : '识别' }}
                  </button>
                  <button class="btn btn-secondary btn-xs" type="button" @click="showBarcodeConfigModal = true">
                    配置
                  </button>
                </div>
              </div>
              <div class="form-group col">
                <label>商品名称 <span class="required">*</span></label>
                <input v-model="newProduct.name" ref="nameInputRef" type="text" placeholder="如：新鲜苹果" class="form-input" />
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group col">
                <label>品牌</label>
                <input v-model="newProduct.brand" type="text" placeholder="选填，如：可口可乐" class="form-input" />
              </div>
              <div class="form-group col">
                <label>供应商 (可多选)</label>
                <div class="supplier-checkbox-group">
                  <label v-for="sup in suppliers" :key="sup.id" class="checkbox-label">
                    <input type="checkbox" :value="sup.id" v-model="newProduct.supplier_ids" />
                    {{ sup.name }}
                  </label>
                  <div v-if="suppliers.length === 0" style="color:#9ca3af;font-size:12px;">暂无供应商，请先在右上角添加</div>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label>商品照片 <span class="help-text">可上传或自动带回</span></label>
              <div class="image-uploader">
                <div v-if="imagePreview" class="image-preview">
                  <img :src="imagePreview" class="preview-img" alt="商品照片" />
                  <button class="btn btn-secondary btn-xs" type="button" @click="clearImage">移除</button>
                </div>
                <div v-else class="image-placeholder">
                  <div class="ph-icon">🖼️</div>
                  <div class="ph-text">未选择照片</div>
                </div>
                <label class="upload-btn">
                  上传照片
                  <input type="file" accept="image/*" @change="onSelectImage" />
                </label>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group col">
                <label>是否称重商品</label>
                <select v-model="newProduct.is_weighing" class="form-select">
                  <option :value="false">否 (按件)</option>
                  <option :value="true">是 (称重)</option>
                </select>
              </div>
              <div class="form-group col">
                <label>单位</label>
                <input v-model="newProduct.unit" type="text" placeholder="如：件、kg" class="form-input" />
              </div>
            </div>
            <div class="form-row" v-if="!editingProductId">
              <div class="form-group col">
                <label>进货价 (¥)</label>
                <input v-model.number="newProduct.cost_price" type="number" step="0.01" min="0" class="form-input" />
              </div>
              <div class="form-group col">
                <label>零售价 (¥)</label>
                <input v-model.number="newProduct.retail_price" type="number" step="0.01" min="0" class="form-input" />
              </div>
            </div>
            <div class="form-row" v-if="!editingProductId">
              <div class="form-group col">
                <label>初始库存</label>
                <input v-model.number="newProduct.stock" type="number" step="0.01" min="0" class="form-input" />
              </div>
              <div class="form-group col">
                <label>预警库存阈值</label>
                <input v-model.number="newProduct.min_stock" type="number" step="0.01" min="0" class="form-input" />
              </div>
            </div>
            <div class="form-row" v-if="editingProductId">
              <div class="form-group col">
                <label>预警库存阈值</label>
                <input v-model.number="newProduct.min_stock" type="number" step="0.01" min="0" class="form-input" />
              </div>
            </div>
          </div>
          <div class="form-actions">
            <button @click="viewMode = 'list'" class="btn btn-secondary">取消</button>
            <button @click="addProduct(true)" class="btn btn-secondary" v-if="!editingProductId">保存并继续添加</button>
            <button @click="addProduct(false)" class="btn btn-primary">保存并返回</button>
          </div>
        </div>
      </div>

      <!-- 视图：商品列表 -->
      <div v-if="viewMode === 'list'" class="product-list-card">
        <div class="list-header">
          <div class="search-wrapper">
            <span class="search-icon">🔍</span>
            <input type="text" v-model="searchQuery" placeholder="搜索商品名称或条码..." class="search-input" />
          </div>
        </div>
        
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th width="20%">商品编码</th>
                <th width="25%">商品名称</th>
                <th width="15%">价格(进/售)</th>
                <th width="15%">当前库存</th>
                <th width="25%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredProducts" :key="p.id">
                <td class="code-cell">{{ p.barcode }}</td>
                <td>
                  <div class="product-name">
                    <img v-if="p.image_url" :src="getUploadUrl(p.image_url)" class="thumb" alt="商品照片" />
                    <div style="display:flex;flex-direction:column;gap:4px;">
                      <span>{{ p.name }} <span v-if="p.is_weighing" class="tag tag-warning" style="margin-left:4px;">称重</span></span>
                      <span style="font-size:12px;color:#9ca3af;">{{ p.brand ? p.brand + ' | ' : '' }}{{ getSupplierNames(p.supplier_ids) }}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="price-stack">
                    <span class="cost-price" title="库存平均成本">均 ¥{{ p.cost_price.toFixed(2) }}</span>
                    <span class="cost-price muted" title="最近进货价">近 ¥{{ (p.last_cost_price ?? p.cost_price).toFixed(2) }}</span>
                    <span class="retail-price" title="零售价">¥{{ p.retail_price.toFixed(2) }}</span>
                  </div>
                </td>
                <td>
                  <span :class="['status-badge', p.stock <= p.min_stock ? 'danger' : 'success']">
                    <span class="dot"></span>
                    {{ p.stock }} {{ p.unit }}
                  </span>
                </td>
                <td>
                  <div class="action-group">
                    <button class="btn btn-action" @click="openEditProduct(p)" title="编辑商品信息">✏️ 编辑</button>
                    <button class="btn btn-action" @click="openRestock(p)" title="进货入库">📥 入库</button>
                    <button class="btn btn-action" @click="openAdjust(p)" title="盘点校准库存">⚖️ 盘点</button>
                    <button class="btn btn-action" @click="openLogs(p)" title="查看变动明细">📋 明细</button>
                    <button class="btn btn-action" @click="openPriceModal(p)" title="修改进价/售价">💰 改价</button>
                    <button class="btn btn-action" @click="openPriceLogs(p)" title="查看价格变化记录">📈 价变</button>
                    <div class="action-divider"></div>
                    <button class="btn btn-action text-danger" @click="openLoss(p)" title="损耗报废">🗑️ 报损</button>
                    <button class="btn btn-action text-danger" @click="deleteProduct(p.id)" title="删除商品">❌ 删除</button>
                  </div>
                </td>
              </tr>
              <tr v-if="products.length === 0">
                <td colspan="5">
                  <div class="empty-state">
                    <div class="empty-icon">📦</div>
                    <p>暂无商品数据，请在左侧表单中添加新商品</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 视图：已删除列表 -->
      <div v-else-if="viewMode === 'deleted'" class="product-list-card">
        <div class="list-header">
          <div class="search-wrapper">
            <span class="search-icon">🔍</span>
            <input type="text" v-model="searchQuery" placeholder="搜索已删除商品的条码或名称..." class="search-input" />
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th width="20%">商品编码</th>
                <th width="25%">商品名称</th>
                <th width="15%">价格(进/售)</th>
                <th width="15%">删除时间</th>
                <th width="25%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredDeletedProducts" :key="p.id">
                <td class="code-cell">{{ p.barcode ? p.barcode.replace(/_deleted_\d+$/, '') : '' }}</td>
                <td>
                  <div class="product-name">
                    <img v-if="p.image_url" :src="getUploadUrl(p.image_url)" class="thumb" alt="商品照片" />
                    <div style="display:flex;flex-direction:column;gap:4px;">
                      <span style="color: var(--text-muted); text-decoration: line-through;">{{ p.name }}</span>
                      <span style="font-size:12px;color:#9ca3af;">{{ p.brand ? p.brand + ' | ' : '' }}{{ getSupplierNames(p.supplier_ids) }}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="price-stack" style="opacity: 0.6;">
                    <span class="cost-price">均 ¥{{ (p.cost_price||0).toFixed(2) }}</span>
                    <span class="retail-price">¥{{ (p.retail_price||0).toFixed(2) }}</span>
                  </div>
                </td>
                <td>
                  <span class="status-badge danger">
                    <span class="dot"></span>
                    {{ new Date(p.deleted_at).toLocaleDateString() }}
                  </span>
                </td>
                <td>
                  <div class="action-group">
                    <button class="btn btn-action" @click="handleRestoreProduct(p.id)" title="恢复商品">♻️ 恢复商品</button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredDeletedProducts.length === 0">
                <td colspan="5">
                  <div class="empty-state">
                    <div class="empty-icon">🗑️</div>
                    <div class="empty-text">回收站空空如也</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 供应商管理弹窗 -->
    <div class="modal-overlay" :class="{ 'is-active': showSupplierModal }">
      <div class="modal-content" v-if="showSupplierModal" style="max-width: 600px;">
        <div class="modal-header">
          <h3>🏢 供应商管理</h3>
          <button class="close-btn" @click="showSupplierModal = false">×</button>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <div style="display: flex; gap: 12px; align-items: flex-end; margin-bottom: 20px;">
            <div style="flex: 2;">
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">供应商名称 <span class="required" style="color:var(--danger)">*</span></label>
              <input type="text" v-model="newSupplier.name" class="form-input" placeholder="如：XX商贸公司">
            </div>
            <div style="flex: 1.5;">
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">联系人</label>
              <input type="text" v-model="newSupplier.contact" class="form-input" placeholder="如：张三">
            </div>
            <div style="flex: 1.5;">
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">联系电话</label>
              <input type="text" v-model="newSupplier.phone" class="form-input" placeholder="如：138xxxx">
            </div>
            <div style="flex: 0 0 auto;">
              <button class="btn btn-primary" @click="addSupplier" style="height: 38px; padding: 0 16px;">添加</button>
            </div>
          </div>
          
          <div class="table-container" style="max-height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
            <table class="data-table" style="font-size: 13px; margin: 0; width: 100%;">
            <thead>
              <tr>
                <th>供应商名称</th>
                <th>联系人</th>
                <th>联系电话</th>
                <th width="80">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sup in suppliers" :key="sup.id">
                <td>{{ sup.name }}</td>
                <td>{{ sup.contact || '-' }}</td>
                <td>{{ sup.phone || '-' }}</td>
                <td>
                  <button class="btn btn-danger btn-xs" @click="deleteSupplier(sup.id)">删除</button>
                </td>
              </tr>
              <tr v-if="suppliers.length === 0">
                <td colspan="4" style="text-align: center; color: #9ca3af; padding: 24px;">暂无供应商数据</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
        <div class="modal-footer" style="padding: 16px 20px;">
          <button class="btn btn-secondary" @click="showSupplierModal = false">关闭</button>
        </div>
      </div>
    </div>
    <div class="modal-overlay" :class="{ 'is-active': showRestockModal }">
      <div class="modal-content" v-if="showRestockModal">
        <div class="modal-header">
          <h3>📥 补货入库 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showRestockModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>入库数量 <span class="unit-tag">{{ currentProduct?.unit }}</span></label>
            <input type="number" v-model.number="restockQty" class="form-input" :step="currentProduct?.is_weighing ? 0.01 : 1" min="0" autofocus>
          </div>
          <div class="form-row">
            <div class="form-group col">
              <label>本次进价 (¥)</label>
              <input type="number" v-model.number="restockCostPrice" class="form-input" step="0.01" min="0">
            </div>
            <div class="form-group col">
              <label>同步更新零售价 (¥)</label>
              <input type="number" v-model.number="restockRetailPrice" class="form-input" step="0.01" min="0">
            </div>
          </div>
          <div class="form-group">
            <label>备注说明</label>
            <input type="text" v-model="restockReason" class="form-input" placeholder="如：日常进货、供应商赠送">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showRestockModal = false">取消</button>
          <button class="btn btn-primary" @click="submitRestock">确认入库</button>
        </div>
      </div>
    </div>

    <!-- 弹窗：库存盘点 -->
    <div class="modal-overlay" :class="{ 'is-active': showAdjustModal }">
      <div class="modal-content" v-if="showAdjustModal">
        <div class="modal-header">
          <h3>⚖️ 库存盘点校准 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showAdjustModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="info-box">当前系统库存：<strong>{{ currentProduct?.stock }}</strong> {{ currentProduct?.unit }}</div>
          <div class="form-group">
            <label>实际清点数量 <span class="unit-tag">{{ currentProduct?.unit }}</span></label>
            <input type="number" v-model.number="adjustQty" class="form-input" :step="currentProduct?.is_weighing ? 0.01 : 1" min="0" autofocus>
          </div>
          <div v-if="adjustQty > (currentProduct?.stock ?? 0)" class="form-group">
            <label>增加部分按此进价计入 (¥)</label>
            <input type="number" v-model.number="adjustCostPrice" class="form-input" step="0.01" min="0">
          </div>
          <div class="form-group">
            <label>盘点备注</label>
            <input type="text" v-model="adjustReason" class="form-input" placeholder="如：月末盘点、库存不准校准">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showAdjustModal = false">取消</button>
          <button class="btn btn-warning" @click="submitAdjust">确认校准</button>
        </div>
      </div>
    </div>

    <!-- 弹窗：库存变动明细 -->
    <div class="modal-overlay" :class="{ 'is-active': showLogsModal }">
      <div class="modal-content modal-lg" v-if="showLogsModal">
        <div class="modal-header">
          <h3>📋 库存变动明细 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showLogsModal = false">×</button>
        </div>
        <div class="modal-body table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>变动时间</th>
                <th>类型</th>
                <th>变动量</th>
                <th>成本/售价</th>
                <th>操作人/原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in stockLogs" :key="log.id">
                <td class="time-cell">{{ new Date(log.created_at).toLocaleString() }}</td>
                <td><span class="type-tag" :class="getTypeColor(log.change_type)">{{ formatChangeType(log.change_type) }}</span></td>
                <td>
                  <strong :class="log.change_qty > 0 ? 'color-success' : 'color-danger'">
                    {{ log.change_qty > 0 ? '+' : '' }}{{ log.change_qty }}
                  </strong>
                </td>
                <td class="text-muted">
                  <span v-if="log.unit_cost_price != null">成 ¥{{ Number(log.unit_cost_price).toFixed(2) }}</span>
                  <span v-if="log.unit_retail_price != null" style="margin-left: 8px;">售 ¥{{ Number(log.unit_retail_price).toFixed(2) }}</span>
                </td>
                <td class="text-muted">{{ log.operator }}</td>
              </tr>
              <tr v-if="stockLogs.length === 0">
                <td colspan="5" class="empty-state">
                  <div class="empty-icon">📂</div>
                  <p>暂无库存变动记录</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="modal-overlay" :class="{ 'is-active': showPriceModal }">
      <div class="modal-content" v-if="showPriceModal">
        <div class="modal-header">
          <h3>💰 改价 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showPriceModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group col">
              <label>最近进价 (¥)</label>
              <input type="number" v-model.number="priceCost" class="form-input" step="0.01" min="0" autofocus>
            </div>
            <div class="form-group col">
              <label>零售价 (¥)</label>
              <input type="number" v-model.number="priceRetail" class="form-input" step="0.01" min="0">
            </div>
          </div>
          <div class="form-group">
            <label>调价原因</label>
            <input type="text" v-model="priceReason" class="form-input" placeholder="如：促销、供应商涨价">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showPriceModal = false">取消</button>
          <button class="btn btn-primary" @click="submitPriceUpdate">确认改价</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" :class="{ 'is-active': showPriceLogsModal }">
      <div class="modal-content modal-lg" v-if="showPriceLogsModal">
        <div class="modal-header">
          <h3>📈 价格变动记录 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showPriceLogsModal = false">×</button>
        </div>
        <div class="modal-body table-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>字段</th>
                <th>旧值</th>
                <th>新值</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in priceLogs" :key="l.id">
                <td class="time-cell">{{ new Date(l.created_at).toLocaleString() }}</td>
                <td class="text-muted">{{ formatPriceType(l.price_type) }}</td>
                <td>¥{{ Number(l.old_price || 0).toFixed(2) }}</td>
                <td>¥{{ Number(l.new_price || 0).toFixed(2) }}</td>
                <td class="text-muted">{{ l.reason }}</td>
              </tr>
              <tr v-if="priceLogs.length === 0">
                <td colspan="5" class="empty-state">
                  <div class="empty-icon">📈</div>
                  <p>暂无价格变动记录</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 弹窗：损耗报废 -->
    <div class="modal-overlay" :class="{ 'is-active': showLossModal }">
      <div class="modal-content" v-if="showLossModal">
        <div class="modal-header">
          <h3>🗑️ 损耗报废 - {{ currentProduct?.name }}</h3>
          <button class="close-btn" @click="showLossModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="info-box" style="background: var(--danger-bg); color: var(--danger); border-left-color: var(--danger);">
            当前系统库存：<strong>{{ currentProduct?.stock }}</strong> {{ currentProduct?.unit }}
          </div>
          <div class="form-group">
            <label>报损数量 <span class="unit-tag">{{ currentProduct?.unit }}</span></label>
            <input type="number" v-model.number="lossQty" class="form-input" :step="currentProduct?.is_weighing ? 0.01 : 1" min="0" :max="currentProduct?.stock" autofocus>
          </div>
          <div class="form-group">
            <label>报损原因</label>
            <input type="text" v-model="lossReason" class="form-input" placeholder="如：水果腐烂、过期、包装破损">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showLossModal = false">取消</button>
          <button class="btn btn-danger" @click="submitLoss">确认报损</button>
        </div>
      </div>
    </div>

    <!-- 自定义确认弹窗 (Confirm Dialog) -->
    <div class="modal-overlay" :class="{ 'is-active': confirmDialog.show }">
      <div class="modal-content" v-if="confirmDialog.show" style="width: 320px;">
        <div class="modal-header">
          <h3>提示</h3>
          <button class="close-btn" @click="confirmDialog.onCancel">×</button>
        </div>
        <div class="modal-body" style="text-align: center; padding: 32px 24px;">
          <p style="font-size: 16px; margin: 0; color: var(--text-main);">{{ confirmDialog.message }}</p>
        </div>
        <div class="modal-footer" style="justify-content: center;">
          <button class="btn btn-secondary" @click="confirmDialog.onCancel">取消</button>
          <button class="btn btn-danger" @click="confirmDialog.onConfirm">确认删除</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" :class="{ 'is-active': showBarcodeConfigModal }">
      <div class="modal-content" v-if="showBarcodeConfigModal">
        <div class="modal-header">
          <h3>🔧 条码识别配置</h3>
          <button class="close-btn" @click="showBarcodeConfigModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>平台</label>
            <select v-model="barcodeProvider" class="form-select">
              <option value="tanshuapi">探数API（中国）</option>
            </select>
          </div>
          <div class="form-group">
            <label>Key <span class="help-text">{{ tanshuapiKeySet ? '已配置' : '未配置' }}</span></label>
            <input v-model="tanshuapiKey" type="password" class="form-input" placeholder="输入探数API key（留空不修改）" />
          </div>
          <div class="info-box">接口：api.tanshuapi.com /api/barcode/v1/index（图片有效期24小时，建议需要时上传或下载保存）</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showBarcodeConfigModal = false">取消</button>
          <button class="btn btn-primary" @click="saveBarcodeLookupSettings">保存</button>
        </div>
      </div>
    </div>

  </div>

 </template>

<style scoped>
.inventory-container {
  padding: 20px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-main);
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.segmented {
  display: inline-flex;
  background: #f1f5f9;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 4px;
  gap: 4px;
}

.segmented .seg-btn {
  border: 0;
  background: transparent;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  cursor: pointer;
}

.segmented .seg-btn.active {
  background: var(--surface);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.content-wrapper {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* 居中的添加商品表单 */
.add-product-container {
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 20px;
}

.add-product-card {
  width: 100%;
  max-width: 640px;
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 32px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 32px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.help-text {
  font-size: 12px;
  font-weight: 400;
  color: var(--primary);
  background: var(--primary-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.input-with-action {
  display: flex;
  gap: 10px;
  align-items: center;
}

.btn-xs {
  padding: 8px 10px;
  font-size: 12px;
  border-radius: 10px;
  white-space: nowrap;
}

.image-uploader {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.image-preview {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-img {
  width: 88px;
  height: 88px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid var(--border-color);
  background: #fff;
}

.image-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: #f8fafc;
  color: var(--text-muted);
}

.image-placeholder .ph-icon {
  font-size: 18px;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text-main);
  font-weight: 700;
  cursor: pointer;
  width: fit-content;
}

.upload-btn input {
  display: none;
}

.form-input, .form-select {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 15px;
  color: var(--text-main);
  background-color: var(--surface);
  transition: all 0.2s ease;
  outline: none;
}

.form-input:focus, .form-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.form-row {
  display: flex;
  gap: 20px;
}
.form-row .col {
  flex: 1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color);
}

.btn-secondary {
  background: white;
  border: 1px solid var(--border-color);
  color: var(--text-main);
}
.btn-secondary:hover {
  background: var(--bg-color);
}

/* 列表卡片 */
.product-list-card {
  flex: 1;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.search-wrapper {
  position: relative;
  width: 280px;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: var(--text-muted);
}
.search-input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-full);
  font-size: 13px;
  outline: none;
  transition: all 0.2s;
}
.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.table-container {
  flex: 1;
  overflow-y: auto;
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.data-table th {
  background: var(--bg-color);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 12px 24px;
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border-color);
}

.data-table td {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
  vertical-align: middle;
}

.data-table tbody tr:hover td {
  background-color: #f8fafc;
}

.code-cell {
  font-family: monospace;
  color: var(--text-muted);
  font-size: 13px;
}

.product-name {
  font-weight: 500;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}

.thumb {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--border-color);
  background: #fff;
}

.tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}
.tag-warning {
  background: var(--warning-bg);
  color: #b45309;
}

.price-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cost-price {
  font-size: 12px;
  color: var(--text-muted);
}
.cost-price.muted {
  opacity: 0.7;
}
.retail-price {
  font-weight: 600;
  color: var(--danger);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
}
.status-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-badge.success {
  background: var(--success-bg);
  color: #047857;
}
.status-badge.success .dot {
  background: var(--success);
}
.status-badge.danger {
  background: var(--danger-bg);
  color: #b91c1c;
}
.status-badge.danger .dot {
  background: var(--danger);
}

.action-group {
  display: flex;
  gap: 8px;
}

.btn-text {
  background: transparent;
  color: var(--primary);
  padding: 6px 10px;
}
.btn-text:hover {
  background: var(--primary-light);
}
.btn-text.text-danger {
  color: var(--danger);
}
.btn-text.text-danger:hover {
  background: var(--danger-bg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  color: var(--text-muted);
}
.empty-state .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}
.action-divider {
  width: 1px;
  height: 14px;
  background: var(--border-color);
  margin: 0 4px;
}

/* 模态弹窗 Modal 样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s ease;
}

.modal-overlay.is-active {
  opacity: 1;
  pointer-events: auto;
}

.modal-content {
  background: var(--surface);
  border-radius: var(--radius-lg);
  width: 400px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
  transform: translateY(20px) scale(0.95);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  display: flex;
  flex-direction: column;
}

.modal-content.modal-lg {
  width: 600px;
}

.modal-overlay.is-active .modal-content {
  transform: translateY(0) scale(1);
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
}
.close-btn:hover {
  background: var(--bg-color);
  color: var(--text-main);
}

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-body.table-body {
  padding: 0;
  max-height: 400px;
  overflow-y: auto;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: var(--bg-color);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.btn-secondary {
  background: white;
  border: 1px solid var(--border-color);
  color: var(--text-main);
}
.btn-secondary:hover {
  background: var(--bg-color);
}

.btn-warning {
  background: var(--warning);
  color: white;
}
.btn-warning:hover {
  background: #d97706;
}

.btn-danger {
  background: var(--danger);
  color: white;
}
.btn-danger:hover {
  background: #dc2626;
}

.info-box {
  background: var(--primary-light);
  color: var(--primary-hover);
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  border-left: 4px solid var(--primary);
}

.unit-tag {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  background: var(--bg-color);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  margin-left: 8px;
}

/* 颜色与状态辅助类 */
.color-success { color: var(--success); }
.color-danger { color: var(--danger); }
.color-warning { color: var(--warning); }
.color-muted { color: var(--text-muted); }

.type-tag {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-color);
}
.type-tag.color-success { color: var(--success); background: var(--success-bg); }
.type-tag.color-danger { color: var(--danger); background: var(--danger-bg); }
.type-tag.color-warning { color: #b45309; background: var(--warning-bg); }

.time-cell {
  font-size: 13px;
  color: var(--text-muted);
  font-family: monospace;
}

@media (max-width: 900px) {
  .inventory-container {
    padding: 14px;
    height: auto;
    min-height: calc(100vh - 120px);
  }

  .header-bar {
    padding: 14px 16px;
  }

  .page-title {
    font-size: 18px;
  }

  .header-actions .btn {
    padding: 10px 14px;
    border-radius: 14px;
  }

  .add-product-card {
    padding: 18px;
    max-width: 100%;
  }

  .form-row {
    flex-direction: column;
    gap: 14px;
  }

  .form-actions {
    flex-direction: column;
  }

  .form-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .list-header {
    padding: 14px 16px;
  }

  .search-wrapper {
    width: 100%;
  }

  .table-container {
    overflow-x: auto;
  }

  .data-table {
    min-width: 980px;
  }

  .data-table th,
  .data-table td {
    padding-left: 16px;
    padding-right: 16px;
  }

  .action-group {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .modal-content {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
  }

  .modal-content.modal-lg {
    width: calc(100vw - 24px);
  }
}

.supplier-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 120px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: #fff;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  background: #f1f5f9;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}
.checkbox-label:hover {
  background: #e2e8f0;
}

</style>
