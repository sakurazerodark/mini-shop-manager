const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码', code: 'INVALID_INPUT' });
    const result = await authService.login(username, password, { ip: req.ip, userAgent: req.get('user-agent') });
    await authService.writeAudit({ userId: result.user.id, action: 'auth.login', resource: 'session', result: 'success', ip: req.ip, userAgent: req.get('user-agent') });
    res.json(result);
  } catch (error) {
    if (error.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: error.message, code: error.code });
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  await authService.revokeSession(req.authToken);
  await authService.writeAudit({ userId: req.user.id, action: 'auth.logout', resource: 'session', result: 'success', ip: req.ip, userAgent: req.get('user-agent') });
  res.json({ message: '已退出登录' });
});

router.get('/me', authenticate, (req, res) => res.json({ data: req.user }));
router.get('/permissions', authenticate, (req, res) => res.json({ data: { permissions: req.user.permissions, roles: req.user.roles } }));

module.exports = router;
