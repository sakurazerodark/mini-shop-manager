import request from './request'

export const getTodayStats = () => request.get('/reports/today')
export const getRecentOrders = () => request.get('/orders/recent')
export const getOrders = (params) => request.get('/orders', { params })
export const getOrder = (id) => request.get(`/orders/${encodeURIComponent(id)}`)
export const manualPayOrder = (id) => request.post(`/orders/${encodeURIComponent(id)}/manual_pay`)
export const cancelOrder = (id) => request.post(`/orders/${encodeURIComponent(id)}/cancel`)
export const refundOrder = (id, data) => request.post(`/orders/${encodeURIComponent(id)}/refund`, data)
export const createPendingOrder = (data) => request.post('/orders/pending', data)
export const completeOrder = (id) => request.post(`/orders/${encodeURIComponent(id)}/complete`)
