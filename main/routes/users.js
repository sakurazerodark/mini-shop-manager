const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);
router.get('/', requirePermission('account.view'), async (req, res) => {
  try { res.json(await authService.listUsers({ page: req.query.page, pageSize: req.query.pageSize || req.query.limit, search: req.query.search, status: req.query.status })); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/', requirePermission('account.manage'), async (req, res) => {
  try { const user = await authService.createUser(req.body || {}); await authService.writeAudit({ userId: req.user.id, action: 'user.create', resource: 'user', resourceId: user.id, details: { username: user.username }, ip: req.ip, userAgent: req.get('user-agent') }); res.status(201).json({ data: user }); } catch (e) { res.status(e.message.includes('UNIQUE') ? 409 : 400).json({ error: e.message }); }
});
router.get('/:id', requirePermission('account.view'), async (req, res) => {
  try { const user = await authService.getUserById(req.params.id); if (!user) return res.status(404).json({ error: '账号不存在' }); res.json({ data: authService.publicUser(user) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/:id/roles', requirePermission('account.view'), async (req, res) => {
  try { const user = await authService.getUserById(req.params.id); if (!user) return res.status(404).json({ error: '账号不存在' }); res.json({ data: user.roles || [] }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/:id/roles', requirePermission('role.manage'), async (req, res) => {
  try { const user = await authService.getUserById(req.params.id); if (!user) return res.status(404).json({ error: '账号不存在' }); const roleIds = req.body?.role_ids || req.body?.roles || []; await authService.setUserRoles(req.params.id, roleIds); res.json({ data: await authService.publicUser(await authService.getUserById(req.params.id)) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requirePermission('account.manage'), async (req, res) => {
  try { const existing = await authService.getUserById(req.params.id); if (!existing) return res.status(404).json({ error: '账号不存在' }); if (Number(req.params.id) === req.user.id && req.body?.status === 'disabled') return res.status(400).json({ error: '不能禁用当前登录账号' }); const user = await authService.updateUser(req.params.id, req.body || {}); await authService.writeAudit({ userId: req.user.id, action: 'user.update', resource: 'user', resourceId: user.id, ip: req.ip, userAgent: req.get('user-agent') }); res.json({ data: user }); } catch (e) { res.status(e.message.includes('UNIQUE') ? 409 : 400).json({ error: e.message }); }
});
router.delete('/:id', requirePermission('account.manage'), async (req, res) => {
  try { if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: '不能删除当前登录账号' }); const existing = await authService.getUserById(req.params.id); if (!existing) return res.status(404).json({ error: '账号不存在' }); await authService.updateUser(req.params.id, { status: 'disabled' }); await authService.writeAudit({ userId: req.user.id, action: 'user.disable', resource: 'user', resourceId: req.params.id, ip: req.ip, userAgent: req.get('user-agent') }); res.json({ message: '账号已禁用' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
