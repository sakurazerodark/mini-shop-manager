const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { PERMISSIONS, protect } = require('../middleware/permissions');

router.get('/today', protect(PERMISSIONS.REPORT_VIEW), orderController.getTodayReport);

module.exports = router;
