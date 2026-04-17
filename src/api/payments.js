import request from './request'

export const queryAlipay = (orderId) => request.get(`/payments/alipay/query/${encodeURIComponent(orderId)}`)
export const precreateAlipay = (data) => request.post('/payments/alipay/precreate', data)
export const payAlipay = (data) => request.post('/payments/alipay/pay', data)
