const express = require('express');
const router = express.Router();

const barcodeRoutes = require('./barcode');
const productsRoutes = require('./products');
const settingsRoutes = require('./settings');
const suppliersRoutes = require('./suppliers');
const reportsRoutes = require('./reports');
const ordersRoutes = require('./orders');
const paymentsRoutes = require('./payments');
const authRoutes = require('./auth');
const usersRoutes = require('./users');
const rolesRoutes = require('./roles');

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/barcode', barcodeRoutes);
router.use('/products', productsRoutes);
router.use('/settings', settingsRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/reports', reportsRoutes);
router.use('/orders', ordersRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;
