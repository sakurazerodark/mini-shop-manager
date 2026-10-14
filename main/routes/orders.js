const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { PERMISSIONS, protect } = require('../middleware/permissions');

router.get('/', protect(PERMISSIONS.ORDER_VIEW), orderController.getOrders);
router.post('/', protect(PERMISSIONS.PAYMENT_CREATE), orderController.submitOrder);
router.get('/recent', protect(PERMISSIONS.ORDER_VIEW), orderController.getRecentOrders);
router.post('/pending', protect(PERMISSIONS.PAYMENT_CREATE), orderController.createPendingOrder);
router.get('/:id', protect(PERMISSIONS.ORDER_VIEW), orderController.getOrderById);
router.post('/:id/cancel', protect(PERMISSIONS.PAYMENT_CONFIRM), orderController.cancelOrder);
router.post('/:id/manual_pay', protect(PERMISSIONS.PAYMENT_CONFIRM), orderController.manualPayOrder);
router.post('/:id/complete', protect(PERMISSIONS.PAYMENT_CONFIRM), orderController.completeOrder);
router.post('/:id/refund', protect(PERMISSIONS.REFUND_EXECUTE), orderController.refundOrder);

module.exports = router;
