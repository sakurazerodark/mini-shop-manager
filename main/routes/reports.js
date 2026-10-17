const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { PERMISSIONS, protect } = require('../middleware/permissions');

router.get('/today', protect(PERMISSIONS.REPORT_VIEW), orderController.getTodayReport);
router.get('/analysis', protect(PERMISSIONS.REPORT_VIEW), orderController.getBusinessAnalysis);

module.exports = router;
