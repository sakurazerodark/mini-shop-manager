const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { PERMISSIONS, protect } = require('../middleware/permissions');

router.post('/alipay/reconcile/:orderId', protect(PERMISSIONS.PAYMENT_RECONCILE), paymentController.reconcileAlipay);
router.post('/alipay/precreate', protect(PERMISSIONS.PAYMENT_CREATE), paymentController.alipayPrecreate);
router.post('/alipay/pay', protect(PERMISSIONS.PAYMENT_CREATE), paymentController.alipayPay);
router.get('/alipay/query/:orderId', protect(PERMISSIONS.PAYMENT_RECORD_VIEW), paymentController.alipayQuery);

// Webhooks
router.post('/alipay/notify', express.urlencoded({ extended: false }), paymentController.alipayNotify);
router.post('/wechatpay/notify', paymentController.wechatpayNotify);
router.post('/unionpay/notify', express.urlencoded({ extended: false }), paymentController.unionpayNotify);

module.exports = router;
