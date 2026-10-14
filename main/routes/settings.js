const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { PERMISSIONS, protect, paymentSettingsPermissions } = require('../middleware/permissions');

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
