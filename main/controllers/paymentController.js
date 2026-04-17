const logger = require('../logger');
const paymentService = require('../services/paymentService');
const orderService = require('../services/orderService');
const settingService = require('../services/settingService');
const { db } = require('../database');

const tail = (v, n = 8) => {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= n ? s : s.slice(-n);
};

exports.reconcileAlipay = async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const result = await paymentService.reconcileAlipayOrder(orderId, { requestId: req.requestId, purpose: 'manual_reconcile' });
    if (!result.ok) return res.status(400).json({ error: result.error || '对账失败', raw: result.raw });
    res.json({ data: { paid: result.paid, trade_status: result.trade_status || 'UNKNOWN' } });
  } catch (e) {
    logger.error('alipay reconcile error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ error: e.message });
  }
};

exports.alipayPrecreate = async (req, res) => {
  const { order_id, total_amount, subject } = req.body || {};
  try {
    const cfg = await paymentService.getAlipayConfig();
    if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return res.status(400).json({ error: '支付宝配置不完整' });
    logger.info('alipay precreate request', { request_id: req.requestId, order_id: String(order_id), notify_enabled: Boolean(cfg.notifyUrl), notify_url: cfg.notifyUrl || '' });
    const storeName = await settingService.getSetting('store_name', '店小易');
    const bizContent = {
      out_trade_no: String(order_id),
      total_amount: paymentService.toMoneyString(total_amount),
      subject: String(subject || `${storeName} - 订单 ${order_id}`)
    };
    const json = await paymentService.alipayRequest({ method: 'alipay.trade.precreate', bizContent, config: cfg, requestId: req.requestId, purpose: 'api' });
    const resp = json.alipay_trade_precreate_response || {};
    logger.info('alipay precreate response', {
      request_id: req.requestId,
      out_trade_no: String(order_id),
      code: String(resp.code || ''),
      msg: resp.msg || '',
      sub_msg: resp.sub_msg || '',
      trace_id: resp.trace_id || '',
      qr_code_set: Boolean(resp.qr_code)
    });
    await orderService.updateOrderPayMeta({
      orderId: order_id,
      provider: 'alipay',
      outTradeNo: order_id,
      traceId: resp.trace_id || '',
      providerStatus: 'PRECREATE',
      providerCode: resp.code || '',
      providerMsg: resp.msg || '',
      providerSubMsg: resp.sub_msg || '',
      syncVia: 'api_precreate',
      payStatus: String(resp.code) === '10000' ? 'created' : 'failed'
    });
    if (String(resp.code) !== '10000') return res.status(400).json({ error: resp.sub_msg || resp.msg || '预下单失败', raw: resp });
    await new Promise((resolve) => db.run("UPDATE orders SET pay_provider = 'alipay', pay_out_trade_no = ?, pay_status = 'created' WHERE id = ?", [String(order_id), String(order_id)], resolve));
    res.json({ data: { qr_code: resp.qr_code, out_trade_no: String(order_id) } });
  } catch (e) {
    logger.error('alipay precreate error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ error: e.message });
  }
};

exports.alipayPay = async (req, res) => {
  const { order_id, total_amount, subject, auth_code } = req.body || {};
  try {
    const cfg = await paymentService.getAlipayConfig();
    if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return res.status(400).json({ error: '支付宝配置不完整' });
    if (!auth_code) return res.status(400).json({ error: '缺少 auth_code' });
    const storeName = await settingService.getSetting('store_name', '店小易');
    const bizContent = {
      out_trade_no: String(order_id),
      total_amount: paymentService.toMoneyString(total_amount),
      subject: String(subject || `${storeName} - 订单 ${order_id}`),
      auth_code: String(auth_code)
    };
    const json = await paymentService.alipayRequest({ method: 'alipay.trade.pay', bizContent, config: cfg, requestId: req.requestId, purpose: 'api' });
    const resp = json.alipay_trade_pay_response || {};
    logger.info('alipay pay response', {
      request_id: req.requestId,
      out_trade_no: String(order_id),
      code: String(resp.code || ''),
      msg: resp.msg || '',
      sub_msg: resp.sub_msg || '',
      trace_id: resp.trace_id || '',
      trade_no_tail: tail(resp.trade_no),
      trade_status: String(resp.trade_status || '').toUpperCase()
    });
    const tradeStatus = String(resp.trade_status || '').toUpperCase();
    const internal = String(resp.code) === '10003' ? 'paying' : String(resp.code) === '10000' ? paymentService.mapAlipayTradeStatus(tradeStatus) : 'failed';
    await orderService.updateOrderPayMeta({
      orderId: order_id,
      provider: 'alipay',
      outTradeNo: order_id,
      tradeNo: resp.trade_no || '',
      traceId: resp.trace_id || '',
      providerStatus: tradeStatus || '',
      providerCode: resp.code || '',
      providerMsg: resp.msg || '',
      providerSubMsg: resp.sub_msg || '',
      syncVia: 'api_pay',
      payStatus: internal
    });
    if (String(resp.code) !== '10000' && String(resp.code) !== '10003') {
      return res.status(400).json({ error: resp.sub_msg || resp.msg || '付款失败', raw: resp });
    }
    const status = String(resp.trade_status || '').toUpperCase();
    const paid = status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
    if (paid) {
      await orderService.markOrderPaid({ orderId: order_id, provider: 'alipay', tradeNo: resp.trade_no || '', confirmedVia: 'polling' });
    } else {
      await new Promise((resolve) => db.run("UPDATE orders SET pay_provider = 'alipay', pay_status = 'paying' WHERE id = ?", [String(order_id)], resolve));
    }
    res.json({ data: { trade_status: status || 'UNKNOWN', paid } });
  } catch (e) {
    logger.error('alipay pay error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ error: e.message });
  }
};

exports.alipayQuery = async (req, res) => {
  try {
    const cfg = await paymentService.getAlipayConfig();
    if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return res.status(400).json({ error: '支付宝配置不完整' });
    const bizContent = { out_trade_no: String(req.params.orderId) };
    const json = await paymentService.alipayRequest({ method: 'alipay.trade.query', bizContent, config: cfg, requestId: req.requestId, purpose: 'api' });
    const resp = json.alipay_trade_query_response || {};
    logger.info('alipay query response', {
      request_id: req.requestId,
      out_trade_no: String(req.params.orderId),
      code: String(resp.code || ''),
      msg: resp.msg || '',
      sub_msg: resp.sub_msg || '',
      trace_id: resp.trace_id || '',
      trade_no_tail: tail(resp.trade_no),
      trade_status: String(resp.trade_status || '').toUpperCase()
    });
    const tradeStatus = String(resp.trade_status || '').toUpperCase();
    await orderService.updateOrderPayMeta({
      orderId: req.params.orderId,
      provider: 'alipay',
      outTradeNo: req.params.orderId,
      tradeNo: resp.trade_no || '',
      traceId: resp.trace_id || '',
      providerStatus: tradeStatus || '',
      providerCode: resp.code || '',
      providerMsg: resp.msg || '',
      providerSubMsg: resp.sub_msg || '',
      syncVia: 'api_query',
      payStatus: String(resp.code) === '10000' ? paymentService.mapAlipayTradeStatus(tradeStatus) : 'failed'
    });
    if (String(resp.code) !== '10000') return res.status(400).json({ error: resp.sub_msg || resp.msg || '查询失败', raw: resp });
    const status = String(resp.trade_status || '').toUpperCase();
    const paid = status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
    if (paid) {
      await orderService.markOrderPaid({ orderId: req.params.orderId, provider: 'alipay', tradeNo: resp.trade_no || '', confirmedVia: 'polling' });
    }
    res.json({ data: { trade_status: status || 'UNKNOWN', paid } });
  } catch (e) {
    logger.error('alipay query error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ error: e.message });
  }
};

const cryptoUtils = require('../utils/crypto');

exports.alipayNotify = async (req, res) => {
  try {
    const cfg = await paymentService.getAlipayConfig();
    if (!cfg.alipayPublicKey) return res.status(400).send('fail');
    const form = req.body || {};
    const ok = cryptoUtils.alipayVerifySign(form, cfg.alipayPublicKey);
    if (!ok) {
      logger.warn('alipay notify signature invalid', { request_id: req.requestId, out_trade_no: String(form.out_trade_no || '').trim(), trade_no_tail: tail(form.trade_no) });
      return res.status(400).send('fail');
    }

    const outTradeNo = String(form.out_trade_no || '').trim();
    const tradeNo = String(form.trade_no || '').trim();
    const tradeStatus = String(form.trade_status || '').trim().toUpperCase();
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
    await orderService.updateOrderPayMeta({
      orderId: outTradeNo,
      provider: 'alipay',
      outTradeNo,
      tradeNo,
      providerStatus: tradeStatus,
      syncVia: 'callback_alipay',
      payStatus: paymentService.mapAlipayTradeStatus(tradeStatus)
    });
    if (outTradeNo && paid) {
      await orderService.markOrderPaid({ orderId: outTradeNo, provider: 'alipay', tradeNo, confirmedVia: 'callback' });
      await orderService.completePendingOrder(outTradeNo).catch(() => {});
      logger.info('alipay notify paid', { request_id: req.requestId, out_trade_no: outTradeNo, trade_no: tradeNo, trade_status: tradeStatus });
    } else {
      logger.info('alipay notify received', { request_id: req.requestId, out_trade_no: outTradeNo, trade_no_tail: tail(tradeNo), trade_status: tradeStatus });
    }
    res.send('success');
  } catch (e) {
    logger.error('alipay notify error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).send('fail');
  }
};

exports.wechatpayNotify = async (req, res) => {
  try {
    const cfg = await paymentService.getWechatpayConfig();
    if (!cfg.apiV3Key || !cfg.platformCert) return res.status(400).json({ code: 'FAIL', message: 'config missing' });
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const verified = cryptoUtils.wechatpayVerifySignature(req.headers, rawBody, cfg.platformCert);
    if (!verified) {
      logger.warn('wechatpay notify signature invalid', { request_id: req.requestId, wechatpay_serial: String(req.headers['wechatpay-serial'] || req.headers['Wechatpay-Serial'] || '') });
      return res.status(400).json({ code: 'FAIL', message: 'signature invalid' });
    }

    const payload = req.body || {};
    const resource = payload.resource || {};
    const decrypted = cryptoUtils.wechatpayDecryptResource(resource, cfg.apiV3Key);
    const outTradeNo = String(decrypted.out_trade_no || '').trim();
    const transactionId = String(decrypted.transaction_id || '').trim();
    const tradeState = String(decrypted.trade_state || '').trim().toUpperCase();
    const paid = tradeState === 'SUCCESS';
    await orderService.updateOrderPayMeta({
      orderId: outTradeNo,
      provider: 'wechatpay',
      outTradeNo,
      tradeNo: transactionId,
      providerStatus: tradeState,
      providerCode: tradeState,
      providerMsg: decrypted.trade_state_desc || '',
      syncVia: 'callback_wechatpay',
      payStatus: paymentService.mapWechatTradeState(tradeState)
    });
    if (outTradeNo && paid) {
      await orderService.markOrderPaid({ orderId: outTradeNo, provider: 'wechatpay', tradeNo: transactionId, confirmedVia: 'callback' });
      await orderService.completePendingOrder(outTradeNo).catch(() => {});
      logger.info('wechatpay notify paid', { request_id: req.requestId, out_trade_no: outTradeNo, transaction_id: transactionId, trade_state: tradeState, wechatpay_serial: String(req.headers['wechatpay-serial'] || req.headers['Wechatpay-Serial'] || '') });
    } else {
      logger.info('wechatpay notify received', { request_id: req.requestId, out_trade_no: outTradeNo, transaction_id_tail: tail(transactionId), trade_state: tradeState });
    }

    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (e) {
    logger.error('wechatpay notify error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ code: 'FAIL', message: 'server error' });
  }
};

const { pickPaymentConfig } = require('../services/settingService');

exports.unionpayNotify = async (req, res) => {
  try {
    const cfg = await pickPaymentConfig();
    const u = cfg.unionpay || {};
    const form = req.body || {};
    if (u.verify_cert) {
      const ok = cryptoUtils.unionpayVerifySignature(form, u.verify_cert);
      if (!ok) {
        logger.warn('unionpay notify signature invalid', { request_id: req.requestId, order_id: String(form.orderId || form.order_id || form.out_trade_no || '').trim() });
        return res.status(400).send('fail');
      }
    }

    const orderId = String(form.orderId || form.order_id || form.out_trade_no || '').trim();
    const respCode = String(form.respCode || form.resp_code || '').trim();
    const queryId = String(form.queryId || form.query_id || '').trim();
    await orderService.updateOrderPayMeta({
      orderId,
      provider: 'unionpay',
      outTradeNo: orderId,
      tradeNo: queryId,
      providerStatus: respCode,
      providerCode: respCode,
      providerMsg: form.respMsg || form.resp_msg || '',
      providerSubMsg: form.respDesc || form.resp_desc || '',
      syncVia: 'callback_unionpay',
      payStatus: paymentService.mapUnionpayRespCode(respCode)
    });
    if (orderId && respCode === '00') {
      await orderService.markOrderPaid({ orderId, provider: 'unionpay', tradeNo: queryId, confirmedVia: 'callback' });
      await orderService.completePendingOrder(orderId).catch(() => {});
      logger.info('unionpay notify paid', { request_id: req.requestId, order_id: orderId, query_id: queryId, resp_code: respCode });
    } else {
      logger.info('unionpay notify received', { request_id: req.requestId, order_id: orderId, query_id_tail: tail(queryId), resp_code: respCode });
    }
    res.send('ok');
  } catch (e) {
    logger.error('unionpay notify error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).send('fail');
  }
};
