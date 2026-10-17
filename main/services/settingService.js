const { dbGet, dbRun, dbAll } = require('../database');

const DEFAULT_PAYMENT_PREFERENCES = {
  default_method: 'alipay_dynamic_qr',
  methods: [
    { id: 'alipay_dynamic_qr', category: 'customer_dynamic_qr', channel: 'alipay', name: '支付宝客户扫动态码', enabled: true, sort: 10 },
    { id: 'merchant_scan_customer', category: 'merchant_scan_customer', channel: 'auto', channels: ['alipay', 'wechat', 'unionpay'], name: '商家扫客户码（自动识别）', enabled: true, sort: 20 },
    { id: 'personal_qrcode', category: 'merchant_static_qr', channel: null, name: '商家静态二维码', enabled: true, sort: 30 },
    { id: 'cash', category: 'cash', channel: null, name: '现金支付', enabled: true, sort: 40 },
    { id: 'other', category: 'other', channel: null, name: '其他方式', enabled: true, sort: 50 }
  ]
};

const DEFAULT_SHORTCUTS = {
  checkout: 'Enter',
  hold: 'F1',
  retrieve: 'F2',
  clear: 'Escape'
};

const DEFAULT_METHOD_SHORTCUTS = {
  alipay_dynamic_qr: 'F5',
  merchant_scan_customer: 'F6',
  personal_qrcode: 'F7',
  cash: 'F8',
  other: 'F9'
};

const normalizeShortcut = (value, fallback = '') => {
  const key = String(value || '').trim();
  if (!key) return fallback;
  if (/^esc(?:ape)?$/i.test(key)) return 'Escape';
  if (/^return$/i.test(key)) return 'Enter';
  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return fallback;
};

const normalizePaymentPreferences = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  const legacyIds = { alipay: 'alipay_dynamic_qr', alipay_scan: 'merchant_scan_customer', customer_dynamic_qr: 'alipay_dynamic_qr' };
  const incoming = new Map((Array.isArray(source.methods) ? source.methods : []).map((method) => {
    const id = legacyIds[String(method?.id || '')] || String(method?.id || '');
    return [id, { ...method, id }];
  }));
  const methods = DEFAULT_PAYMENT_PREFERENCES.methods.map((base, index) => {
    const method = incoming.get(base.id) || {};
    const sort = Number(method.sort);
    return {
      ...base,
      channel: base.channel === 'auto' ? 'auto' : base.channel,
      name: typeof method.name === 'string' && method.name.trim() ? method.name.trim() : base.name,
      enabled: method.enabled === undefined ? base.enabled : Boolean(method.enabled),
      sort: Number.isFinite(sort) ? sort : (index + 1) * 10,
      shortcut: normalizeShortcut(method.shortcut, DEFAULT_METHOD_SHORTCUTS[base.id] || '')
    };
  }).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));

  methods.forEach((method, index) => { method.sort = (index + 1) * 10; });
  const requestedDefault = legacyIds[String(source.default_method || '').trim()] || String(source.default_method || '').trim();
  const defaultMethod = methods.some((method) => method.id === requestedDefault && method.enabled)
    ? requestedDefault
    : (methods.find((method) => method.enabled)?.id || methods[0].id);
  const sourceShortcuts = source.shortcuts && typeof source.shortcuts === 'object' ? source.shortcuts : {};
  const shortcuts = Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([name, fallback]) => [
    name,
    normalizeShortcut(sourceShortcuts[name], fallback)
  ]));
  return { default_method: defaultMethod, shortcuts, methods };
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
