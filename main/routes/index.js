const express = require('express');
const router = express.Router();

const barcodeRoutes = require('./barcode');
const productsRoutes = require('./products');
const settingsRoutes = require('./settings');
const suppliersRoutes = require('./suppliers');
const reportsRoutes = require('./reports');
const ordersRoutes = require('./orders');
const paymentsRoutes = require('./payments');

router.use('/barcode', barcodeRoutes);
router.use('/products', productsRoutes);
router.use('/settings', settingsRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/reports', reportsRoutes);
router.use('/orders', ordersRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;