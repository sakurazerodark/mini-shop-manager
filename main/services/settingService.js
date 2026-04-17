const { dbGet, dbRun, dbAll } = require('../database');

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

const pickPaymentConfig = async () => {
  const cfg = await getPaymentConfigRaw();
  return cfg || {};
};

module.exports = {
  getSetting,
  setSetting,
  getCostingMode,
  getPaymentConfigRaw,
  pickPaymentConfig
};
