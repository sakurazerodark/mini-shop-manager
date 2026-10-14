const logger = require('../logger');
const { dbRun } = require('../database');

/**
 * Permission names are kept in one place so route guards and account tooling
 * cannot silently drift apart. The values are part of the API contract.
 */
const PERMISSIONS = Object.freeze({
  ACCOUNT_VIEW: 'account.view',
  ACCOUNT_MANAGE: 'account.manage',
  ROLE_VIEW: 'role.view',
  ROLE_MANAGE: 'role.manage',
  PAYMENT_CONFIG_VIEW: 'payment.config.view',
  PAYMENT_CONFIG_MANAGE: 'payment.config.manage',
  PAYMENT_METHOD_MANAGE: 'payment.method.manage',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_CONFIRM: 'payment.confirm',
  PAYMENT_RECORD_VIEW: 'payment.record.view',
  PAYMENT_RECONCILE: 'payment.reconcile',
  REFUND_VIEW: 'refund.view',
  REFUND_REQUEST: 'refund.request',
  REFUND_APPROVE: 'refund.approve',
  REFUND_EXECUTE: 'refund.execute',
  ORDER_VIEW: 'order.view',
  ORDER_MANAGE: 'order.manage',
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  EXCEPTION_MANAGE: 'exception.manage',
  ARCHIVE_VIEW: 'archive.view',
  ARCHIVE_RUN: 'archive.run',
  ARCHIVE_RESTORE: 'archive.restore'
});

const list = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
};

const actorMeta = (req) => {
  const user = req.user || {};
  return {
    actor_id: user.id ?? user.userId ?? null,
    actor_username: user.username || user.name || null
  };
};

const safeBodyKeys = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  // Record field names only. This deliberately avoids writing payment keys,
  // auth codes, or other request values into audit logs.
  return Object.keys(body).sort();
};

const safeBodySummary = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const allowed = ['amount', 'method', 'reason', 'poll_interval_ms', 'costing_mode', 'pay_method', 'pay_provider', 'order_id'];
  const summary = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (typeof value === 'number' || typeof value === 'boolean') summary[key] = value;
    else if (typeof value === 'string') summary[key] = value.slice(0, 200);
  }
  if (body.payment_preferences && typeof body.payment_preferences === 'object') {
    summary.payment_preferences_keys = Object.keys(body.payment_preferences).sort();
  }
  return summary;
};

const persistAudit = (req, permissions, result, status, details) => {
  const userId = Number(req.user?.id ?? req.user?.userId);
  const target = req.params || {};
  const resourceId = target.id || target.orderId || target.order_id || null;
  const action = `${req.method} ${req.path || req.originalUrl || ''}`.slice(0, 255);
  dbRun(
    `INSERT INTO audit_logs
      (user_id, action, resource, resource_id, details, result, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number.isFinite(userId) ? userId : null,
      action,
      permissions.join(','),
      resourceId ? String(resourceId) : null,
      JSON.stringify(details),
      result,
      req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || null,
      req.headers?.['user-agent'] || null
    ]
  ).catch((error) => {
    logger.error('audit persistence error', {
      request_id: req.requestId || null,
      message: error?.message || String(error)
    });
  });
};

const auditRequest = (req, res, permissions) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const status = Number(res.statusCode || 500);
    const result = status === 401
      ? 'unauthenticated'
      : status === 403
        ? 'denied'
        : status >= 400
          ? 'error'
          : 'success';

    const details = {
      request_id: req.requestId || null,
      permission: permissions.length === 1 ? permissions[0] : permissions,
      method: req.method,
      route: req.originalUrl || req.url,
      target: req.params || {},
      changed_keys: safeBodyKeys(req.body),
      changes: safeBodySummary(req.body),
      result,
      status,
      duration_ms: Date.now() - startedAt,
      ...actorMeta(req)
    };
    logger.audit('authorization action', details);
    persistAudit(req, permissions, result, status, details);
  });
};

/**
 * Authenticate and require every permission returned by `required`.
 * `required` may be a string, an array, or a function of the request. This is
 * useful for settings updates where changing payment methods is a separate
 * permission from changing provider credentials.
 */
const protect = (required) => (req, res, next) => {
  const resolved = typeof required === 'function' ? required(req) : required;
  const permissions = list(resolved);
  auditRequest(req, res, permissions);

  // Require lazily so this module remains loadable while the auth service is
  // being initialized and so all auth behavior stays owned by auth.js.
  const auth = require('./auth');
  auth.authenticate(req, res, () => {
    if (res.headersSent) return;
    let index = 0;
    const checkNext = () => {
      if (res.headersSent) return;
      if (index >= permissions.length) return next();
      const permission = permissions[index++];
      return auth.requirePermission(permission)(req, res, checkNext);
    };
    return checkNext();
  });
};

const paymentSettingsPermissions = (req) => {
  const required = [PERMISSIONS.PAYMENT_CONFIG_MANAGE];
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'payment_preferences')) {
    required.push(PERMISSIONS.PAYMENT_METHOD_MANAGE);
  }
  return required;
};

module.exports = {
  PERMISSIONS,
  protect,
  paymentSettingsPermissions
};
