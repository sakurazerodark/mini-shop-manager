const { dbGet, dbRun, dbAll } = require('../database');

const DEFAULT_PAYMENT_PREFERENCES = {
  default_method: 'customer_dynamic_qr',
  methods: [
    { id: 'customer_dynamic_qr', category: 'customer_dynamic_qr', channel: 'alipay', channels: ['alipay', 'wechat', 'unionpay'], name: '客户扫动态码', enabled: true, sort: 10 },
    { id: 'merchant_scan_customer', category: 'merchant_scan_customer', channel: 'alipay', channels: ['alipay', 'wechat', 'unionpay'], name: '商家扫客户码', enabled: true, sort: 20 },
    { id: 'personal_qrcode', category: 'merchant_static_qr', channel: null, name: '商家静态二维码', enabled: true, sort: 30 },
    { id: 'cash', category: 'cash', channel: null, name: '现金支付', enabled: true, sort: 40 },
    { id: 'other', category: 'other', channel: null, name: '其他方式', enabled: true, sort: 50 }
  ]
};

const normalizePaymentPreferences = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  const legacyIds = { alipay: 'customer_dynamic_qr', alipay_scan: 'merchant_scan_customer' };
  const incoming = new Map((Array.isArray(source.methods) ? source.methods : []).map((method) => {
    const id = legacyIds[String(method?.id || '')] || String(method?.id || '');
    return [id, { ...method, id }];
  }));
  const methods = DEFAULT_PAYMENT_PREFERENCES.methods.map((base, index) => {
    const method = incoming.get(base.id) || {};
    const sort = Number(method.sort);
    return {
      ...base,
      channel: base.channels?.includes(method.channel) ? method.channel : base.channel,
      name: typeof method.name === 'string' && method.name.trim() ? method.name.trim() : base.name,
      enabled: method.enabled === undefined ? base.enabled : Boolean(method.enabled),
      sort: Number.isFinite(sort) ? sort : (index + 1) * 10
    };
  }).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));

  methods.forEach((method, index) => { method.sort = (index + 1) * 10; });
  const requestedDefault = legacyIds[String(source.default_method || '').trim()] || String(source.default_method || '').trim();
  const defaultMethod = methods.some((method) => method.id === requestedDefault && method.enabled)
    ? requestedDefault
    : (methods.find((method) => method.enabled)?.id || methods[0].id);
  return { default_method: defaultMethod, methods };
};

const getSetting = async (key, fallback = null) => {
  const row = await dbGet("SELECT value FROM settings WHERE key = ?", [key]).catch(() => null);
  return row?.value ?? fallback;
};

const setSetting = async (key, value) => {
  await dbRun("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
};

const getCostingMode = async () => {
  return await getSetting('costing_mode', 'avg');
};

const getPaymentConfigRaw = async () => {
  const s = await getSetting('payment_config', '{}');
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

const getPaymentPreferences = async (config = null) => {
  const paymentConfig = config || await getPaymentConfigRaw();
  return normalizePaymentPreferences(paymentConfig?.payment_preferences);
};

const pickPaymentConfig = async () => {
  const cfg = await getPaymentConfigRaw();
  return cfg || {};
};

module.exports = {
  getSetting,
  setSetting,
  getCostingMode,
  getPaymentConfigRaw,
  getPaymentPreferences,
  normalizePaymentPreferences,
  pickPaymentConfig
};
