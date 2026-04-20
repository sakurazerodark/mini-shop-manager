<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getTodayStats, getRecentOrders, getOrders, manualPayOrder as apiManualPayOrder, cancelOrder as apiCancelOrder, getOrder, refundOrder } from '../api/orders'
import { formatDateTime } from '../utils/format'

const route = useRoute()
const currentTab = computed(() => route.query.tab || 'dashboard')

// Dashboard
  const todayStats = ref({
    total_orders: 0,
    total_revenue: 0,
    total_refunds: 0,
    refund_orders: 0
  })
const recentOrders = ref([])

// Orders
const allOrders = ref([])
const ordersPage = ref(1)
const ordersTotalPages = ref(1)
const ordersLoading = ref(false)

// Payments
const paymentOrders = ref([])
const paymentsPage = ref(1)
const paymentsTotalPages = ref(1)
const paymentsLoading = ref(false)

// Detail modal
const showOrderDetail = ref(false)
const orderDetail = ref(null)
const orderDetailLoading = ref(false)

// Abnormal Orders
const abnormalOrders = ref([])
const abnormalPage = ref(1)
const abnormalTotalPages = ref(1)
const abnormalLoading = ref(false)

const fetchDashboard = async () => {
  try {
    const resStats = await getTodayStats().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (resStats.ok) {
      const data = await resStats.json()
      todayStats.value = data.data
    }

    const resOrders = await getRecentOrders().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (resOrders.ok) {
      const data = await resOrders.json()
      recentOrders.value = data.data
    }
  } catch (error) {
    console.error('获取报表数据失败:', error)
  }
}

const fetchOrders = async (page = 1) => {
  ordersLoading.value = true
  try {
    const res = await getOrders({ page, limit: 15 }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      allOrders.value = json.data
      ordersPage.value = json.page
      ordersTotalPages.value = json.total_pages
    }
  } catch (e) {
    console.error(e)
  } finally {
    ordersLoading.value = false
  }
}

const fetchPayments = async (page = 1) => {
  paymentsLoading.value = true
  try {
    const res = await getOrders({ type: 'payment', page, limit: 15 }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      paymentOrders.value = json.data
      paymentsPage.value = json.page
      paymentsTotalPages.value = json.total_pages
    }
  } catch (e) {
    console.error(e)
  } finally {
    paymentsLoading.value = false
  }
}

const fetchAbnormal = async (page = 1) => {
  abnormalLoading.value = true
  try {
    const res = await getOrders({ type: 'abnormal', page, limit: 15 }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      abnormalOrders.value = json.data
      abnormalPage.value = json.page
      abnormalTotalPages.value = json.total_pages
    }
  } catch (e) {
    console.error(e)
  } finally {
    abnormalLoading.value = false
  }
}

const confirmModal = ref({
  show: false,
  message: '',
  onConfirm: null
})

const showConfirm = (message, onConfirm) => {
  confirmModal.value = {
    show: true,
    message,
    onConfirm
  }
}

const closeConfirm = () => {
  confirmModal.value.show = false
  confirmModal.value.onConfirm = null
}

const handleConfirm = () => {
  if (confirmModal.value.onConfirm) {
    confirmModal.value.onConfirm()
  }
  closeConfirm()
}

const manualPayOrder = (orderId) => {
  showConfirm(`确认将订单 ${orderId} 手动标记为已支付并完成订单？`, async () => {
    try {
      const res = await apiManualPayOrder(orderId).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
      if (res.ok) {
        window.$toast('已转为支付完成', 'success')
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        window.$toast(data.error || '操作失败', 'error')
      }
    } catch (e) {
      console.error(e)
      window.$toast('网络错误', 'error')
    }
  })
}

const cancelAbnormalOrder = (orderId) => {
  showConfirm(`确认取消异常订单 ${orderId} 吗？如果有关联的支付订单也会尝试关闭。`, async () => {
    try {
      const res = await apiCancelOrder(orderId).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
      if (res.ok) {
        window.$toast('订单已取消', 'success')
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        window.$toast(data.error || '取消失败', 'error')
      }
    } catch (e) {
      console.error(e)
      window.$toast('网络错误', 'error')
    }
  })
}

const loadData = () => {
  if (currentTab.value === 'dashboard') fetchDashboard()
  else if (currentTab.value === 'orders') fetchOrders(ordersPage.value)
  else if (currentTab.value === 'payments') fetchPayments(paymentsPage.value)
  else if (currentTab.value === 'abnormal') fetchAbnormal(abnormalPage.value)
}

watch(() => currentTab.value, loadData)
onMounted(loadData)

const formatMethod = (method) => {
  const map = {
    'wechat': '微信支付',
    'alipay': '支付宝',
    'unionpay': '云闪付',
    'cash': '现金收款'
  }
  return map[method] || method
}

const formatConfirmedVia = (via) => {
  const map = {
    callback: '回调',
    polling: '轮询',
    cash: '现金',
    manual: '人工',
    reconcile: '补偿'
  }
  return map[via] || (via ? via : '-')
}

const openOrderDetail = async (orderId) => {
  showOrderDetail.value = true
  orderDetailLoading.value = true
  orderDetail.value = null
  try {
    const res = await getOrder(orderId).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      window.$toast(json.error || '获取订单明细失败', 'error')
      showOrderDetail.value = false
      return
    }
    orderDetail.value = json?.data || null
  } catch (e) {
    console.error(e)
    window.$toast('获取订单明细失败，网络错误', 'error')
    showOrderDetail.value = false
  } finally {
    orderDetailLoading.value = false
  }
}

const closeOrderDetail = () => {
  showOrderDetail.value = false
  orderDetail.value = null
  showRefundModal.value = false
}

// Refund logic
const showRefundModal = ref(false)
const refundForm = ref({ amount: '', method: 'original', reason: '' })
const isRefunding = ref(false)
const refundItems = ref([])

const openRefundModal = () => {
  if (!orderDetail.value || !orderDetail.value.order) return
  const o = orderDetail.value.order
  const max = (o.total_amount || 0) - (o.refunded_amount || 0)
  refundForm.value = {
    amount: max > 0 ? max.toFixed(2) : '',
    method: o.pay_provider === 'cash' || o.pay_provider === 'manual' ? 'cash' : 'original',
    reason: '门店退款'
  }
  
  // 初始化退款商品列表，默认退款数量为 0
  refundItems.value = (orderDetail.value.items || []).map(item => ({
    ...item,
    refund_quantity: 0
  }))

  showRefundModal.value = true
}

watch(() => refundItems.value, (newItems) => {
  if (!showRefundModal.value) return
  const total = newItems.reduce((sum, item) => {
    return sum + ((item.refund_quantity || 0) * (item.unit_price || 0))
  }, 0)
  
  // 只有当用户真的选择了商品时，才覆盖填入金额；否则允许手动输入任意金额
  if (total > 0) {
    refundForm.value.amount = total.toFixed(2)
  }
}, { deep: true })

const submitRefund = async () => {
  const o = orderDetail.value.order
  const amt = Number(refundForm.value.amount)
  if (isNaN(amt) || amt <= 0) {
    window.$toast('请输入有效退款金额', 'warning')
    return
  }
  
  const max = (o.total_amount || 0) - (o.refunded_amount || 0)
  if (amt > max + 0.01) {
    window.$toast(`退款金额不可超过剩余可退金额 ¥${max.toFixed(2)}`, 'warning')
    return
  }

  const itemsToRefund = refundItems.value
    .filter(i => i.refund_quantity > 0)
    .map(i => ({ id: i.id, product_id: i.product_id, quantity: i.refund_quantity }))

  showConfirm(`确定退款 ¥${amt.toFixed(2)} (${refundForm.value.method === 'original' ? '原路退回' : '现金退回'}) 吗？`, async () => {
    isRefunding.value = true
    try {
      const res = await refundOrder(o.id, { 
          amount: amt, 
          method: refundForm.value.method, 
          reason: refundForm.value.reason,
          items: itemsToRefund
        }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        window.$toast('退款成功', 'success')
        showRefundModal.value = false
        // 刷新订单详情
        await openOrderDetail(o.id)
        // 刷新列表
        loadData()
      } else {
        window.$toast(json.error || '退款失败', 'error')
      }
    } catch (e) {
      console.error(e)
      window.$toast('网络错误', 'error')
    } finally {
      isRefunding.value = false
    }
  })
}

const pageTitle = computed(() => {
  if (currentTab.value === 'orders') return '订单明细'
  if (currentTab.value === 'payments') return '支付记录'
  if (currentTab.value === 'abnormal') return '异常订单'
  return '营业大盘'
})

const pageSubtitle = computed(() => {
  if (currentTab.value === 'orders') return '查看所有交易订单'
  if (currentTab.value === 'payments') return '查看三方支付网关状态与对账信息'
  if (currentTab.value === 'abnormal') return '超过1小时未完成的异常订单，可人工干预处理'
  return '实时监控今日门店营业数据'
})
</script>

<template>
  <div class="report-container">
    <div class="header-bar">
      <div>
        <h2 class="page-title">{{ pageTitle }}</h2>
        <p class="subtitle">{{ pageSubtitle }}</p>
      </div>
      <button class="btn btn-primary btn-refresh" @click="loadData">
        <span class="icon">↻</span> 刷新数据
      </button>
    </div>

    <!-- 大盘视图 -->
    <template v-if="currentTab === 'dashboard'">
        <!-- 概览数据卡片 -->
        <div class="dashboard-grid">
          <div class="stat-card highlight">
            <div class="stat-icon revenue-icon">💰</div>
            <div class="stat-content">
              <div class="stat-label">今日营业额</div>
              <div class="stat-value">
                <span class="currency">¥</span>
                {{ todayStats.total_revenue.toFixed(2) }}
              </div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orders-icon">🛒</div>
            <div class="stat-content">
              <div class="stat-label">今日订单数</div>
              <div class="stat-value">
                {{ todayStats.total_orders }} <span class="unit">笔</span>
              </div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon avg-icon">📈</div>
            <div class="stat-content">
              <div class="stat-label">客单价预估</div>
              <div class="stat-value">
                <span class="currency">¥</span>
                {{ todayStats.total_orders > 0 ? (todayStats.total_revenue / todayStats.total_orders).toFixed(2) : '0.00' }}
              </div>
            </div>
          </div>
          <div class="stat-card" style="background-color: #fff1f2; border-color: #ffedd5;">
            <div class="stat-icon" style="background: #ffe4e6; color: #e11d48;">💸</div>
            <div class="stat-content">
              <div class="stat-label" style="color: #be123c;">今日退款总额</div>
              <div class="stat-value" style="color: #e11d48;">
                <span class="currency">¥</span>
                {{ todayStats.total_refunds.toFixed(2) }}
              </div>
            </div>
          </div>
          <div class="stat-card" style="background-color: #fff1f2; border-color: #ffedd5;">
            <div class="stat-icon" style="background: #ffe4e6; color: #e11d48;">🔄</div>
            <div class="stat-content">
              <div class="stat-label" style="color: #be123c;">今日退款单数</div>
              <div class="stat-value" style="color: #e11d48;">
                {{ todayStats.refund_orders }} <span class="unit" style="color: #fb7185;">笔</span>
              </div>
            </div>
          </div>
        </div>

      <div class="recent-orders-card">
        <div class="card-header">
          <h3 class="card-title">最近 20 笔交易流水</h3>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th width="22%">流水单号</th>
                <th width="16%">交易金额</th>
                <th width="16%">支付方式</th>
                <th width="12%">来源</th>
                <th width="14%">状态</th>
                <th width="20%">交易时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in recentOrders" :key="order.id">
                <td class="order-id">
                  <button class="order-link" @click="openOrderDetail(order.id)">{{ order.id }}</button>
                </td>
                <td class="order-amount">¥ {{ order.total_amount.toFixed(2) }}</td>
                <td>
                  <div :class="['pay-tag', order.pay_method]">
                    <span class="icon" v-if="order.pay_method==='wechat'">💬</span>
                    <span class="icon" v-else-if="order.pay_method==='alipay'">💳</span>
                    <span class="icon" v-else-if="order.pay_method==='unionpay'">🏦</span>
                    <span class="icon" v-else>💵</span>
                    {{ formatMethod(order.pay_method) }}
                  </div>
                </td>
                <td class="source-cell">{{ formatConfirmedVia(order.pay_confirmed_via) }}</td>
                <td>
                  <span class="status-dot success" v-if="order.status === 'completed' && order.refund_status !== 'full'">
                    <span class="dot"></span>{{ order.refund_status === 'partial' ? '部分退款' : '已完成' }}
                  </span>
                  <span class="status-dot" style="color:#64748b" v-else-if="order.refund_status === 'full'">
                    <span class="dot" style="background:#cbd5e1"></span>全额退款
                  </span>
                  <span class="status-dot" v-else>
                    <span class="dot"></span>{{ order.status }}
                  </span>
                </td>
                <td class="time-cell">{{ formatDateTime(order.created_at) }}</td>
              </tr>
              <tr v-if="recentOrders.length === 0">
                <td colspan="6">
                  <div class="empty-state">
                    <div class="empty-icon">📝</div>
                    <p>暂无交易流水记录</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 订单列表视图 -->
    <template v-else-if="currentTab === 'orders'">
      <div class="recent-orders-card">
        <div class="card-header">
          <h3 class="card-title">所有订单明细</h3>
        </div>
        <div class="table-container" :class="{ loading: ordersLoading }">
          <table class="data-table">
            <thead>
              <tr>
                <th width="20%">流水单号</th>
                <th width="15%">交易金额</th>
                <th width="15%">支付方式</th>
                <th width="15%">来源</th>
                <th width="15%">状态</th>
                <th width="20%">交易时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in allOrders" :key="order.id">
                <td class="order-id">
                  <button class="order-link" @click="openOrderDetail(order.id)">{{ order.id }}</button>
                </td>
                <td class="order-amount">¥ {{ order.total_amount.toFixed(2) }}</td>
                <td>
                  <div :class="['pay-tag', order.pay_method]">
                    {{ formatMethod(order.pay_method) }}
                  </div>
                </td>
                <td class="source-cell">{{ formatConfirmedVia(order.pay_confirmed_via) }}</td>
                <td>
                  <span class="status-dot success" v-if="order.status === 'completed' && order.refund_status !== 'full'">
                    <span class="dot"></span>{{ order.refund_status === 'partial' ? '部分退款' : '已完成' }}
                  </span>
                  <span class="status-dot" style="color:#64748b" v-else-if="order.refund_status === 'full'">
                    <span class="dot" style="background:#cbd5e1"></span>全额退款
                  </span>
                  <span class="status-dot" v-else>
                    <span class="dot"></span>{{ order.status }}
                  </span>
                </td>
                <td class="time-cell">{{ formatDateTime(order.created_at) }}</td>
              </tr>
              <tr v-if="allOrders.length === 0">
                <td colspan="6"><div class="empty-state"><p>暂无记录</p></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="ordersTotalPages > 1">
          <button class="btn btn-secondary" :disabled="ordersPage <= 1" @click="fetchOrders(ordersPage - 1)">上一页</button>
          <span class="page-info">{{ ordersPage }} / {{ ordersTotalPages }}</span>
          <button class="btn btn-secondary" :disabled="ordersPage >= ordersTotalPages" @click="fetchOrders(ordersPage + 1)">下一页</button>
        </div>
      </div>
    </template>

    <!-- 支付记录视图 -->
    <template v-else-if="currentTab === 'payments'">
      <div class="recent-orders-card">
        <div class="card-header">
          <h3 class="card-title">三方支付明细对账</h3>
        </div>
        <div class="table-container" :class="{ loading: paymentsLoading }">
          <table class="data-table" style="min-width: 1000px">
            <thead>
              <tr>
                <th>订单号</th>
                <th>三方订单号 (TradeNo)</th>
                <th>网关状态</th>
                <th>内部状态</th>
                <th>同步方式</th>
                <th>同步时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in paymentOrders" :key="order.id">
                <td class="order-id">
                  <button class="order-link" @click="openOrderDetail(order.id)">{{ order.id }}</button>
                </td>
                <td class="mono" style="font-size: 12px; color: #475569">
                  {{ order.pay_trade_no || '-' }}
                </td>
                <td>
                  <div style="font-size: 12px;">
                    <span style="font-weight: 500; color: #0f172a">{{ order.pay_provider_status || '-' }}</span>
                    <div style="color: #64748b" v-if="order.pay_provider_code">{{ order.pay_provider_code }} {{ order.pay_provider_msg ? '- ' + order.pay_provider_msg : '' }}</div>
                  </div>
                </td>
                <td>
                  <span class="status-dot success" v-if="order.pay_status === 'paid'">
                    <span class="dot"></span>已支付
                  </span>
                  <span class="status-dot error" v-else-if="order.pay_status === 'failed'">
                    <span class="dot" style="background:var(--danger)"></span>失败
                  </span>
                  <span class="status-dot" v-else>
                    <span class="dot"></span>{{ order.pay_status || '未知' }}
                  </span>
                </td>
                <td style="font-size: 12px;">{{ order.pay_last_sync_via || '-' }}</td>
                <td class="time-cell">{{ order.pay_last_sync_at ? formatDateTime(order.pay_last_sync_at) : '-' }}</td>
              </tr>
              <tr v-if="paymentOrders.length === 0">
                <td colspan="6"><div class="empty-state"><p>暂无记录</p></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="paymentsTotalPages > 1">
          <button class="btn btn-secondary" :disabled="paymentsPage <= 1" @click="fetchPayments(paymentsPage - 1)">上一页</button>
          <span class="page-info">{{ paymentsPage }} / {{ paymentsTotalPages }}</span>
          <button class="btn btn-secondary" :disabled="paymentsPage >= paymentsTotalPages" @click="fetchPayments(paymentsPage + 1)">下一页</button>
        </div>
      </div>
    </template>

    <!-- 异常订单视图 -->
    <template v-else-if="currentTab === 'abnormal'">
      <div class="recent-orders-card">
        <div class="card-header">
          <h3 class="card-title">超时异常订单</h3>
        </div>
        <div class="table-container" :class="{ loading: abnormalLoading }">
          <table class="data-table">
            <thead>
              <tr>
                <th width="15%">流水单号</th>
                <th width="15%">交易金额</th>
                <th width="15%">支付方式</th>
                <th width="15%">状态</th>
                <th width="20%">交易时间</th>
                <th width="20%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in abnormalOrders" :key="order.id">
                <td class="order-id">
                  <button class="order-link" @click="openOrderDetail(order.id)">{{ order.id }}</button>
                </td>
                <td class="order-amount">¥ {{ order.total_amount.toFixed(2) }}</td>
                <td>
                  <div :class="['pay-tag', order.pay_method]">
                    {{ formatMethod(order.pay_method) }}
                  </div>
                </td>
                <td>
                  <span class="status-dot error" v-if="order.status === 'abnormal'">
                    <span class="dot" style="background:var(--danger)"></span>异常
                  </span>
                  <span class="status-dot" style="color:#64748b" v-else-if="order.status === 'canceled'">
                    <span class="dot" style="background:#cbd5e1"></span>已取消
                  </span>
                  <span class="status-dot success" v-else-if="order.status === 'completed'">
                    <span class="dot"></span>已转支付
                  </span>
                  <span class="status-dot" v-else>
                    <span class="dot"></span>{{ order.status }}
                  </span>
                </td>
                <td class="time-cell">{{ formatDateTime(order.created_at) }}</td>
                <td>
                  <div style="display:flex;gap:8px;" v-if="order.status === 'abnormal'">
                    <button class="btn btn-secondary" style="padding:2px 8px;font-size:12px" @click="manualPayOrder(order.id)">转为支付</button>
                    <button class="btn btn-danger" style="padding:2px 8px;font-size:12px" @click="cancelAbnormalOrder(order.id)">取消并关闭</button>
                  </div>
                  <span v-else style="font-size:12px; color:#9ca3af;">无操作</span>
                </td>
              </tr>
              <tr v-if="abnormalOrders.length === 0">
                <td colspan="6"><div class="empty-state"><p>暂无异常订单</p></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="abnormalTotalPages > 1">
          <button class="btn btn-secondary" :disabled="abnormalPage <= 1" @click="fetchAbnormal(abnormalPage - 1)">上一页</button>
          <span class="page-info">{{ abnormalPage }} / {{ abnormalTotalPages }}</span>
          <button class="btn btn-secondary" :disabled="abnormalPage >= abnormalTotalPages" @click="fetchAbnormal(abnormalPage + 1)">下一页</button>
        </div>
      </div>
    </template>

    <div class="detail-overlay" :class="{ 'is-active': showOrderDetail }" @click.self="closeOrderDetail">
      <div class="detail-modal" v-if="showOrderDetail">
        <div class="detail-header">
          <div class="detail-title">订单明细</div>
          <button class="detail-close" @click="closeOrderDetail">×</button>
        </div>
        <div class="detail-body">
          <div v-if="orderDetailLoading" class="detail-loading">加载中...</div>
          <div v-else-if="orderDetail" class="detail-content">
            <div class="detail-meta">
              <div class="meta-row">
                <span class="meta-label">订单号</span>
                <span class="meta-value mono">{{ orderDetail.order.id }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">支付方式</span>
                <span class="meta-value">{{ formatMethod(orderDetail.order.pay_method) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">来源</span>
                <span class="meta-value">{{ formatConfirmedVia(orderDetail.order.pay_confirmed_via) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">金额</span>
                <span class="meta-value">¥ {{ Number(orderDetail.order.total_amount || 0).toFixed(2) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">时间</span>
                <span class="meta-value">{{ formatDateTime(orderDetail.order.created_at) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">状态</span>
                <span class="meta-value">
                  <span v-if="orderDetail.order.status === 'completed' && orderDetail.order.refund_status !== 'full'" style="color:var(--success)">已完成{{ orderDetail.order.refund_status === 'partial' ? ' (部分退款)' : '' }}</span>
                  <span v-else-if="orderDetail.order.refund_status === 'full'" style="color:#64748b">全额退款</span>
                  <span v-else-if="orderDetail.order.status === 'abnormal'" style="color:var(--danger)">异常订单</span>
                  <span v-else>{{ orderDetail.order.status }}</span>
                </span>
              </div>
              <div class="meta-row" v-if="orderDetail.order.refunded_amount > 0">
                <span class="meta-label">已退金额</span>
                <span class="meta-value" style="color:var(--danger)">¥ {{ Number(orderDetail.order.refunded_amount).toFixed(2) }}</span>
              </div>
            </div>

            <div class="detail-table-wrap">
              <table class="detail-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th width="18%">数量</th>
                    <th width="22%">单价</th>
                    <th width="22%">小计</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in orderDetail.items" :key="it.id">
                    <td>
                      <div class="item-name">{{ it.name || ('商品#' + it.product_id) }}</div>
                      <div class="item-sub" v-if="it.barcode">{{ it.barcode }}</div>
                    </td>
                    <td>{{ it.quantity }}{{ it.unit || '' }}</td>
                    <td>¥ {{ Number(it.unit_price || 0).toFixed(2) }}</td>
                    <td class="cell-strong">¥ {{ Number(it.subtotal || 0).toFixed(2) }}</td>
                  </tr>
                  <tr v-if="!orderDetail.items?.length">
                    <td colspan="4" class="detail-empty">无明细数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="detail-footer">
          <button class="btn btn-secondary" @click="closeOrderDetail">关闭</button>
          <button class="btn btn-danger" v-if="orderDetail?.order?.status === 'completed' && orderDetail?.order?.refund_status !== 'full'" @click="openRefundModal">退款</button>
        </div>
      </div>
    </div>

    <!-- 退款弹窗 -->
    <div class="detail-overlay" :class="{ 'is-active': showRefundModal }" style="z-index: 15001;" @click.self="showRefundModal = false">
      <div class="detail-modal" v-if="showRefundModal" style="max-width: 600px;">
        <div class="detail-header">
          <div class="detail-title">订单退款</div>
          <button class="detail-close" @click="showRefundModal = false">×</button>
        </div>
        <div class="detail-body">
          <div class="detail-content" style="padding-top: 10px;">
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display:block; margin-bottom:8px; font-weight:500;">选择退款商品 (可选)</label>
              <div style="max-height: 200px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                <table class="detail-table" style="margin-top: 0; border: none;">
                  <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 1;">
                    <tr>
                      <th style="padding: 8px;">商品名称</th>
                      <th style="padding: 8px;">单价</th>
                      <th style="padding: 8px;">可退数</th>
                      <th style="padding: 8px; width: 100px;">退款数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in refundItems" :key="item.id">
                      <td style="padding: 8px;">
                        <div class="item-name">{{ item.name || ('商品#' + item.product_id) }}</div>
                      </td>
                      <td style="padding: 8px;">¥ {{ Number(item.unit_price || 0).toFixed(2) }}</td>
                      <td style="padding: 8px;">{{ item.quantity }}</td>
                      <td style="padding: 8px;">
                        <input 
                          type="number" 
                          class="form-input" 
                          v-model.number="item.refund_quantity" 
                          min="0" 
                          :max="item.quantity" 
                          style="width: 80px; padding: 4px; height: 32px;"
                        />
                      </td>
                    </tr>
                    <tr v-if="!refundItems?.length">
                      <td colspan="4" class="detail-empty" style="padding: 16px;">无明细数据</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 6px;">提示: 修改退款数量会自动计算退款金额，您也可以直接手动输入金额进行退款。</p>
            </div>
            
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display:block; margin-bottom:8px; font-weight:500;">退款金额 (最多可退 ¥{{ ((orderDetail?.order?.total_amount || 0) - (orderDetail?.order?.refunded_amount || 0)).toFixed(2) }})</label>
              <input type="number" class="form-input" v-model="refundForm.amount" step="0.01" min="0.01" />
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display:block; margin-bottom:8px; font-weight:500;">退款方式</label>
              <select class="form-select" v-model="refundForm.method" style="width:100%; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
                <option value="original" :disabled="orderDetail?.order?.pay_provider === 'cash' || orderDetail?.order?.pay_provider === 'manual'">原路退回 (仅支持支付宝)</option>
                <option value="cash">现金退款</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display:block; margin-bottom:8px; font-weight:500;">退款原因</label>
              <input type="text" class="form-input" v-model="refundForm.reason" placeholder="如：协商退款" />
            </div>
          </div>
        </div>
        <div class="detail-footer">
          <button class="btn btn-secondary" @click="showRefundModal = false" :disabled="isRefunding">取消</button>
          <button class="btn btn-danger" @click="submitRefund" :disabled="isRefunding">{{ isRefunding ? '处理中...' : '确认退款' }}</button>
        </div>
      </div>
    </div>

    <!-- 确认操作弹窗 -->
    <div class="detail-overlay" :class="{ 'is-active': confirmModal.show }" style="z-index: 20002;" @click.self="closeConfirm">
      <div class="detail-modal" v-if="confirmModal.show" style="max-width: 320px;">
        <div class="detail-header" style="border-bottom: none; padding-bottom: 0;">
          <div class="detail-title" style="color: #0f172a;">操作确认</div>
        </div>
        <div class="detail-body" style="padding: 16px 20px;">
          <div style="font-size: 15px; color: #334155; line-height: 1.5;">
            {{ confirmModal.message }}
          </div>
        </div>
        <div class="detail-footer" style="border-top: none; padding-top: 0;">
          <button class="btn btn-secondary" @click="closeConfirm">取消</button>
          <button class="btn btn-primary" @click="handleConfirm">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-container {
  padding: 24px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.page-title {
  margin: 0 0 4px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.5px;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
}

.btn-refresh {
  padding: 10px 20px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 概览数据卡片 */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.stat-card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 20px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card.highlight {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: white;
}
.stat-card.highlight .stat-label {
  color: rgba(255, 255, 255, 0.8);
}
.stat-card.highlight .stat-value {
  color: white;
}

.stat-icon {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.revenue-icon { background: rgba(255, 255, 255, 0.2); }
.orders-icon { background: var(--primary-light); color: var(--primary); }
.avg-icon { background: var(--success-bg); color: var(--success); }

.stat-content {
  flex: 1;
}

.stat-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 800;
  color: var(--text-main);
  line-height: 1;
  letter-spacing: -1px;
}

.stat-value .currency {
  font-size: 20px;
  font-weight: 600;
  margin-right: 2px;
}
.stat-value .unit {
  font-size: 16px;
  font-weight: 600;
  margin-left: 4px;
}

/* 订单列表卡片 */
.recent-orders-card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 400px;
  overflow: hidden;
}

.card-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-color);
}

.card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-main);
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
  font-size: 13px;
  font-weight: 600;
  padding: 14px 24px;
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border-color);
}

.data-table td {
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
  vertical-align: middle;
}

.data-table tbody tr:hover td {
  background-color: #f8fafc;
}

.order-id {
  font-family: monospace;
  color: var(--text-muted);
  font-size: 13px;
}

.order-link {
  border: 0;
  background: transparent;
  color: var(--primary);
  font-family: monospace;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.order-link:hover {
  text-decoration: underline;
}

.order-amount {
  font-weight: 700;
  color: var(--text-main);
  font-size: 15px;
}

.time-cell {
  color: var(--text-muted);
  font-size: 13px;
}

.source-cell {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 600;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 16px 24px;
  gap: 16px;
  border-top: 1px solid #e2e8f0;
}
.page-info {
  font-size: 14px;
  color: #64748b;
}

.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 15000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.detail-overlay.is-active {
  opacity: 1;
  pointer-events: auto;
}

.detail-modal {
  width: min(720px, calc(100vw - 32px));
  background: var(--surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 720px);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-color);
}

.detail-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-main);
}

.detail-close {
  border: 0;
  background: transparent;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 20px;
  color: var(--text-muted);
}

.detail-close:hover {
  background: #f1f5f9;
  color: var(--text-main);
}

.detail-body {
  padding: 18px;
  overflow: auto;
}

.detail-loading {
  padding: 30px 0;
  text-align: center;
  color: var(--text-muted);
  font-weight: 700;
}

.detail-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  padding: 12px 14px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.meta-label {
  color: var(--text-muted);
  font-weight: 700;
}

.meta-value {
  color: var(--text-main);
  font-weight: 800;
}

.meta-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 700;
}

.detail-table-wrap {
  margin-top: 14px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
}

.detail-table th {
  background: var(--bg-color);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.detail-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-main);
  vertical-align: top;
}

.item-name {
  font-weight: 800;
}

.item-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.cell-strong {
  font-weight: 900;
}

.detail-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 20px 0;
}

.detail-footer {
  border-top: 1px solid var(--border-color);
  padding: 14px 18px;
  display: flex;
  justify-content: flex-end;
}

/* 支付方式标签 */
.pay-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
}
.pay-tag .icon { font-size: 14px; }
.pay-tag.wechat { background: #e6f7ff; color: #096dd9; }
.pay-tag.alipay { background: #e6fffb; color: #08979c; }
.pay-tag.unionpay { background: #f0f5ff; color: #2f54eb; }
.pay-tag.cash { background: #fffbe6; color: #d46b08; }

/* 状态圆点 */
.status-dot {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
}
.status-dot .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status-dot.success .dot {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-bg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  color: var(--text-muted);
}
.empty-state .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

@media (max-width: 900px) {
  .report-container {
    padding: 14px;
    min-height: calc(100vh - 120px);
  }

  .header-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .btn-refresh {
    width: 100%;
    justify-content: center;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .stat-card {
    padding: 18px;
  }

  .stat-value {
    font-size: 28px;
  }

  .card-header {
    padding: 16px;
  }

  .table-container {
    overflow-x: auto;
  }

  .data-table {
    min-width: 860px;
  }

  .data-table th,
  .data-table td {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
