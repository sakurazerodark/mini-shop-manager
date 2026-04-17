const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.get('/', orderController.getOrders);
router.post('/', orderController.submitOrder);
router.get('/recent', orderController.getRecentOrders);
router.post('/pending', orderController.createPendingOrder);
router.get('/:id', orderController.getOrderById);
router.post('/:id/cancel', orderController.cancelOrder);
router.post('/:id/manual_pay', orderController.manualPayOrder);
router.post('/:id/complete', orderController.completeOrder);
router.post('/:id/refund', orderController.refundOrder);

module.exports = router;