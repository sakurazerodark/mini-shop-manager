const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, PERMISSIONS } = require('../middleware/permissions');

router.get('/lookup/:barcode', protect(PERMISSIONS.ORDER_VIEW), productController.lookupBarcode);

module.exports = router;
