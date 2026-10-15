import request from './request'
import { authState, clearAuthSession, setAuthSession } from '../store'

const unwrap = (payload) => payload?.data ?? payload

const applySession = (payload) => {
  const data = unwrap(payload) || {}
  const token = data.token || data.access_token || data.accessToken
  const user = data.user || data.account || data.me
  const rawPermissions = data.permissions || user?.permissions || user?.permission_codes || user?.permissionKeys || []
  const permissions = Array.isArray(rawPermissions)
    ? rawPermissions.map(item => typeof item === 'string' ? item : item?.permission_key || item?.code || item?.key).filter(Boolean)
    : []
  if (token || user || permissions.length) setAuthSession({ token, user, permissions })
  return data
}

export const login = async (credentials) => {
  authState.loading = true
  authState.loginError = ''
  try {
    const payload = await request.post('/auth/login', credentials)
    return applySession(payload)
  } catch (error) {
    authState.loginError = error?.error || error?.message || '登录失败，请检查账号和密码'
    throw error
  } finally {
    authState.loading = false
  }
}

// Public endpoints used before a session exists. The server may return either
// the data object directly or wrapped in `{ data }`, so callers can consume
// both forms consistently.
export const getAuthStatus = async () => {
  const payload = await request.get('/auth/status')
  return unwrap(payload) || {}
}

export const bootstrapSuperAdmin = async (credentials) => {
  const payload = await request.post('/auth/bootstrap', credentials)
  return applySession(payload)
}

export const getCurrentUser = async () => {
  const payload = await request.get('/auth/me')
  return applySession(payload)
}

export const logout = async () => {
  try {
    if (authState.token) await request.post('/auth/logout')
  } finally {
    clearAuthSession()
  }
}

export const listUsers = (params) => request.get('/users', { params })
export const createUser = (data) => request.post('/users', data)
export const updateUser = (id, data) => request.put(`/users/${id}`, data)
export const deleteUser = (id) => request.delete(`/users/${id}`)
export const listRoles = (params) => request.get('/roles', { params })
export const createRole = (data) => request.post('/roles', data)
export const updateRole = (id, data) => request.put(`/roles/${id}`, data)
export const deleteRole = (id) => request.delete(`/roles/${id}`)
export const listPermissions = () => request.get('/roles/permissions')
export const getRolePermissions = (id) => request.get(`/roles/${id}/permissions`)
export const updateRolePermissions = (id, permissions) => request.put(`/roles/${id}/permissions`, { permissions })

export const permissionCatalog = [
  { code: 'account.view', label: '查看账号' },
  { code: 'account.manage', label: '管理账号' },
  { code: 'role.view', label: '查看角色' },
  { code: 'role.manage', label: '管理角色' },
  { code: 'payment.config.view', label: '查看支付配置' },
  { code: 'payment.config.manage', label: '管理支付配置' },
  { code: 'payment.method.manage', label: '管理支付方式' },
  { code: 'payment.create', label: '发起收款' },
  { code: 'payment.confirm', label: '确认收款' },
  { code: 'payment.record.view', label: '查看支付记录' },
  { code: 'payment.reconcile', label: '支付对账' },
  { code: 'refund.view', label: '查看退款' },
  { code: 'refund.request', label: '发起退款' },
  { code: 'refund.approve', label: '审批退款' },
  { code: 'refund.execute', label: '执行退款' },
  { code: 'order.view', label: '查看订单' },
  { code: 'order.manage', label: '管理订单' },
  { code: 'report.view', label: '查看报表' },
  { code: 'report.export', label: '导出报表' },
  { code: 'exception.manage', label: '处理异常订单' },
  { code: 'archive.view', label: '查看归档' },
  { code: 'archive.run', label: '运行归档' },
  { code: 'archive.restore', label: '恢复归档' }
]
