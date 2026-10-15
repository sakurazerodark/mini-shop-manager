const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, PERMISSIONS } = require('../middleware/permissions');

router.get('/', protect(PERMISSIONS.ORDER_VIEW), productController.getAllProducts);
router.get('/stock-logs', protect(PERMISSIONS.ORDER_VIEW), productController.getAllStockLogs);
router.get('/deleted', protect(PERMISSIONS.ORDER_VIEW), productController.getDeletedProducts);
router.post('/', protect(PERMISSIONS.ORDER_MANAGE), productController.addProduct);
router.get('/barcode/:barcode', protect(PERMISSIONS.ORDER_VIEW), productController.getProductByBarcode);
router.put('/:id', protect(PERMISSIONS.ORDER_MANAGE), productController.updateProduct);
router.delete('/:id', protect(PERMISSIONS.ORDER_MANAGE), productController.deleteProduct);
router.post('/:id/restore', protect(PERMISSIONS.ORDER_MANAGE), productController.restoreProduct);
router.put('/:id/prices', protect(PERMISSIONS.ORDER_MANAGE), productController.updateProductPrices);
router.get('/:id/price-logs', protect(PERMISSIONS.ORDER_VIEW), productController.getProductPriceLogs);
router.post('/:id/loss', protect(PERMISSIONS.ORDER_MANAGE), productController.reportProductLoss);
router.post('/:id/restock', protect(PERMISSIONS.ORDER_MANAGE), productController.restockProduct);
router.post('/:id/adjust', protect(PERMISSIONS.ORDER_MANAGE), productController.adjustProductStock);
router.get('/:id/logs', protect(PERMISSIONS.ORDER_VIEW), productController.getProductStockLogs);

module.exports = router;
