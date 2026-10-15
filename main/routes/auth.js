const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');

// Login and first-run setup are public endpoints, so their failures cannot be
// covered by the authenticated request audit middleware. Record only the
// attempted account and error code; never persist a password.
const auditPublicAuthFailure = (req, res, next) => {
  res.on('finish', () => {
    // Other failures are recorded by the route's catch block; this hook only
    // covers login's early invalid-input return before the catch block runs.
    if (req.path !== '/login' || Number(res.statusCode || 500) !== 400) return;
    authService.writeAudit({
      userId: null,
      action: req.path === '/login' ? 'auth.login' : 'auth.bootstrap',
      resource: 'session',
      details: {
        username: typeof req.body?.username === 'string' ? req.body.username.trim() : '',
        code: typeof req.body?.code === 'string' ? req.body.code : undefined
      },
      result: res.statusCode === 401 || res.statusCode === 403 ? 'denied' : 'error',
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(() => {});
  });
  next();
};

// This endpoint is intentionally public so a fresh installation can show the
// setup screen before any account exists.
router.get('/status', async (_req, res) => {
  try { res.json({ data: await authService.getAuthSetupStatus() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/bootstrap', async (req, res) => {
  try {
    const user = await authService.bootstrapSuperAdmin(req.body || {});
    await authService.writeAudit({
      userId: user.id,
      action: 'auth.bootstrap',
      resource: 'user',
      resourceId: user.id,
      details: { username: user.username, role: 'store_owner' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(201).json({ data: user });
  } catch (error) {
    await authService.writeAudit({
      userId: null,
      action: 'auth.bootstrap',
      resource: 'user',
      result: 'error',
      details: { username: String(req.body?.username || '').slice(0, 64), code: error.code || 'BOOTSTRAP_FAILED' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(() => {});
    if (error.code === 'SETUP_COMPLETED') return res.status(409).json({ error: error.message, code: error.code });
    if (error.code === 'INVALID_INPUT') return res.status(400).json({ error: error.message, code: error.code });
    if (error.message && error.message.includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在', code: 'USERNAME_EXISTS' });
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', auditPublicAuthFailure, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码', code: 'INVALID_INPUT' });
    const result = await authService.login(username, password, { ip: req.ip, userAgent: req.get('user-agent') });
    await authService.writeAudit({ userId: result.user.id, action: 'auth.login', resource: 'session', result: 'success', ip: req.ip, userAgent: req.get('user-agent') });
    res.json(result);
  } catch (error) {
    await authService.writeAudit({
      userId: null,
      action: 'auth.login',
      resource: 'session',
      result: error.code === 'INVALID_CREDENTIALS' ? 'denied' : 'error',
      details: { username: String(req.body?.username || '').slice(0, 64), code: error.code || 'LOGIN_FAILED' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(() => {});
    if (error.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: error.message, code: error.code });
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  await authService.revokeSession(req.authToken);
  await authService.writeAudit({ userId: req.user.id, action: 'auth.logout', resource: 'session', result: 'success', ip: req.ip, userAgent: req.get('user-agent') });
  res.json({ message: '已退出登录' });
});

router.post('/change-password', authenticate, async (req, res) => {
  const currentPassword = req.body?.current_password;
  const newPassword = req.body?.new_password;
  try {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      const error = new Error('Current and new passwords are required');
      error.code = 'INVALID_INPUT';
      throw error;
    }
    const user = await authService.changePassword(req.user.id, currentPassword, newPassword, req.authToken);
    await authService.writeAudit({
      userId: req.user.id,
      action: 'auth.password.change',
      resource: 'user',
      resourceId: req.user.id,
      details: { username: req.user.username },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json({ data: user });
  } catch (error) {
    await authService.writeAudit({
      userId: req.user.id,
      action: 'auth.password.change',
      resource: 'user',
      resourceId: req.user.id,
      result: error.code === 'INVALID_CURRENT_PASSWORD' ? 'denied' : 'error',
      details: { code: error.code || 'PASSWORD_CHANGE_FAILED' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(() => {});
    res.status(400).json({ error: error.message, code: error.code || 'PASSWORD_CHANGE_FAILED' });
  }
});

router.get('/me', authenticate, (req, res) => res.json({ data: req.user }));
router.get('/permissions', authenticate, (req, res) => res.json({ data: { permissions: req.user.permissions, roles: req.user.roles } }));

module.exports = router;
