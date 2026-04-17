const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/alipay/reconcile/:orderId', paymentController.reconcileAlipay);
router.post('/alipay/precreate', paymentController.alipayPrecreate);
router.post('/alipay/pay', paymentController.alipayPay);
router.get('/alipay/query/:orderId', paymentController.alipayQuery);

// Webhooks
router.post('/alipay/notify', express.urlencoded({ extended: false }), paymentController.alipayNotify);
router.post('/wechatpay/notify', paymentController.wechatpayNotify);
router.post('/unionpay/notify', express.urlencoded({ extended: false }), paymentController.unionpayNotify);

module.exports = router;