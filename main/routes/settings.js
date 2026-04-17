const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');

router.get('/basic', settingController.getBasicSettings);
router.put('/basic', settingController.updateBasicSettings);
router.get('/costing_mode', settingController.getCostingMode);
router.put('/costing_mode', settingController.updateCostingMode);
router.get('/barcode_lookup', settingController.getBarcodeLookup);
router.put('/barcode_lookup', settingController.updateBarcodeLookup);
router.get('/payments', settingController.getPayments);
router.put('/payments', settingController.updatePayments);
router.get('/data_dir', settingController.getDataDir);
router.post('/data_dir/select', settingController.selectDataDir);
router.post('/data_dir/migrate', settingController.migrateDataDir);
router.get('/network', settingController.getNetworkConfig);
router.put('/network', settingController.updateNetworkConfig);

module.exports = router;