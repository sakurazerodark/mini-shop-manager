const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { dbAll, dbRun } = require('../database');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/permissions', requirePermission('role.view'), async (_req, res) => {
  try { res.json({ data: await dbAll('SELECT id, permission_key, name, description FROM permissions ORDER BY permission_key') }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/', requirePermission('role.view'), async (_req, res) => {
  try { res.json({ data: await authService.listRoles() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/:id', requirePermission('role.view'), async (req, res) => {
  try {
    const role = (await authService.listRoles()).find(item => item.id === Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json({ data: role });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/:id/permissions', requirePermission('role.view'), async (req, res) => {
  try {
    const role = (await authService.listRoles()).find(item => item.id === Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json({ data: { permissions: (role.permissions || []).map(item => item.permission_key) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/', requirePermission('role.manage'), async (req, res) => {
  try {
    const role = await authService.createRole(req.body || {});
    await authService.writeAudit({ userId: req.user.id, action: 'role.create', resource: 'role', resourceId: role.id, details: { name: role.name }, ip: req.ip, userAgent: req.get('user-agent') });
    res.status(201).json({ data: role });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message }); }
});

router.put('/:id', requirePermission('role.manage'), async (req, res) => {
  try {
    const role = await authService.updateRole(req.params.id, req.body || {});
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await authService.writeAudit({ userId: req.user.id, action: 'role.update', resource: 'role', resourceId: role.id, details: { changed_keys: Object.keys(req.body || {}) }, ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ data: role });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.put('/:id/permissions', requirePermission('role.manage'), async (req, res) => {
  try {
    const role = await authService.updateRole(req.params.id, {
      permission_keys: req.body?.permission_keys || req.body?.permissions || []
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await authService.writeAudit({ userId: req.user.id, action: 'role.permissions.update', resource: 'role', resourceId: role.id, details: { permission_count: (role.permissions || []).length }, ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ data: role });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.delete('/:id', requirePermission('role.manage'), async (req, res) => {
  try {
    const role = (await authService.listRoles()).find(item => item.id === Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.built_in) return res.status(400).json({ error: 'Built-in roles cannot be deleted' });
    await dbRun('DELETE FROM roles WHERE id = ?', [req.params.id]);
    await authService.writeAudit({ userId: req.user.id, action: 'role.delete', resource: 'role', resourceId: req.params.id, ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ message: 'Role deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
