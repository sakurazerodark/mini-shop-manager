const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const authService = require('../services/authService');
const { PERMISSIONS, protect, paymentSettingsPermissions } = require('../middleware/permissions');
const { requireSuperAdmin } = require('../middleware/auth');

router.get(['/default-password/status', '/default-password'], protect(PERMISSIONS.ACCOUNT_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    res.json({ data: await authService.getDefaultPasswordStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/default-password', protect(PERMISSIONS.ACCOUNT_MANAGE), requireSuperAdmin, async (req, res) => {
  try {
    const password = req.body?.password ?? req.body?.default_password ?? req.body?.new_password;
    const data = await authService.setDefaultPassword(password);
    await authService.writeAudit({
      userId: req.user.id,
      action: 'settings.default_password.update',
      resource: 'setting',
      resourceId: 'default_user_password_hash',
      details: { configured: data.configured },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json({ data });
  } catch (error) {
    await authService.writeAudit({
      userId: req.user.id,
      action: 'settings.default_password.update',
      resource: 'setting',
      resourceId: 'default_user_password_hash',
      result: 'error',
      details: { code: error.code || 'DEFAULT_PASSWORD_UPDATE_FAILED' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(() => {});
    res.status(400).json({ error: error.message, code: error.code || 'DEFAULT_PASSWORD_UPDATE_FAILED' });
  }
});

router.get('/basic', protect(PERMISSIONS.ACCOUNT_VIEW), settingController.getBasicSettings);
router.put('/basic', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.updateBasicSettings);
router.get('/costing_mode', protect(PERMISSIONS.ACCOUNT_VIEW), settingController.getCostingMode);
router.put('/costing_mode', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.updateCostingMode);
router.get('/barcode_lookup', protect(PERMISSIONS.ACCOUNT_VIEW), settingController.getBarcodeLookup);
router.put('/barcode_lookup', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.updateBarcodeLookup);
router.get('/payments', protect(PERMISSIONS.PAYMENT_CONFIG_VIEW), settingController.getPayments);
router.put('/payments', protect(paymentSettingsPermissions), settingController.updatePayments);
router.get('/data_dir', protect(PERMISSIONS.ACCOUNT_VIEW), settingController.getDataDir);
router.post('/data_dir/select', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.selectDataDir);
router.post('/data_dir/migrate', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.migrateDataDir);
router.get('/network', protect(PERMISSIONS.ACCOUNT_VIEW), settingController.getNetworkConfig);
router.put('/network', protect(PERMISSIONS.ACCOUNT_MANAGE), settingController.updateNetworkConfig);

module.exports = router;
