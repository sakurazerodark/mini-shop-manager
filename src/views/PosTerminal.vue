<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getProductByBarcode } from '../api/products'
import { getPayments } from '../api/settings'
import { createPendingOrder, cancelOrder, getOrder, completeOrder } from '../api/orders'
import { queryAlipay, precreateAlipay, payAlipay } from '../api/payments'

const barcodeInput = ref('')
const barcodeInputRef = ref(null)
const cart = ref([])
const paymentMethod = ref('alipay')
const paymentConfig = ref(null)

// 结账成功动画状态
const showSuccessOverlay = ref(false)
const successData = ref(null)
let successTimer = null

const showPayOverlay = ref(false)
const scanPayCode = ref('')
const pendingOrder = ref(null)
const isFinalizing = ref(false)
const alipayQrCode = ref('')
const isPayCreating = ref(false)
const isPayPolling = ref(false)
let payPollTimer = null
let payPollStartedAt = 0
let payGatewayLastQueryAt = 0

const alipayQrImg = computed(() => {
  if (!alipayQrCode.value) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(alipayQrCode.value)}`
})

const getUploadUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (window.location.protocol === 'file:') {
    return `http://localhost:8080${url}`
  }
  return url
}

const showWeightModal = ref(false)
const weightProduct = ref(null)
const weightValue = ref(1)
const weightInputRef = ref(null)

const totalAmount = computed(() => {
  return cart.value.reduce((total, item) => total + (item.retail_price * item.quantity), 0)
})

const totalItems = computed(() => {
  return cart.value.reduce((total, item) => total + item.quantity, 0)
})

const handleScan = async () => {
  const code = barcodeInput.value.trim()
  if (!code) return
  
  try {
    const res = await getProductByBarcode(code).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const data = await res.json()
      const product = data.data
      
      const existingItem = cart.value.find(item => item.id === product.id)
      
      if (product.is_weighing) {
        weightProduct.value = product
        weightValue.value = 1
        showWeightModal.value = true
      } else {
        if (existingItem) {
          existingItem.quantity += 1
        } else {
          cart.value.unshift({ ...product, quantity: 1 })
        }
      }
      
    } else {
      window.$toast(`未找到条码为 ${code} 的商品！`, 'warning', { size: 'lg', duration: 3500 })
    }
  } catch (error) {
    console.error('扫码查询失败:', error)
    window.$toast('扫码查询失败，请重试', 'error')
  } finally {
    barcodeInput.value = ''
    if (showWeightModal.value) {
      await nextTick()
      if (weightInputRef.value) weightInputRef.value.focus()
    } else {
      barcodeInputRef.value.focus()
    }
  }
}

const confirmWeight = () => {
  const product = weightProduct.value
  if (!product) return
  const weight = parseFloat(weightValue.value)
  if (isNaN(weight) || weight <= 0) {
    window.$toast('重量输入无效', 'warning')
    return
  }

  const existingItem = cart.value.find(item => item.id === product.id)
  if (existingItem) {
    existingItem.quantity += weight
  } else {
    cart.value.unshift({ ...product, quantity: weight })
  }

  showWeightModal.value = false
  weightProduct.value = null
  nextTick(() => {
    if (barcodeInputRef.value) barcodeInputRef.value.focus()
  })
}

const cancelWeight = () => {
  showWeightModal.value = false
  weightProduct.value = null
  nextTick(() => {
    if (barcodeInputRef.value) barcodeInputRef.value.focus()
  })
}

const increaseQty = (item) => {
  item.quantity++
}

const decreaseQty = (item) => {
  if (item.quantity > 1) {
    item.quantity--
  } else {
    removeFromCart(item)
  }
}

const removeFromCart = (item) => {
  const index = cart.value.findIndex(i => i.id === item.id)
  if (index !== -1) {
    cart.value.splice(index, 1)
  }
  barcodeInputRef.value.focus()
}

const fetchPaymentConfig = async () => {
  try {
    const res = await getPayments().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) return
    const json = await res.json()
    paymentConfig.value = json?.data || null
  } catch (e) {
    console.error(e)
  }
}

const isPaymentEnabled = (method) => {
  if (method === 'cash') return true
  if (method === 'personal_qrcode') return true
  if (method === 'wechat') return false // 开发中
  if (method === 'unionpay') return false // 开发中

  if (!paymentConfig.value) return false

  if (method === 'wechat') {
    const w = paymentConfig.value.wechatpay_v3
    const baseOk = Boolean(w?.mchid && w?.appid && w?.serial_no && w?.api_v3_key_set && w?.merchant_private_key_set)
    if (!baseOk) return false
    if (w?.notify_mode === 'callback') return Boolean(w?.platform_cert_set)
    return true
  }

  if (method === 'alipay') {
    const a = paymentConfig.value.alipay_f2f
    return Boolean(a?.app_id && a?.gateway && a?.merchant_private_key_set && a?.alipay_public_key_set)
  }

  if (method === 'unionpay') {
    const u = paymentConfig.value.unionpay
    return Boolean(u?.merchant_id && u?.sign_key_set)
  }

  return false
}

const normalizePaymentMethod = () => {
  if (isPaymentEnabled(paymentMethod.value)) return
  const ordered = ['wechat', 'alipay', 'unionpay', 'cash']
  const next = ordered.find(m => isPaymentEnabled(m)) || 'cash'
  paymentMethod.value = next
}

const ensurePaymentConfigured = () => {
  if (isPaymentEnabled(paymentMethod.value)) return true
  window.$toast('该支付方式未配置完整，请到系统设置填写', 'warning', { size: 'lg' })
  return false
}

const buildOrderData = () => {
  return {
    order_id: 'ORD' + Date.now(),
    total_amount: totalAmount.value,
    pay_method: paymentMethod.value,
    items: cart.value.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      unit_price: item.retail_price
    }))
  }
}

const createPendingOrderApi = async (orderData) => {
  const res = await createPendingOrder(orderData).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.error || '创建待支付订单失败')
  }
  return orderData
}

const cancelPendingOrderApi = async (orderId) => {
  await cancelOrder(orderId).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) })).catch(() => {})
}

const stopPayPolling = () => {
  isPayPolling.value = false
  if (payPollTimer) {
    clearInterval(payPollTimer)
    payPollTimer = null
  }
  payPollStartedAt = 0
  payGatewayLastQueryAt = 0
}

const pollAlipayStatus = async () => {
  if (!pendingOrder.value) return
  try {
    const isCallbackMode = paymentConfig.value?.alipay_f2f?.notify_mode === 'callback'
    if (isCallbackMode) {
      const startedAt = payPollStartedAt || Date.now()
      payPollStartedAt = startedAt
      const res = await getOrder(pendingOrder.value.order_id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
      if (!res.ok) return
      const json = await res.json().catch(() => ({}))
      const order = json?.data?.order
      if (order?.pay_status === 'paid') {
        stopPayPolling()
        await fetchPaymentConfig()
        await finalizeOrder()
        return
      }
      const elapsed = Date.now() - startedAt
      const timeoutMs = 60_000
      const gatewayMinIntervalMs = 5_000
      if (elapsed >= timeoutMs) {
        if (Date.now() - (payGatewayLastQueryAt || 0) < gatewayMinIntervalMs) return
        payGatewayLastQueryAt = Date.now()
        const q = await queryAlipay(pendingOrder.value.order_id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
        if (!q.ok) return
        const qj = await q.json().catch(() => ({}))
        if (qj?.data?.paid) {
          stopPayPolling()
          await fetchPaymentConfig()
          await finalizeOrder()
        }
      }
      return
    }

    const res = await queryAlipay(pendingOrder.value.order_id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) return
    const json = await res.json()
    if (json?.data?.paid) {
      stopPayPolling()
      await fetchPaymentConfig()
      await finalizeOrder()
    }
  } catch (_) {}
}

const startAlipayPolling = () => {
  if (isPayPolling.value) return
  isPayPolling.value = true
  stopPayPolling()
  isPayPolling.value = true
  payPollStartedAt = Date.now()
  const ms = Math.max(1000, Math.floor(Number(paymentConfig.value?.poll_interval_ms || 2000)))
  payPollTimer = setInterval(() => {
    pollAlipayStatus()
  }, ms)
}

const createAlipayQr = async () => {
  if (!pendingOrder.value) return
  isPayCreating.value = true
  alipayQrCode.value = ''
  try {
    const res = await precreateAlipay({ order_id: pendingOrder.value.order_id, total_amount: pendingOrder.value.total_amount }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('alipay precreate failed:', json)
      window.$toast('支付宝预下单失败: ' + (json.error || '未知错误'), 'error')
      return
    }
    alipayQrCode.value = json?.data?.qr_code || ''
    if (alipayQrCode.value) startAlipayPolling()
  } catch (e) {
    console.error(e)
    window.$toast('支付宝预下单失败，网络错误', 'error')
  } finally {
    isPayCreating.value = false
  }
}

const submitAlipayScanPay = async () => {
  if (!pendingOrder.value) return
  const code = scanPayCode.value.trim()
  if (!code) return
  isPayCreating.value = true
  try {
    const res = await payAlipay({ order_id: pendingOrder.value.order_id, total_amount: pendingOrder.value.total_amount, auth_code: code }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('alipay pay failed:', json)
      window.$toast('付款失败: ' + (json.error || '未知错误'), 'error')
      return
    }
    if (json?.data?.paid) {
      await finalizeOrder()
      return
    }
    startAlipayPolling()
    window.$toast('等待支付结果...', 'info')
  } catch (e) {
    console.error(e)
    window.$toast('付款失败，网络错误', 'error')
  } finally {
    isPayCreating.value = false
  }
}

const finalizeOrder = async () => {
  if (!pendingOrder.value) return
  if (isFinalizing.value) return
  isFinalizing.value = true
  try {
    const res = await completeOrder(pendingOrder.value.order_id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      window.$toast(`结算失败: ${errorData.error || '未知错误'}`, 'error')
      return
    }
    await res.json().catch(() => ({}))
    let confirmedVia = null
    try {
      const odRes = await getOrder(pendingOrder.value.order_id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
      const odJson = await odRes.json().catch(() => ({}))
      if (odRes.ok) {
        confirmedVia = odJson?.data?.order?.pay_confirmed_via || null
      }
    } catch (_) {}
    successData.value = {
      orderId: pendingOrder.value.order_id,
      amount: Number(pendingOrder.value.total_amount || 0).toFixed(2),
      items: pendingOrder.value.items.reduce((t, it) => t + Number(it.quantity || 0), 0),
      payMethod: paymentMethod.value,
      confirmedVia
    }
    showSuccessOverlay.value = true
    showPayOverlay.value = false
    cart.value = []

    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      closeSuccessOverlay()
    }, 10000)
  } catch (e) {
    console.error(e)
    window.$toast('网络错误，结账失败！', 'error')
  } finally {
    isFinalizing.value = false
    stopPayPolling()
    pendingOrder.value = null
    scanPayCode.value = ''
    alipayQrCode.value = ''
    if (!showSuccessOverlay.value) barcodeInputRef.value?.focus()
  }
}

const openPayOverlay = async () => {
  showPayOverlay.value = true
  scanPayCode.value = ''
  alipayQrCode.value = ''
  await nextTick()
  if (paymentMethod.value === 'alipay') {
    createAlipayQr()
  }
}

const cancelPayOverlay = () => {
  stopPayPolling()
  if (pendingOrder.value?.order_id) cancelPendingOrderApi(pendingOrder.value.order_id)
  showPayOverlay.value = false
  pendingOrder.value = null
  scanPayCode.value = ''
  alipayQrCode.value = ''
  setTimeout(() => barcodeInputRef.value?.focus(), 200)
}

const startScanPay = () => {
  // Now handled by global scan listener
}

const checkout = async () => {
  if (cart.value.length === 0) {
    window.$toast('购物车为空，无法结账！', 'warning')
    return
  }

  if (!ensurePaymentConfigured()) return

  const orderData = buildOrderData()
  try {
    pendingOrder.value = await createPendingOrderApi(orderData)
  } catch (e) {
    window.$toast(e.message || '创建待支付订单失败', 'error')
    return
  }

  if (paymentMethod.value === 'cash') {
    await finalizeOrder()
    return
  }

  await openPayOverlay()
}

// 收到任何新输入时关闭成功提示
const closeSuccessOverlay = () => {
  showSuccessOverlay.value = false
  if (successTimer) {
    clearTimeout(successTimer)
    successTimer = null
  }
  // 恢复焦点
  setTimeout(() => {
    if (barcodeInputRef.value) {
      barcodeInputRef.value.focus()
    }
  }, 300)
}

let barcodeBuffer = ''
let lastKeyTime = 0

// 监听全局按键，实现免焦点扫码与自动关闭成功提示
const suspendedOrder = ref(null)

const handleGlobalKeydown = (e) => {
  // 处理全局快捷键
  if (e.key === 'F1') {
    e.preventDefault()
    if (cart.value.length === 0) {
      window.$toast('购物车为空，无法挂单', 'warning')
      return
    }
    suspendedOrder.value = JSON.parse(JSON.stringify(cart.value))
    cart.value = []
    window.$toast('已挂单', 'success')
    return
  }
  
  if (e.key === 'F2') {
    e.preventDefault()
    if (!suspendedOrder.value || suspendedOrder.value.length === 0) {
      window.$toast('暂无挂单可取', 'warning')
      return
    }
    if (cart.value.length > 0) {
      window.$toast('请先结账或清空当前购物车，再取单', 'warning')
      return
    }
    cart.value = JSON.parse(JSON.stringify(suspendedOrder.value))
    suspendedOrder.value = null
    window.$toast('已取单', 'success')
    return
  }
  
  if (e.key === 'Escape' && !showSuccessOverlay.value && !showWeightModal.value && !showPayOverlay.value) {
    e.preventDefault()
    if (cart.value.length > 0) {
      cart.value = []
      window.$toast('购物车已清空', 'info')
    }
    return
  }

  if (showSuccessOverlay.value) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key.length === 1) {
      closeSuccessOverlay()
      // 对于条码扫描，继续往下走，让 buffer 接住
    }
  }

  if (showWeightModal.value) {
    barcodeBuffer = ''
    return
  }

  const now = Date.now()
  
  // 超过50ms未输入，清空缓冲区（人手敲击通常>50ms，扫码枪通常<30ms）
  if (now - lastKeyTime > 50) {
    barcodeBuffer = ''
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    barcodeBuffer += e.key
    lastKeyTime = now
  } else if (e.key === 'Enter') {
    // 判断为扫码枪（输入内容>=4位，且最后一个字符到回车的时间<50ms）
    if (barcodeBuffer.length >= 4 && (now - lastKeyTime <= 50)) {
      e.preventDefault() // 阻止默认提交行为
      
      // 如果焦点在别的输入框（如数量框），失去焦点防止冲突
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur()
      }

      // 如果当前在支付弹窗且选择了支付宝，拦截为“扫码付款”
      if (showPayOverlay.value && paymentMethod.value === 'alipay') {
        scanPayCode.value = barcodeBuffer
        submitAlipayScanPay()
      } else if (!showPayOverlay.value) {
        // 否则将识别到的条码填入并触发商品搜索
        barcodeInput.value = barcodeBuffer
        handleScan()
      }
    }
    barcodeBuffer = ''
  }
}

watch(paymentConfig, () => {
  normalizePaymentMethod()
})

onMounted(async () => {
  if (barcodeInputRef.value) {
    barcodeInputRef.value.focus()
  }
  await fetchPaymentConfig()
  normalizePaymentMethod()
  window.addEventListener('keydown', handleGlobalKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (successTimer) clearTimeout(successTimer)
  stopPayPolling()
})
</script>

<template>
  <div class="pos-container">
    <!-- 左侧购物车区域 -->
    <div class="cart-section">
      <div class="header-bar">
        <h2 class="page-title">收银台</h2>
        <div class="scan-box">
          <div class="scan-input-wrapper">
            <span class="scan-icon">🔍</span>
            <input 
              ref="barcodeInputRef"
              v-model="barcodeInput" 
              @keyup.enter="handleScan"
              type="text" 
              placeholder="扫描商品条码或输入拼音简码..." 
              class="scan-input"
              autofocus
            />
          </div>
          <button @click="handleScan" class="btn btn-primary btn-lg">回车添加</button>
        </div>
      </div>

      <div class="cart-card">
        <div class="cart-list-wrapper">
          <div class="shortcut-tips" style="display: flex; justify-content: flex-end; padding: 8px 16px; background: var(--surface-alt); border-bottom: 1px solid var(--border-color); font-size: 13px; color: var(--text-muted); gap: 16px;">
            <span><kbd>F1</kbd> 挂单</span>
            <span :style="{ color: suspendedOrder ? 'var(--primary)' : 'var(--text-muted)', fontWeight: suspendedOrder ? 'bold' : 'normal' }"><kbd>F2</kbd> 取单</span>
            <span><kbd>ESC</kbd> 清空</span>
          </div>
          <table class="cart-table">
            <thead>
              <tr>
                <th width="40%">商品信息</th>
                <th width="15%">单价</th>
                <th width="20%">数量</th>
                <th width="15%">小计</th>
                <th width="10%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in cart" :key="item.id" class="cart-row">
                <td>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="cart-item-image" style="width: 40px; height: 40px; flex-shrink: 0;">
                      <img :src="getUploadUrl(item.image_url) || '/favicon.svg'" :alt="item.name" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);" />
                    </div>
                    <div class="product-info">
                      <div class="p-name">
                        {{ item.name }}
                        <span v-if="item.is_weighing" class="badge-weighing">称重</span>
                      </div>
                      <div class="p-code">{{ item.barcode }}</div>
                    </div>
                  </div>
                </td>
                <td class="p-price">¥{{ item.retail_price.toFixed(2) }} <span class="p-unit">/ {{ item.unit }}</span></td>
                <td>
                  <div class="qty-control" v-if="!item.is_weighing">
                    <button @click="decreaseQty(item)" class="qty-btn">-</button>
                    <span class="qty-num">{{ item.quantity }}</span>
                    <button @click="increaseQty(item)" class="qty-btn">+</button>
                  </div>
                  <div class="qty-control weighing-qty" v-else>
                    <span class="qty-num">{{ item.quantity.toFixed(3) }} {{ item.unit }}</span>
                  </div>
                </td>
                <td class="p-subtotal">¥{{ (item.retail_price * item.quantity).toFixed(2) }}</td>
                <td>
                  <button @click="removeFromCart(item)" class="action-btn delete-btn" title="删除">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  </button>
                </td>
              </tr>
              <tr v-if="cart.length === 0">
                <td colspan="5">
                  <div class="empty-cart">
                    <div class="empty-icon">🛒</div>
                    <p>请扫描商品条码开始收银</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 右侧结算区域 -->
    <div class="checkout-section">
      <div class="summary-card">
        <h3 class="card-title">订单摘要</h3>
        <div class="summary-item">
          <span class="label">商品总数</span>
          <span class="value">{{ totalItems }} 件</span>
        </div>
        <div class="summary-item total-row">
          <span class="label">应收总额</span>
          <div class="total-price">
            <span class="currency">¥</span>
            <span class="amount">{{ totalAmount.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <div class="payment-card">
        <h3 class="card-title">收款方式</h3>
        <div class="pay-methods">
          <label :class="['pay-method', { active: paymentMethod === 'alipay', disabled: !isPaymentEnabled('alipay') }]">
            <input type="radio" v-model="paymentMethod" value="alipay" class="hidden-radio" :disabled="!isPaymentEnabled('alipay')" />
            <div class="pay-icon alipay">
              <svg class="icon" viewBox="0 0 1024 1024" width="28" height="28" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M902.095 652.871l-250.96-84.392s19.287-28.87 39.874-85.472c20.59-56.606 23.539-87.689 23.539-87.689l-162.454-1.339v-55.487l196.739-1.387v-39.227H552.055v-89.29h-96.358v89.294H272.133v39.227l183.564-1.304v59.513h-147.24v31.079h303.064s-3.337 25.223-14.955 56.606c-11.615 31.38-23.58 58.862-23.58 58.862s-142.3-49.804-217.285-49.804c-74.985 0-166.182 30.123-175.024 117.55-8.8 87.383 42.481 134.716 114.728 152.139 72.256 17.513 138.962-0.173 197.04-28.607 58.087-28.391 115.081-92.933 115.081-92.933l292.486 142.041c-11.932 69.3-72.067 119.914-142.387 119.844H266.37c-79.714 0.078-144.392-64.483-144.466-144.194V266.374c-0.074-79.72 64.493-144.399 144.205-144.47h491.519c79.714-0.073 144.396 64.49 144.466 144.203v386.764z m-365.76-48.895s-91.302 115.262-198.879 115.262c-107.623 0-130.218-54.767-130.218-94.155 0-39.34 22.373-82.144 113.943-88.333 91.519-6.18 215.2 67.226 215.2 67.226h-0.047z" fill="#02A9F1"></path></svg>
            </div>
            <span class="pay-name">支付宝</span>
            <div class="pay-badge" v-if="!isPaymentEnabled('alipay')">未配置</div>
            <div class="check-icon" v-if="paymentMethod === 'alipay' && isPaymentEnabled('alipay')">✓</div>
          </label>
          <label :class="['pay-method', { active: paymentMethod === 'wechat', disabled: true }]">
            <input type="radio" v-model="paymentMethod" value="wechat" class="hidden-radio" disabled />
            <div class="pay-icon wechat">
              <svg class="icon" viewBox="0 0 1024 1024" width="28" height="28" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M395.846 603.585c-3.921 1.98-7.936 2.925-12.81 2.925-10.9 0-19.791-5.85-24.764-14.625l-2.006-3.864-78.106-167.913c-0.956-1.98-0.956-3.865-0.956-5.845 0-7.83 5.928-13.68 13.863-13.68 2.965 0 5.928 0.944 8.893 2.924l91.965 64.43c6.884 3.864 14.82 6.79 23.708 6.79 4.972 0 9.85-0.945 14.822-2.926L861.71 282.479c-77.149-89.804-204.684-148.384-349.135-148.384-235.371 0-427.242 157.158-427.242 351.294 0 105.368 57.361 201.017 147.323 265.447 6.88 4.905 11.852 13.68 11.852 22.45 0 2.925-0.957 5.85-2.006 8.775-6.881 26.318-18.831 69.334-18.831 71.223-0.958 2.92-2.013 6.79-2.013 10.75 0 7.83 5.929 13.68 13.865 13.68 2.963 0 5.928-0.944 7.935-2.925l92.922-53.674c6.885-3.87 14.82-6.794 22.756-6.794 3.916 0 8.889 0.944 12.81 1.98 43.496 12.644 91.012 19.53 139.48 19.53 235.372 0 427.24-157.158 427.24-351.294 0-58.58-17.78-114.143-48.467-163.003l-491.39 280.07-2.963 1.98z" fill="#09BB07"></path></svg>
            </div>
            <span class="pay-name">微信支付</span>
            <div class="pay-badge" style="background-color: #f39c12; color: #fff;">开发中</div>
          </label>
          <label :class="['pay-method', { active: paymentMethod === 'unionpay', disabled: true }]">
            <input type="radio" v-model="paymentMethod" value="unionpay" class="hidden-radio" disabled />
            <div class="pay-icon unionpay">
              <svg class="icon" viewBox="0 0 1024 1024" width="28" height="28" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M229.643 233.89c-26.054 3.28-52.107 24.846-60.636 49.688-5.683 15.47-107.536 454.219-108.005 462.19-0.949 22.968 12.314 39.844 34.104 44.064 8.055 1.874 266.703 1.874 275.232 0 24.631-4.69 47.843-23.908 56.372-47.345 3.316-8.906 108.48-456.093 108.48-463.595 1.422-21.096-11.372-38.44-31.738-44.533-4.739-0.934-262.912-1.874-273.81-0.47z" fill="#E60012"></path><path d="M470.762 233.89c-26.054 3.28-52.107 24.846-60.632 49.688-5.214 15.47-107.534 454.219-107.534 462.19-0.95 22.968 12.314 39.844 34.108 44.064 8.05 1.874 266.698 1.874 275.227 0 24.635-4.69 47.847-23.908 56.372-47.345 3.317-8.906 108.479-456.093 108.479-463.595 1.424-21.096-11.366-38.44-31.736-44.533-5.214-0.934-263.387-1.874-274.284-0.47z" fill="#00508E"></path><path d="M722.308 233.89c-26.054 3.28-52.112 24.846-60.637 49.688-5.209 15.47-107.534 454.219-107.534 462.19-0.945 22.968 12.32 39.844 34.108 44.064 8.055 1.874 200.383 1.874 208.908 0 24.634-4.69 47.847-23.908 56.372-47.345 3.316-8.906 108.484-456.093 108.484-463.595 1.418-21.096-11.371-38.44-31.743-44.533-4.734-1.404-220.748-2.343-231.645-0.934h23.687v0.465z" fill="#00908C"></path><path d="M221.589 376.39c0 0.47-0.476 3.282-1.42 6.095-10.896 36.562-21.793 85.781-20.37 91.874 3.79 18.283 30.793 16.876 40.266-2.343 2.842-5.154 23.212-90.936 23.212-97.028 0-0.47 32.212 0 32.212 0.464 0 0 0 1.408-0.475 2.817-0.474 1.403-5.683 21.091-11.366 44.529-12.795 49.688-14.213 54.842-20.845 64.686-21.793 31.878-94.746 30.94-100.429-1.404-1.422-7.032 14.213-88.124 21.32-110.159 0-1.403 37.895-0.469 37.895 0.47z m484.139 0c21.79 4.69 28.42 22.03 18.472 47.816-9.947 25.78-31.262 37.028-68.686 37.028-11.371 0-10.423-1.874-17.529 33.282-1.419 6.562-2.841 12.656-2.841 13.594-0.476 2.343-34.11 2.343-33.635 0 28.426-120.468 30.793-130.78 30.793-131.72l0.474-1.402h34.104c27.003 0.464 34.583 0.464 38.848 1.403z m-292.282 46.408c4.735 0.938 8.05 4.69 8.05 7.97 0 11.717-24.16 19.688-33.16 10.779-8.525-8.905 9.475-22.5 25.11-18.75z m-83.849 8.904c0 0.94-0.474 2.817-0.474 4.22l-0.474 1.878 5.683-2.816c15.16-7.497 29.844-6.094 34.583 3.281 2.841 5.629 2.367 8.91-5.21 43.595-1.422 6.094-3.315 14.534-3.79 18.748-1.897 9.38-0.474 8.91-17.528 8.91-14.687 0-14.687 0-14.212-1.408 0-0.938 1.896-8.435 3.79-17.345 7.58-33.277 8.055-37.967 1.422-37.967-3.79 0-9.004 2.343-9.473 3.75-0.948 3.282-9.478 44.06-9.952 47.812l-0.945 4.22-14.687 0.938c-17.998 0.47-16.58 1.873-12.79-14.064 5.21-20.626 8.055-35.154 9.949-48.28 2.367-14.063 0.948-12.655 14.212-14.532 6.158-0.94 12.315-1.874 14.213-2.343 4.735-1.409 5.683-0.94 5.683 1.403z m225.014-0.464c0 0.933-0.474 2.811-0.474 4.216l-0.476 2.346 5.688-2.816c29.37-14.998 40.737-2.813 32.212 35.628-1.893 8.436-4.265 20.623-5.683 26.25-0.949 6.094-2.372 11.248-2.842 11.717-1.898 1.874-29.844 1.41-29.375 0 0-0.938 1.898-8.435 3.791-16.875 8.056-34.216 8.056-38.436 0.949-38.436-5.683 0-8.525 1.873-9.473 6.092-1.424 5.155-8.53 38.906-9.475 45l-0.948 5.158-14.687 0.47c-17.999 0.465-16.58 2.342-12.316-15.003 4.74-18.75 8.056-36.094 10.423-48.749 1.893-12.187 0.474-10.782 12.315-12.656 5.213-0.938 11.846-1.878 14.214-2.342 4.738-2.348 6.157-1.878 6.157 0z m287.547-0.47c1.892 28.592 2.368 37.028 2.368 37.498 0 0.47 4.264-7.032 8.999-16.406 9.473-18.749 7.58-16.876 18.002-18.28 2.842-0.469 8.525-1.409 12.79-2.342 10.423-1.878 10.423-2.817-1.423 17.81-16.105 27.658-38.368 66.564-46.423 80.627-24.157 43.591-24.157 43.591-44.527 44.06l-12.316 0.47 0.945-3.282c0.474-1.873 1.897-5.623 2.37-8.435l1.42-5.159h3.79c4.265 0 5.209-0.94 9-7.502 1.423-2.342 3.79-6.093 4.738-8.435 1.42-2.343 6.158-9.844 9.949-17.345l7.58-13.125-1.897-17.34c-2.367-20.158-5.209-44.065-6.631-51.097-0.95-6.562-0.95-6.562 7.58-7.5 3.79-0.466 9.948-1.874 13.264-2.343 8.999-2.812 9.947-2.812 10.422-1.874z m-357.183 0.47c36.476 6.562 23.686 69.37-16.106 78.28-27.003 6.094-45.475-4.22-45.475-24.847 0.47-36.093 27.472-59.53 61.58-53.433z m272.86 1.873c1.893 0.938 4.739 2.812 6.158 4.22 2.367 2.342 2.367 2.342 2.367 0.934 0.475-1.873 0-1.873 18.951-4.685 15.158-2.342 14.684-2.342 13.739 1.874-6.158 26.249-11.371 49.217-13.739 60.47-3.315 16.876-0.948 14.998-19.421 14.529h-15.635v-1.874c0-1.873-0.945-2.812-1.894-1.407-5.213 8.44-30.792 5.158-37.898-5.155-17.525-26.25 19.896-81.562 47.371-68.906z m-340.129 13.595s0 2.342-0.474 4.219c-3.786 14.999-10.418 45.469-11.842 51.092l-1.422 7.032-15.632 0.469c-18.472 0.47-17.528 1.404-13.738-9.843 3.316-10.783 6.633-23.908 8.53-37.972 1.892-12.186 0-10.313 13.738-12.186 6.157-0.94 12.79-1.873 14.208-2.342 3.79-0.939 6.158-0.939 6.632-0.47z m82.9 97.028c0 0.47-0.944 2.348-2.367 4.69-0.95 2.342-2.367 4.22-2.367 4.22 27.946 0.464 28.895 0.464 28.42 1.873l-5.209 16.876h-40.74l-2.367 1.873c-5.214 4.689-32.686 10.782-32.686 7.031l5.21-16.875h3.789c6.632 0 8.05-1.404 13.738-11.247l4.735-8.91c24.636-0.465 29.843 0 29.843 0.47z m62.06 0c0 0.47-0.475 2.812-1.424 5.629-0.948 2.342-1.417 4.685-1.417 5.154 0 0 2.366-0.94 5.207-3.28 10.423-7.033 19.422-8.437 45.95-8.437 10.423 0 19.422 0 19.896 0.465 0.475 0.939-15.156 51.565-17.528 56.25-3.316 6.098-6.633 9.379-11.84 11.721l-4.74 1.874-26.998 0.47-27.003 0.468-4.738 15.937c-9.474 30.47-9.474 28.128 4.264 26.72 10.897-0.94 10.423-1.873 7.107 9.374l-2.842 9.375h-13.738c-29.844 0.47-33.634-1.404-30.793-13.594 1.423-6.094 35.528-117.656 36.002-118.595 0.474-0.465 24.635-0.465 24.635 0.47z m124.584 0c0 0.47-0.474 1.877-0.944 3.75-1.423 4.69-1.423 4.69 4.735 1.41 8.054-4.221 27.002-5.629 65.845-5.629h12.32v5.629c0 6.562 0.475 7.03 6.158 7.966l4.264 0.469-2.372 8.44-2.366 8.435h-8.53c-21.789 0.47-25.104-1.873-25.58-14.528v-6.098l-1.418 4.22-1.423 4.69H733.2c-2.367 0-4.735 0-4.735 0.47 0 0-23.211 76.401-26.528 87.184-0.474 0.94 0 1.409 2.843 1.409 4.264 0 4.264 0 2.841 3.745-1.419 4.221-1.419 4.221 3.316 4.221 3.316 0 5.214-0.47 7.58-1.873 3.317-1.878 3.317-1.408 18.473-22.5l6.158-8.909h-12.79c-15.631 0-14.207 0.939-11.366-8.435l2.367-7.502h31.268c2.841-9.844 3.785-12.656 3.785-13.125 0-0.47-6.632-0.47-15.156-0.47h-15.158l4.735-16.875h42.633c23.212 0 42.638 0 42.638 0.47 0 0.469-0.948 4.22-2.37 8.44l-2.368 7.966-14.213 0.469-14.21 0.469c-2.37 7.032-3.315 10.313-3.789 11.252l-0.474 1.873h13.738c16.106 0 15.157-0.938 11.84 8.436l-2.367 7.501h-31.266l-4.735 5.624h12.316l1.892 11.252c1.898 12.656 1.898 12.656 8.055 12.656 4.74 0 4.74-0.94 1.424 10.312l-2.847 9.375h-8.999c-15.631 0-18.473-2.342-21.32-18.28l-1.418-10.313-5.683 7.502c-15.636 21.091-16.58 21.56-36.476 21.56-12.794 0-12.794 0-10.897-3.75 0.475-1.873 0.475-1.873-3.316-1.873-3.79 0-3.79 0-4.738 2.812l-0.475 2.811H666.88l0.474-1.408c1.424-4.684 3.79-4.215-25.105-4.215-25.109 0-26.527 0-26.053-1.409l2.368-8.435c2.841-8.44 2.367-8.44 5.209-8.44 2.37 0 2.37 0 3.315-3.281 22.268-73.592 29.374-97.03 30.319-100.31l1.897-6.094h13.264c8.525 0 14.682 0.465 14.682 0.934z m-168.167 40.314l-5.213 16.406h-28.42c-2.842 9.375-3.79 12.187-4.266 13.125-0.474 1.409 0.475 1.409 14.214 1.409 8.054 0 14.686 0.47 14.686 0.47 0 0.464-0.474 1.402-0.95 2.81-0.473 0.935-1.422 4.686-2.365 8.436l-1.898 6.093H475.5l-3.316 11.252c-4.738 15.937-4.264 16.406 13.738 14.064 7.581-0.939 7.107-1.877 3.79 9.375l-2.841 9.374h-19.9c-31.263 0-31.737-0.939-23.212-27.658 2.372-8.436 4.74-15.468 4.74-15.468s-3.317-0.47-8.056-0.47c-4.26 0-8.05 0-8.05-0.469 3.315-11.716 4.734-15.468 4.734-16.406 0.474-0.934 1.423-1.403 8.53-1.403h8.05l3.79-14.534h-7.576c-5.688 0-7.58 0-7.58-0.939 0-0.933 4.264-14.528 4.733-15.937 0.95-0.933 72.483-0.469 72.008 0.47z m91.9 33.752c0 0.938-0.949 3.75-1.42 6.093-2.846 13.125-6.631 15.937-21.792 16.875-5.209 0.47-9.948 0.938-9.948 0.938-0.949 1.405-0.949 12.657 0 14.53l1.423 1.877 9.473-0.47c5.21-0.469 9.474-0.469 9.474-0.469 0 0.939-5.21 17.345-5.684 17.81-0.948 0.94-29.843 0.47-33.634-0.934-5.683-1.878-5.683-1.409-5.214-30.94l0.476-25.78h24.16v9.844h4.74c5.208 0 5.682-0.47 8.05-7.033l1.422-3.75h9.475c8.524 0.47 9.473 0.47 8.999 1.409z m44.53-200.626l-5.213 22.5h7.107c36.476 0.938 51.637-40.784 16.105-43.596-5.684-0.47-10.893-0.939-11.367-0.939-1.422 0-1.422 1.41-6.631 22.035z m-188.542 31.874c-8.999 3.75-17.524 37.501-10.417 42.656 5.208 4.22 12.79-2.812 16.58-14.529 6.158-21.565 4.26-31.878-6.163-28.127z m282.339 2.342c-9.478 4.69-16.58 37.971-9.478 41.721 9.478 5.155 21.794-12.654 21.794-31.877 0-8.905-5.214-13.125-12.316-9.844zM557.927 562.957l-2.368 8.436c-1.422 4.22-2.367 7.97-2.841 8.435 0 0.47 2.367-0.465 5.683-2.343 9.473-4.685 12.316-5.623 26.053-6.092l11.846-0.47c1.893-5.623 2.368-7.966 2.368-8.435 0.474-0.47-40.267-0.47-40.741 0.47z m-8.05 27.185l-1.899 7.5 40.741-0.47 2.368-7.5c-32.212 0-41.21 0-41.21 0.47z m128.848-16.876c-1.896 6.097-3.315 10.782-2.841 10.782l5.683-1.873c2.842-0.94 8.055-2.347 10.897-2.812 2.841-0.469 5.209-0.94 5.683-0.94 0 0 4.74-14.532 4.74-15.001 0 0-4.74-0.465-10.423-0.465H682.04l-3.316 10.31z m-7.58 23.907c0 0.469-1.893 5.159-3.317 10.782-1.892 5.624-3.315 10.783-3.315 10.783 0 0.465 2.367-0.47 5.683-1.878 3.316-1.403 8.055-2.812 10.897-3.28 6.157-0.94 6.631-1.404 7.107-3.751 0.474-0.935 1.422-4.685 2.366-7.497l1.898-5.628H682.04c-5.683 0-10.897 0-10.897 0.469z m-16.58 53.908l20.845 0.47c4.264-14.064 5.683-18.754 5.683-19.223l-20.844-0.934-5.684 19.687z" fill="#FFFFFF"></path></svg>
            </div>
            <span class="pay-name">云闪付</span>
            <div class="pay-badge" style="background-color: #f39c12; color: #fff;">开发中</div>
          </label>
          <label class="pay-method" :class="{ active: paymentMethod === 'personal_qrcode' }">
            <input type="radio" v-model="paymentMethod" value="personal_qrcode" class="hidden-radio" />
            <div class="pay-icon personal_qrcode">
              <svg viewBox="0 0 1024 1024" width="28" height="28"><path d="M384 128H128v256h256V128z m-64 192H192V192h128v128zM896 128H640v256h256V128z m-64 192H704V192h128v128zM384 640H128v256h256V640z m-64 192H192V704h128v128zM640 640h64v64h-64zM704 704h64v64h-64zM768 640h128v64H768zM832 704h64v192h-64zM640 768h128v64H640zM768 832h64v64h-64zM640 832h64v64h-64zM448 128h128v128H448zM448 384h64v64h-64zM512 448h64v128h-64zM448 576h64v64h-64zM448 768h128v128H448zM576 256h64v192h-64zM640 448h64v128h-64zM704 448h192v128H704zM832 384h64v64h-64zM128 448h256v128H128zM320 576h64v64h-64z" fill="#4f46e5"/></svg>
            </div>
            <span class="pay-name">客户主扫收款码</span>
            <div class="check-icon" v-if="paymentMethod === 'personal_qrcode'">✓</div>
          </label>
          <label class="pay-method" :class="{ active: paymentMethod === 'cash' }">
            <input type="radio" v-model="paymentMethod" value="cash" class="hidden-radio" />
            <div class="pay-icon cash">
              <svg viewBox="0 0 1024 1024" width="28" height="28"><path d="M885.333 256c-17.066 0-32-14.933-32-32s14.934-32 32-32h42.667c35.413 0 64 28.587 64 64v42.667c0 17.066-14.933 32-32 32s-32-14.934-32-32V256h-42.667zM138.667 256v42.667c0 17.066-14.934 32-32 32s-32-14.934-32-32V256c0-35.413 28.587-64 64-64h42.666c17.067 0 32 14.933 32 32s-14.933 32-32 32h-42.666zM885.333 768h42.667v-42.667c0-17.066 14.933-32 32-32s32 14.934 32 32V768c0 35.413-28.587 64-64 64h-42.667c-17.066 0-32-14.933-32-32s14.934-32 32-32zM138.667 768h42.666c17.067 0 32 14.933 32 32s-14.933 32-32 32h-42.666c-35.413 0-64-28.587-64-64v-42.667c0-17.066 14.934-32 32-32s32 14.934 32 32V768zM512 682.667c-94.293 0-170.667-76.374-170.667-170.667S417.707 341.333 512 341.333 682.667 417.707 682.667 512 606.293 682.667 512 682.667z m0-277.334c-58.88 0-106.667 47.787-106.667 106.667s47.787 106.667 106.667 106.667 106.667-47.787 106.667-106.667-47.787-106.667-106.667-106.667zM341.333 768H682.667c17.066 0 32 14.933 32 32s-14.934 32-32 32H341.333c-17.066 0-32-14.933-32-32s14.934-32 32-32zM341.333 192H682.667c17.066 0 32 14.933 32 32s-14.934 32-32 32H341.333c-17.066 0-32-14.933-32-32s14.934-32 32-32zM213.333 384c17.067 0 32 14.933 32 32v192c0 17.066-14.933 32-32 32s-32-14.934-32-32V416c0-17.067 14.933-32 32-32zM810.667 384c17.066 0 32 14.933 32 32v192c0 17.066-14.934 32-32 32s-32-14.934-32-32V416c0-17.067 14.934-32 32-32z" fill="#f59e0b"/></svg>
            </div>
            <span class="pay-name">现金收款</span>
            <div class="check-icon" v-if="paymentMethod === 'cash'">✓</div>
          </label>
        </div>
      </div>

      <!-- 快捷键提示 -->
      <div class="action-footer">
        <button 
          @click="checkout" 
          class="btn btn-checkout" 
          :disabled="cart.length === 0 || !isPaymentEnabled(paymentMethod) || showPayOverlay || isFinalizing"
        >
          <span class="checkout-text">结账收款</span>
          <span class="checkout-shortcut">Enter</span>
        </button>
        
        <div class="shortcuts-panel">
          <div class="shortcut-tag"><kbd>F1</kbd> 挂单</div>
          <div class="shortcut-tag"><kbd>F2</kbd> 取单</div>
          <div class="shortcut-tag"><kbd>ESC</kbd> 清空</div>
        </div>
      </div>
    </div>

    <!-- 结账成功全屏动画遮罩 -->
    <div class="success-overlay" :class="{ 'is-active': showSuccessOverlay }">
      <div class="success-content" v-if="successData">
        <div class="success-icon-wrapper">
          <div class="success-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          </div>
          <div class="rings">
            <div class="ring ring-1"></div>
            <div class="ring ring-2"></div>
          </div>
        </div>
        
        <h2 class="success-title">结账成功</h2>
        
        <div class="success-receipt">
          <div class="receipt-row">
            <span class="r-label">订单金额</span>
            <span class="r-value amount">¥ {{ successData.amount }}</span>
          </div>
          <div class="receipt-row">
            <span class="r-label">商品件数</span>
            <span class="r-value">{{ successData.items }} 件</span>
          </div>
          <div class="receipt-row">
            <span class="r-label">支付方式</span>
            <span class="r-value method">
              {{ successData.payMethod === 'wechat' ? '微信支付' : successData.payMethod === 'alipay' ? '支付宝' : successData.payMethod === 'unionpay' ? '云闪付' : '现金收款' }}
            </span>
          </div>
          <div class="receipt-row" v-if="successData.confirmedVia">
            <span class="r-label">确认来源</span>
            <span class="r-value">{{ successData.confirmedVia === 'callback' ? '回调' : successData.confirmedVia === 'polling' ? '轮询' : successData.confirmedVia === 'cash' ? '现金' : successData.confirmedVia === 'manual' ? '人工' : successData.confirmedVia === 'reconcile' ? '补偿' : successData.confirmedVia }}</span>
          </div>
          <div class="receipt-divider"></div>
          <div class="receipt-row text-small">
            <span class="r-label">订单编号</span>
            <span class="r-value">{{ successData.orderId }}</span>
          </div>
        </div>

        <div class="success-hint">
          <p>请扫描下一件商品或按任意键继续...</p>
          <div class="progress-bar">
            <div class="progress-inner"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="weight-overlay" :class="{ 'is-active': showWeightModal }" @click.self="cancelWeight">
      <div class="weight-modal" v-if="showWeightModal">
        <div class="weight-header">
          <div class="weight-title">称重输入</div>
          <button class="weight-close" @click="cancelWeight">×</button>
        </div>
        <div class="weight-body">
          <div class="weight-product">
            <div class="w-name">{{ weightProduct?.name }}</div>
            <div class="w-meta">
              <span class="w-tag">称重商品</span>
              <span class="w-price">¥ {{ weightProduct?.retail_price?.toFixed?.(2) }} / {{ weightProduct?.unit }}</span>
            </div>
          </div>
          <div class="weight-input-row">
            <input
              ref="weightInputRef"
              v-model="weightValue"
              type="number"
              step="0.001"
              min="0"
              class="weight-input"
              :placeholder="`请输入重量（${weightProduct?.unit}）`"
              @keyup.enter="confirmWeight"
            />
            <div class="weight-unit">{{ weightProduct?.unit }}</div>
          </div>
          <div class="weight-hint">放上电子秤后输入重量，回车确认</div>
        </div>
        <div class="weight-footer">
          <button class="btn btn-secondary" @click="cancelWeight">取消</button>
          <button class="btn btn-primary" @click="confirmWeight">确认</button>
        </div>
      </div>
    </div>

    <div class="pay-overlay" :class="{ 'is-active': showPayOverlay }" @click.self="cancelPayOverlay">
      <div class="pay-modal" v-if="showPayOverlay">
        <div class="pay-header">
          <div class="pay-title">等待付款</div>
          <button class="pay-close" @click="cancelPayOverlay">×</button>
        </div>

        <div class="pay-body">
          <div class="pay-amount">
            <span class="currency">¥</span>
            <span class="amount">{{ Number(pendingOrder?.total_amount || 0).toFixed(2) }}</span>
          </div>

          <div class="pay-method-hint">
            <span class="tag">{{ paymentMethod === 'wechat' ? '微信支付' : paymentMethod === 'alipay' ? '支付宝' : '云闪付' }}</span>
            <span class="text-muted" v-if="paymentMethod !== 'alipay'">暂未接入真实支付接口，将以手动确认模拟流程</span>
            <span class="text-muted" v-else>{{ isPayPolling ? '轮询中：等待支付结果...' : '准备收款：直接用扫码枪扫顾客付款码，或让顾客扫下方二维码' }}</span>
          </div>

          <div class="pay-panel">
            <div v-if="paymentMethod === 'alipay'" class="qr-wrap">
              <div v-if="alipayQrImg" class="qr-card">
                <img :src="alipayQrImg" alt="支付宝收款码" class="qr-img" />
                <div class="qr-meta">
                  <div class="qr-desc">若未弹出收款码，可点击“重新生成二维码”</div>
                  <div class="qr-actions">
                    <button class="btn btn-secondary" type="button" @click="createAlipayQr" :disabled="isPayCreating">重新生成二维码</button>
                    <button class="btn btn-secondary" type="button" @click="pollAlipayStatus">刷新状态</button>
                  </div>
                </div>
              </div>
              <div v-else class="panel-box">
                <div class="panel-icon">⏳</div>
                <div class="panel-desc">
                  <div>{{ isPayCreating ? '生成中...' : '尚未生成收款码' }}</div>
                  <button class="btn btn-secondary" type="button" style="margin-top: 10px;" @click="createAlipayQr" :disabled="isPayCreating">
                    重新生成二维码
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="panel-box">
              <div class="panel-icon">🔳</div>
              <div class="panel-desc">该支付方式尚未接入真实接口</div>
            </div>
          </div>
        </div>

        <div class="pay-footer">
          <button class="btn btn-secondary" @click="cancelPayOverlay">取消</button>
          <button v-if="paymentMethod !== 'alipay'" class="btn btn-primary" @click="finalizeOrder" :disabled="isFinalizing">
            {{ isFinalizing ? '处理中...' : '确认已收款' }}
          </button>
          <button v-else class="btn btn-primary" @click="pollAlipayStatus" :disabled="isPayCreating || isFinalizing">
            刷新支付状态
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pos-container {
  display: flex;
  height: 100vh;
  background-color: var(--bg-color);
  padding: 20px;
  gap: 20px;
}

/* 左侧购物车 */
.cart-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0; /* 防止子元素溢出 */
}

.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  padding: 16px 24px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-main);
}

.scan-box {
  display: flex;
  gap: 12px;
  width: 500px;
}

.scan-input-wrapper {
  position: relative;
  flex: 1;
}

.scan-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 16px;
}

.scan-input {
  width: 100%;
  padding: 12px 16px 12px 40px;
  font-size: 15px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all 0.2s ease;
  background-color: var(--bg-color);
}

.scan-input:focus {
  border-color: var(--primary);
  background-color: var(--surface);
  box-shadow: 0 0 0 4px var(--primary-light);
}

.btn-lg {
  padding: 0 24px;
  font-size: 15px;
}

/* 购物车表格卡片 */
.cart-card {
  flex: 1;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cart-list-wrapper {
  flex: 1;
  overflow-y: auto;
}

.cart-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.cart-table th {
  background-color: var(--bg-color);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 16px 24px;
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border-color);
}

.cart-row td {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}

.cart-row:last-child td {
  border-bottom: none;
}

.cart-row:hover td {
  background-color: #f8fafc;
}

.product-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.p-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-main);
  display: flex;
  align-items: center;
}

.p-code {
  font-size: 13px;
  color: var(--text-muted);
  font-family: monospace;
}

.badge-weighing {
  background-color: var(--warning-bg);
  color: #b45309;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 8px;
  font-weight: bold;
}

.p-price {
  font-weight: 500;
  color: var(--text-main);
}
.p-unit {
  color: var(--text-muted);
  font-size: 13px;
}

.qty-control {
  display: inline-flex;
  align-items: center;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.weighing-qty {
  padding: 6px 12px;
  background: var(--primary-light);
  border-color: #c7d2fe;
  color: var(--primary-hover);
}

.qty-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.qty-btn:hover {
  background: #e2e8f0;
}

.qty-num {
  min-width: 36px;
  text-align: center;
  font-weight: 600;
  font-size: 14px;
}

.p-subtotal {
  font-weight: 700;
  color: var(--danger);
  font-size: 16px;
}

.action-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all 0.2s;
}
.delete-btn:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.empty-cart {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  color: var(--text-muted);
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* 右侧结算区 */
.checkout-section {
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card-title {
  margin: 0 0 20px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.summary-card, .payment-card {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  font-size: 15px;
}
.summary-item .label {
  color: var(--text-muted);
}
.summary-item .value {
  font-weight: 600;
  color: var(--text-main);
}

.total-row {
  margin-bottom: 0;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color);
  align-items: flex-end;
}
.total-row .label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
  padding-bottom: 4px;
}
.total-price {
  color: var(--danger);
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.total-price .currency {
  font-size: 20px;
  font-weight: 600;
}
.total-price .amount {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -1px;
}

/* 支付方式 */
.pay-methods {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hidden-radio {
  display: none;
}

.pay-method {
  position: relative;
  display: flex;
  align-items: center;
  padding: 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--surface);
}

.pay-method:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.pay-method.disabled {
  cursor: not-allowed;
  background: #f8fafc;
}

.pay-method.disabled .pay-icon {
  filter: grayscale(100%) opacity(0.6);
}

.pay-method.disabled .pay-name {
  color: var(--text-muted);
}

.pay-method.disabled:hover {
  border-color: var(--border-color);
  background: #f1f5f9;
}

.pay-method.active {
  border-color: var(--primary);
  background: var(--primary-light);
}

.pay-badge {
  position: absolute;
  right: 16px;
  font-size: 12px;
  font-weight: 900;
  color: #b45309;
  background: var(--warning-bg);
  border: 1px solid rgba(245, 158, 11, 0.35);
  padding: 6px 10px;
  border-radius: 999px;
}

.pay-icon {
  font-size: 24px;
  margin-right: 16px;
}

.pay-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
}

.check-icon {
  position: absolute;
  right: 16px;
  color: var(--primary);
  font-weight: bold;
  font-size: 18px;
}

.action-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.btn-checkout {
  width: 100%;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: white;
  border: none;
  padding: 20px;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.4);
}

.btn-checkout:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 15px 30px -5px rgba(79, 70, 229, 0.5);
}

.btn-checkout:active:not(:disabled) {
  transform: translateY(0);
}

.btn-checkout:disabled {
  background: #cbd5e1;
  box-shadow: none;
  transform: none;
}

.checkout-text {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
}

.checkout-shortcut {
  font-size: 12px;
  opacity: 0.8;
  background: rgba(255,255,255,0.2);
  padding: 2px 8px;
  border-radius: 12px;
}

.shortcuts-panel {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.shortcut-tag {
  font-size: 13px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

kbd {
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  font-family: monospace;
  font-weight: 600;
  box-shadow: 0 1px 1px rgba(0,0,0,0.05);
}

/* 全屏结账成功动画 */
.success-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(248, 250, 252, 0.95);
  backdrop-filter: blur(10px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  transform: scale(1.05);
}

.success-overlay.is-active {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}

.success-content {
  background: var(--surface);
  padding: 40px 60px;
  border-radius: 24px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateY(30px);
  opacity: 0;
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s;
  min-width: 400px;
}

.success-overlay.is-active .success-content {
  transform: translateY(0);
  opacity: 1;
}

.success-icon-wrapper {
  position: relative;
  width: 100px;
  height: 100px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-icon {
  width: 80px;
  height: 80px;
  background: var(--success);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  z-index: 2;
  box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4);
  transform: scale(0);
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s;
}

.success-overlay.is-active .success-icon {
  transform: scale(1);
}

.success-icon svg {
  width: 40px;
  height: 40px;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  transition: stroke-dashoffset 0.6s ease-out 0.6s;
}

.success-overlay.is-active .success-icon svg {
  stroke-dashoffset: 0;
}

.ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid var(--success);
  opacity: 0;
}

.success-overlay.is-active .ring-1 {
  animation: ripple 1.5s ease-out 0.4s;
}

.success-overlay.is-active .ring-2 {
  animation: ripple 1.5s ease-out 0.6s;
}

@keyframes ripple {
  0% { width: 80px; height: 80px; opacity: 0.5; }
  100% { width: 180px; height: 180px; opacity: 0; border-width: 0px; }
}

.success-title {
  font-size: 28px;
  font-weight: 800;
  color: var(--text-main);
  margin: 0 0 24px 0;
}

.success-receipt {
  width: 100%;
  background: var(--bg-color);
  padding: 24px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.r-label {
  color: var(--text-muted);
  font-size: 15px;
}

.r-value {
  font-weight: 600;
  color: var(--text-main);
  font-size: 16px;
}

.r-value.amount {
  font-size: 28px;
  color: var(--danger);
  font-weight: 800;
}

.r-value.method {
  color: var(--primary);
  background: var(--primary-light);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 14px;
}

.receipt-divider {
  height: 1px;
  border-top: 2px dashed var(--border-color);
  margin: 4px 0;
}

.receipt-row.text-small .r-label,
.receipt-row.text-small .r-value {
  font-size: 13px;
  font-family: monospace;
}

.success-hint {
  margin-top: 32px;
  text-align: center;
  width: 100%;
}

.success-hint p {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0 0 12px 0;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: var(--bg-color);
  border-radius: 2px;
  overflow: hidden;
}

.progress-inner {
  height: 100%;
  background: var(--primary);
  width: 100%;
  transform-origin: left;
}

.success-overlay.is-active .progress-inner {
  animation: shrink 10s linear forwards;
}

@keyframes shrink {
  0% { transform: scaleX(1); }
  100% { transform: scaleX(0); }
}

.weight-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(6px);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}

.weight-overlay.is-active {
  opacity: 1;
  pointer-events: auto;
}

.pay-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 11000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.pay-overlay.is-active {
  opacity: 1;
  pointer-events: auto;
}

.pay-modal {
  width: min(520px, calc(100vw - 32px));
  background: var(--surface);
  border-radius: 18px;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.pay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-color);
}

.pay-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-main);
}

.pay-close {
  border: 0;
  background: transparent;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 20px;
  color: var(--text-muted);
}

.pay-close:hover {
  background: #f1f5f9;
  color: var(--text-main);
}

.pay-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pay-amount {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  color: var(--danger);
}

.pay-amount .currency {
  font-size: 18px;
  font-weight: 800;
}

.pay-amount .amount {
  font-size: 44px;
  font-weight: 1000;
  line-height: 1;
  letter-spacing: -1px;
}

.pay-method-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
  padding: 10px 12px;
  border-radius: 14px;
}

.pay-method-hint .tag {
  font-size: 12px;
  font-weight: 900;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary);
  white-space: nowrap;
}

.pay-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.pay-actions .btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.pay-panel .panel-title {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-main);
  margin-bottom: 10px;
}

.qr-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qr-card {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.qr-img {
  width: 150px;
  height: 150px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid var(--border-color);
}

.qr-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.qr-desc {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
  line-height: 1.5;
}

.qr-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.qr-actions .btn {
  flex: 1;
}

.panel-box {
  border: 1px dashed rgba(148, 163, 184, 0.7);
  background: #f8fafc;
  border-radius: 16px;
  padding: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
  font-size: 20px;
  font-weight: 900;
}

.panel-desc {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
}

.scan-pay-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  font-size: 14px;
  outline: none;
  background: var(--surface);
}

.scan-pay-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.pay-footer {
  display: flex;
  gap: 12px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border-color);
}

.pay-footer .btn {
  flex: 1;
}

.weight-modal {
  width: 420px;
  max-width: calc(100vw - 32px);
  background: var(--surface);
  border-radius: 18px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  transform: translateY(20px) scale(0.96);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.weight-overlay.is-active .weight-modal {
  transform: translateY(0) scale(1);
}

.weight-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-color);
}

.weight-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-main);
}

.weight-close {
  border: none;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 10px;
}

.weight-close:hover {
  background: var(--bg-color);
  color: var(--text-main);
}

.weight-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.weight-product .w-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: 6px;
}

.w-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

.w-tag {
  background: var(--warning-bg);
  color: #b45309;
  border-radius: 8px;
  padding: 4px 8px;
  font-weight: 700;
}

.w-price {
  font-family: monospace;
}

.weight-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.weight-input {
  flex: 1;
  padding: 14px 14px;
  border: 2px solid var(--border-color);
  border-radius: 12px;
  font-size: 18px;
  font-weight: 700;
  outline: none;
}

.weight-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-light);
}

.weight-unit {
  min-width: 56px;
  text-align: center;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 10px;
  font-weight: 700;
  color: var(--text-main);
}

.weight-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.weight-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-color);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-secondary {
  background: white;
  border: 1px solid var(--border-color);
  color: var(--text-main);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-color);
}

@media (max-width: 900px) {
  .pos-container {
    flex-direction: column;
    height: auto;
    padding: 14px;
    gap: 14px;
  }

  .checkout-section {
    width: 100%;
  }

  .header-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .scan-box {
    width: 100%;
    flex-direction: column;
  }

  .btn-lg {
    width: 100%;
    height: 44px;
  }

  .cart-list-wrapper {
    overflow-x: auto;
  }

  .cart-table {
    min-width: 720px;
  }
}
</style>
