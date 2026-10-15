const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { dbRun } = require('../database');
const { requireSuperAdmin } = require('../middleware/auth');
const { protect, PERMISSIONS } = require('../middleware/permissions');

router.get('/', protect(PERMISSIONS.ACCOUNT_VIEW), async (req, res) => {
  try {
    res.json(await authService.listUsers({
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit,
      search: req.query.search,
      status: req.query.status
    }));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/', protect(PERMISSIONS.ACCOUNT_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    const user = await authService.createUser(req.body || {});
    await authService.writeAudit({ userId: req.user.id, action: 'user.create', resource: 'user', resourceId: user.id, details: { username: user.username }, ip: req.ip, userAgent: req.get('user-agent') });
    res.status(201).json({ data: user });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message }); }
});

router.get('/:id', protect(PERMISSIONS.ACCOUNT_VIEW), async (req, res) => {
  try {
    const user = await authService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json({ data: authService.publicUser(user) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/:id/roles', protect(PERMISSIONS.ACCOUNT_VIEW), async (req, res) => {
  try {
    const user = await authService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json({ data: user.roles || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/:id/roles', protect(PERMISSIONS.ROLE_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    const user = await authService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const roleIds = req.body?.role_ids || req.body?.roles || [];
    const normalizedRoleIds = Array.isArray(roleIds) ? [...new Set(roleIds.map(Number).filter(Number.isInteger))] : [];
    const ownerRole = (await authService.listRoles()).find(role => role.name === 'store_owner');
    const keepsOwner = ownerRole && normalizedRoleIds.includes(Number(ownerRole.id));
    if (Number(req.params.id) === req.user.id && !keepsOwner) return res.status(400).json({ error: 'Cannot remove super administrator access from the current account' });
    if ((user.roles || []).some(role => role.name === 'store_owner') && !keepsOwner && (await authService.getSuperAdminCount()) <= 1) {
      return res.status(400).json({ error: 'At least one super administrator is required', code: 'SUPER_ADMIN_REQUIRED' });
    }
    await authService.setUserRoles(req.params.id, roleIds);
    const updated = authService.publicUser(await authService.getUserById(req.params.id));
    await authService.writeAudit({ userId: req.user.id, action: 'user.roles.update', resource: 'user', resourceId: req.params.id, details: { role_ids: normalizedRoleIds }, ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ data: updated });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.put('/:id', protect(PERMISSIONS.ACCOUNT_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    const existing = await authService.getUserById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    if (Number(req.params.id) === req.user.id && req.body?.status === 'disabled') return res.status(400).json({ error: 'Cannot disable the current account' });
    if (req.body?.status === 'disabled' && (existing.roles || []).some(role => role.name === 'store_owner') && (await authService.getSuperAdminCount()) <= 1) {
      return res.status(400).json({ error: 'At least one super administrator is required', code: 'SUPER_ADMIN_REQUIRED' });
    }
    const user = await authService.updateUser(req.params.id, req.body || {});
    await authService.writeAudit({ userId: req.user.id, action: 'user.update', resource: 'user', resourceId: user.id, details: { changed_keys: Object.keys(req.body || {}) }, ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ data: user });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message }); }
});

router.delete('/:id', protect(PERMISSIONS.ACCOUNT_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete the current account' });
    const existing = await authService.getUserById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    if ((existing.roles || []).some(role => role.name === 'store_owner')) return res.status(400).json({ error: 'Cannot delete a super administrator', code: 'SUPER_ADMIN_PROTECTED' });
    await authService.writeAudit({ userId: req.user.id, action: 'user.delete', resource: 'user', resourceId: req.params.id, details: { username: existing.username }, ip: req.ip, userAgent: req.get('user-agent') });
    await dbRun('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Account deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
