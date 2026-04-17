const logger = require('../logger');
const { fetchJsonWithTimeout } = require('../utils/http');
const { pickPaymentConfig } = require('./settingService');
const { dbGet } = require('../database');
const {
  alipayEncryptBizContent,
  alipayDecryptBizContent,
  alipaySign
} = require('../utils/crypto');
const { updateOrderPayMeta, markOrderPaid, completePendingOrder } = require('./orderService');

const ALIPAY_GATEWAY_ALLOWLIST = new Set([
  'https://openapi.alipay.com/gateway.do',
  'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
]);

const normalizeAlipayGateway = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u = null;
  try {
    u = new URL(withScheme);
  } catch (_) {
    throw new Error('支付宝网关地址格式不正确');
  }
  const pathName = u.pathname || '';
  if (!pathName.endsWith('/gateway.do')) {
    throw new Error('支付宝网关地址必须以 /gateway.do 结尾');
  }
  const normalized = `${u.origin}${pathName}`;
  if (!ALIPAY_GATEWAY_ALLOWLIST.has(normalized)) {
    throw new Error('支付宝网关地址不在允许列表中');
  }
  return normalized;
};

const nowAlipayTimestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const toMoneyString = (v) => {
  const n = Number(v || 0);
  return n.toFixed(2);
};

const normalizeNotifyDomain = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u = null;
  try {
    u = new URL(withScheme);
  } catch (_) {
    throw new Error('回调域名格式不正确');
  }
  return u.origin;
};

const buildNotifyUrl = (domain, pathName) => {
  const origin = normalizeNotifyDomain(domain);
  const p = String(pathName || '').startsWith('/') ? String(pathName) : `/${pathName}`;
  return `${origin}${p}`;
};

const getAlipayConfig = async () => {
  const cfg = await pickPaymentConfig();
  const a = cfg.alipay_f2f || {};
  const appId = String(a.app_id || '').trim();
  let gateway = String(a.gateway || '').trim();
  if (gateway) {
    try {
      gateway = normalizeAlipayGateway(gateway);
    } catch (e) {
      logger.warn('alipay gateway invalid', { message: e?.message || String(e) });
      gateway = '';
    }
  }
  const notifyDomain = String(a.notify_url || '').trim();
  const merchantPrivateKey = String(a.merchant_private_key || '').trim();
  const alipayPublicKey = String(a.alipay_public_key || '').trim();
  const encryptKey = String(a.encrypt_key || '').trim();
  const notifyUrl = notifyDomain ? buildNotifyUrl(notifyDomain, '/api/payments/alipay/notify') : '';
  return { appId, gateway, notifyUrl, notifyDomain, merchantPrivateKey, alipayPublicKey, encryptKey };
};

const getWechatpayConfig = async () => {
  const cfg = await pickPaymentConfig();
  const w = cfg.wechatpay_v3 || {};
  const mchid = String(w.mchid || '').trim();
  const appid = String(w.appid || '').trim();
  const serialNo = String(w.serial_no || '').trim();
  const notifyDomain = String(w.notify_url || '').trim();
  const notifyUrl = notifyDomain ? buildNotifyUrl(notifyDomain, '/api/payments/wechatpay/notify') : '';
  const apiV3Key = String(w.api_v3_key || '').trim();
  const merchantPrivateKey = String(w.merchant_private_key || '').trim();
  const platformCert = String(w.platform_cert || '').trim();
  return { mchid, appid, serialNo, notifyDomain, notifyUrl, apiV3Key, merchantPrivateKey, platformCert };
};

const alipayRequest = async ({ method, bizContent, config, requestId, purpose }) => {
  const p = String(purpose || 'api');
  config.gateway = normalizeAlipayGateway(config.gateway);
  const encryptEnabled = typeof config.encryptKey === 'string' && config.encryptKey.trim().length > 0;
  const params = {
    app_id: config.appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: nowAlipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent || {})
  };
  if (encryptEnabled) {
    params.encrypt_type = 'AES';
    params.biz_content = alipayEncryptBizContent(params.biz_content, config.encryptKey);
  }
  if (config.notifyUrl) params.notify_url = config.notifyUrl;

  if (p !== 'reconcile_job') {
    logger.info('alipay gateway request', {
      request_id: requestId,
      purpose: p,
      method,
      gateway: config.gateway,
      notify_url: params.notify_url || '',
      out_trade_no: bizContent?.out_trade_no ? String(bizContent.out_trade_no) : ''
    });
  }
  params.sign = alipaySign(params, config.merchantPrivateKey);

  const body = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
    
  const resp = await fetchJsonWithTimeout(
    config.gateway,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body },
    8000
  ).catch(() => null);
  if (!resp?.ok || !resp.json) throw new Error('支付宝网关请求失败');
  const json = resp.json;
  if (encryptEnabled) {
    const responseKey = `${String(method).replace(/\./g, '_')}_response`;
    const encryptedBlock = json?.[responseKey];
    if (typeof encryptedBlock === 'string' && encryptedBlock.trim()) {
      try {
        const plain = alipayDecryptBizContent(encryptedBlock, config.encryptKey);
        json[responseKey] = JSON.parse(plain);
      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        throw new Error(`支付宝响应解密失败：${msg}`);
      }
    }
  }
  return json;
};

const mapAlipayTradeStatus = (tradeStatus) => {
  const s = String(tradeStatus || '').toUpperCase();
  if (s === 'TRADE_SUCCESS' || s === 'TRADE_FINISHED') return 'paid';
  if (s === 'WAIT_BUYER_PAY') return 'paying';
  if (s === 'TRADE_CLOSED') return 'closed';
  return s ? 'paying' : null;
};

const mapWechatTradeState = (tradeState) => {
  const s = String(tradeState || '').toUpperCase();
  if (s === 'SUCCESS') return 'paid';
  if (s === 'NOTPAY') return 'created';
  if (s === 'USERPAYING') return 'paying';
  if (s === 'CLOSED' || s === 'REVOKED') return 'closed';
  if (s === 'PAYERROR') return 'failed';
  return s ? 'paying' : null;
};

const mapUnionpayRespCode = (respCode) => {
  const c = String(respCode || '').trim();
  if (c === '00') return 'paid';
  if (c === '03' || c === '04' || c === '05') return 'paying';
  return c ? 'failed' : null;
};

const reconcileAlipayOrder = async (orderId, { requestId, purpose } = {}) => {
  const cfg = await getAlipayConfig();
  if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return { ok: false, error: '支付宝配置不完整' };
  const local = await dbGet("SELECT id, total_amount FROM orders WHERE id = ?", [String(orderId)]).catch(() => null);
  const bizContent = { out_trade_no: String(orderId) };
  const json = await alipayRequest({ method: 'alipay.trade.query', bizContent, config: cfg, requestId, purpose });
  const resp = json.alipay_trade_query_response || {};
  const status = String(resp.trade_status || '').toUpperCase();
  const syncVia = purpose === 'manual_reconcile' ? 'manual_reconcile' : 'reconcile_job';
  const expectedAmount = local && local.total_amount !== undefined && local.total_amount !== null ? toMoneyString(local.total_amount) : null;
  const gotAmount = resp.total_amount !== undefined && resp.total_amount !== null ? toMoneyString(resp.total_amount) : null;
  const amountOk = !expectedAmount || !gotAmount ? true : expectedAmount === gotAmount;
  const amountMsg = amountOk ? '' : `金额校验失败 expected=${expectedAmount} got=${gotAmount}`;
  await updateOrderPayMeta({
    orderId,
    provider: 'alipay',
    outTradeNo: orderId,
    tradeNo: resp.trade_no || '',
    traceId: resp.trace_id || '',
    providerStatus: status || '',
    providerCode: resp.code || '',
    providerMsg: resp.msg || '',
    providerSubMsg: amountMsg || resp.sub_msg || '',
    syncVia,
    payStatus: String(resp.code) === '10000' ? (amountOk ? mapAlipayTradeStatus(status) : 'failed') : 'failed'
  });
  if (String(resp.code) !== '10000') return { ok: false, error: resp.sub_msg || resp.msg || '查询失败', raw: resp };
  const paid = status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
  if (paid && amountOk) {
    await markOrderPaid({ orderId, provider: 'alipay', tradeNo: resp.trade_no || '', confirmedVia: 'reconcile' });
    await completePendingOrder(orderId).catch(() => {});
  }
  if (!amountOk) return { ok: false, error: amountMsg, raw: resp };
  return { ok: true, paid, trade_status: status, trade_no: resp.trade_no || '', trace_id: resp.trace_id || '' };
};

const cancelAlipayOrder = async (orderId, { requestId, purpose } = {}) => {
  const cfg = await getAlipayConfig();
  if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return { ok: false, error: '支付宝配置不完整' };
  const bizContent = { out_trade_no: String(orderId) };
  const json = await alipayRequest({ method: 'alipay.trade.cancel', bizContent, config: cfg, requestId, purpose });
  const resp = json.alipay_trade_cancel_response || {};
  if (String(resp.code) !== '10000') return { ok: false, error: resp.sub_msg || resp.msg || '取消失败', raw: resp };
  return { ok: true, action: resp.action, trade_no: resp.trade_no };
};

const refundAlipayOrder = async (orderId, amount, { requestId, purpose, refundReason } = {}) => {
  const cfg = await getAlipayConfig();
  if (!cfg.appId || !cfg.gateway || !cfg.merchantPrivateKey) return { ok: false, error: '支付宝配置不完整' };
  const bizContent = {
    out_trade_no: String(orderId),
    refund_amount: Number(amount).toFixed(2),
    out_request_no: String(orderId) + '_' + Date.now(), // 部分退款需要唯一的请求号
    refund_reason: refundReason || '门店退款'
  };
  const json = await alipayRequest({ method: 'alipay.trade.refund', bizContent, config: cfg, requestId, purpose });
  const resp = json.alipay_trade_refund_response || {};
  if (String(resp.code) !== '10000') return { ok: false, error: resp.sub_msg || resp.msg || '退款失败', raw: resp };
  return { ok: true, trade_no: resp.trade_no, buyer_logon_id: resp.buyer_logon_id, fund_change: resp.fund_change, refund_fee: resp.refund_fee };
};

const sanitizePaymentConfig = (config) => {
  const c = config || {};
  const has = (v) => typeof v === 'string' && v.trim().length > 0;
  const notifyMode = (domain) => (typeof domain === 'string' && domain.trim() ? 'callback' : 'polling');
  const safeDomain = (d) => {
    try {
      return normalizeNotifyDomain(d);
    } catch (_) {
      return '';
    }
  };
  return {
    wechatpay_v3: {
      mchid: c.wechatpay_v3?.mchid || '',
      appid: c.wechatpay_v3?.appid || '',
      serial_no: c.wechatpay_v3?.serial_no || '',
      notify_domain: safeDomain(c.wechatpay_v3?.notify_url || ''),
      notify_url: safeDomain(c.wechatpay_v3?.notify_url || '') ? buildNotifyUrl(c.wechatpay_v3?.notify_url || '', '/api/payments/wechatpay/notify') : '',
      notify_mode: notifyMode(c.wechatpay_v3?.notify_url),
      api_v3_key_set: has(c.wechatpay_v3?.api_v3_key),
      merchant_private_key_set: has(c.wechatpay_v3?.merchant_private_key),
      platform_cert_set: has(c.wechatpay_v3?.platform_cert)
    },
    alipay_f2f: {
      app_id: c.alipay_f2f?.app_id || '',
      gateway: c.alipay_f2f?.gateway || '',
      notify_domain: safeDomain(c.alipay_f2f?.notify_url || ''),
      notify_url: safeDomain(c.alipay_f2f?.notify_url || '') ? buildNotifyUrl(c.alipay_f2f?.notify_url || '', '/api/payments/alipay/notify') : '',
      notify_mode: notifyMode(c.alipay_f2f?.notify_url),
      merchant_private_key_set: has(c.alipay_f2f?.merchant_private_key),
      alipay_public_key_set: has(c.alipay_f2f?.alipay_public_key),
      encrypt_key_set: has(c.alipay_f2f?.encrypt_key)
    },
    unionpay: {
      merchant_id: c.unionpay?.merchant_id || '',
      gateway: c.unionpay?.gateway || '',
      notify_domain: safeDomain(c.unionpay?.notify_url || ''),
      notify_url: safeDomain(c.unionpay?.notify_url || '') ? buildNotifyUrl(c.unionpay?.notify_url || '', '/api/payments/unionpay/notify') : '',
      notify_mode: notifyMode(c.unionpay?.notify_url),
      sign_cert_set: has(c.unionpay?.sign_cert),
      sign_key_set: has(c.unionpay?.sign_key),
      verify_cert_set: has(c.unionpay?.verify_cert)
    }
  };
};

module.exports = {
  nowAlipayTimestamp,
  toMoneyString,
  normalizeNotifyDomain,
  normalizeAlipayGateway,
  buildNotifyUrl,
  getAlipayConfig,
  getWechatpayConfig,
  alipayRequest,
  mapAlipayTradeStatus,
  mapWechatTradeState,
  mapUnionpayRespCode,
  reconcileAlipayOrder,
  cancelAlipayOrder,
  refundAlipayOrder,
  sanitizePaymentConfig
};
