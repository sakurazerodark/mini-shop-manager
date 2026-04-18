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
          <label :class="['pay-method', { active: paymentMethod === 'wechat', disabled: true }]">
            <input type="radio" v-model="paymentMethod" value="wechat" class="hidden-radio" disabled />
            <div class="pay-icon wechat">💬</div>
            <span class="pay-name">微信支付</span>
            <div class="pay-badge" style="background-color: #f39c12; color: #fff;">开发中</div>
          </label>
          <label :class="['pay-method', { active: paymentMethod === 'alipay', disabled: !isPaymentEnabled('alipay') }]">
            <input type="radio" v-model="paymentMethod" value="alipay" class="hidden-radio" :disabled="!isPaymentEnabled('alipay')" />
            <div class="pay-icon alipay">💳</div>
            <span class="pay-name">支付宝</span>
            <div class="pay-badge" v-if="!isPaymentEnabled('alipay')">未配置</div>
            <div class="check-icon" v-if="paymentMethod === 'alipay' && isPaymentEnabled('alipay')">✓</div>
          </label>
          <label :class="['pay-method', { active: paymentMethod === 'unionpay', disabled: true }]">
            <input type="radio" v-model="paymentMethod" value="unionpay" class="hidden-radio" disabled />
            <div class="pay-icon unionpay">🏦</div>
            <span class="pay-name">云闪付</span>
            <div class="pay-badge" style="background-color: #f39c12; color: #fff;">开发中</div>
          </label>
          <label class="pay-method" :class="{ active: paymentMethod === 'cash' }">
            <input type="radio" v-model="paymentMethod" value="cash" class="hidden-radio" />
            <div class="pay-icon cash">💵</div>
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
  opacity: 0.55;
  cursor: not-allowed;
  background: #f1f5f9;
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
