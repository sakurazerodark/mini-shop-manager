const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

router.get('/', productController.getAllProducts);
router.get('/deleted', productController.getDeletedProducts);
router.post('/', productController.addProduct);
router.get('/barcode/:barcode', productController.getProductByBarcode);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
router.post('/:id/restore', productController.restoreProduct);
router.put('/:id/prices', productController.updateProductPrices);
router.get('/:id/price-logs', productController.getProductPriceLogs);
router.post('/:id/loss', productController.reportProductLoss);
router.post('/:id/restock', productController.restockProduct);
router.post('/:id/adjust', productController.adjustProductStock);
router.get('/:id/logs', productController.getProductStockLogs);

module.exports = router;