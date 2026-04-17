const settingService = require('../services/settingService');
const paymentService = require('../services/paymentService');
const productService = require('../services/productService');
const { createPrivateKeyFromInput } = require('../utils/crypto');
const { db } = require('../database');

exports.getBasicSettings = async (req, res) => {
  try {
    const store_name = await settingService.getSetting('store_name', '店小易');
    res.json({ data: { store_name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getNetworkConfig = async (req, res) => {
  const { getAppConfig } = require('../utils/dir');
  const os = require('os');
  const config = getAppConfig();
  
  let localIp = '127.0.0.1';
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }
  
  res.json({ data: { remote_access: !!config.remoteAccess, local_ip: localIp, port: process.env.PORT || 8080 } });
};

exports.updateNetworkConfig = async (req, res) => {
  const { remote_access } = req.body;
  if (typeof remote_access !== 'boolean') return res.status(400).json({ error: '无效的参数' });

  const { setAppConfig } = require('../utils/dir');
  setAppConfig({ remoteAccess: remote_access });

  res.json({ message: '网络设置已保存，系统即将重启', data: { remote_access } });

  setTimeout(() => {
    if (process.versions.hasOwnProperty('electron')) {
      const { app } = require('electron');
      app.relaunch();
      app.quit();
    } else {
      process.exit(0); 
    }
  }, 1500);
};

exports.updateBasicSettings = async (req, res) => {
  const { store_name } = req.body || {};
  try {
    if (typeof store_name === 'string' && store_name.trim()) {
      await settingService.setSetting('store_name', store_name.trim());
    }
    res.json({ message: '基础设置已更新' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getCostingMode = async (req, res) => {
  try {
    const mode = await settingService.getSetting('costing_mode', 'avg');
    res.json({ data: { costing_mode: mode } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateCostingMode = async (req, res) => {
  const { costing_mode } = req.body;
  if (costing_mode !== 'avg' && costing_mode !== 'fifo') {
    return res.status(400).json({ error: 'costing_mode 必须为 avg 或 fifo' });
  }
  try {
    await settingService.setSetting('costing_mode', costing_mode);

    if (costing_mode === 'fifo') {
      const allProducts = await new Promise((resolve) => db.all("SELECT id, stock, cost_price, last_cost_price FROM products", [], (err, rows) => resolve(rows || [])));
      for (const p of allProducts) {
        const stock = Number(p.stock || 0);
        const existing = await new Promise((resolve) => db.get("SELECT SUM(qty_remaining) AS qty FROM stock_batches WHERE product_id = ? AND qty_remaining > 0", [p.id], (err, row) => resolve(row)));
        const batchQty = Number(existing?.qty || 0);
        if (stock > 0 && batchQty <= 0) {
          const unitCost = Number(p.last_cost_price || 0) || Number(p.cost_price || 0);
          await new Promise((resolve) => db.run("INSERT INTO stock_batches (product_id, qty_remaining, unit_cost_price) VALUES (?, ?, ?)", [p.id, stock, unitCost], resolve));
        }
        await productService.recalcAvgCostFromBatches(p.id).catch(() => {});
      }
    } else {
      const allProducts = await new Promise((resolve) => db.all("SELECT id FROM products", [], (err, rows) => resolve(rows || [])));
      for (const p of allProducts) {
        await productService.recalcAvgCostFromBatches(p.id).catch(() => {});
      }
    }

    res.json({ message: '设置已更新', data: { costing_mode } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getBarcodeLookup = async (req, res) => {
  try {
    const provider = (process.env.BARCODE_CN_PROVIDER || await settingService.getSetting('barcode_cn_provider', 'tanshuapi')).trim();
    const key = (process.env.TANSHUAPI_KEY || await settingService.getSetting('tanshuapi_key', '')).trim();
    res.json({
      data: {
        provider,
        tanshuapi_key_set: Boolean(key)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateBarcodeLookup = async (req, res) => {
  const { provider, tanshuapi_key } = req.body || {};
  if (provider && provider !== 'tanshuapi') {
    return res.status(400).json({ error: 'provider 暂仅支持 tanshuapi' });
  }
  try {
    if (provider) await settingService.setSetting('barcode_cn_provider', provider);
    if (typeof tanshuapi_key === 'string') await settingService.setSetting('tanshuapi_key', tanshuapi_key.trim());
    res.json({ message: '条码识别配置已更新' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getPayments = async (req, res) => {
  try {
    const parsed = await settingService.getPaymentConfigRaw();
    const intervalRaw = await settingService.getSetting('payment_poll_interval_ms', '2000');
    let pollIntervalMs = parseInt(intervalRaw, 10);
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) pollIntervalMs = 2000;
    res.json({ data: { ...paymentService.sanitizePaymentConfig(parsed), poll_interval_ms: pollIntervalMs } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updatePayments = async (req, res) => {
  const body = req.body || {};
  try {
    const current = await settingService.getPaymentConfigRaw();
    const next = { ...current };

    if (body.wechatpay_v3) {
      next.wechatpay_v3 = { ...(current.wechatpay_v3 || {}) };
      const src = body.wechatpay_v3 || {};
      const setStr = (k) => {
        if (typeof src[k] === 'string') next.wechatpay_v3[k] = src[k].trim();
      };
      setStr('mchid');
      setStr('appid');
      setStr('serial_no');
      if (typeof src.notify_url === 'string') {
        const v = src.notify_url.trim();
        try {
          next.wechatpay_v3.notify_url = v ? paymentService.normalizeNotifyDomain(v) : '';
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (typeof src.api_v3_key === 'string' && src.api_v3_key.trim()) next.wechatpay_v3.api_v3_key = src.api_v3_key.trim();
      if (typeof src.merchant_private_key === 'string' && src.merchant_private_key.trim()) next.wechatpay_v3.merchant_private_key = src.merchant_private_key.trim();
      if (typeof src.platform_cert === 'string' && src.platform_cert.trim()) next.wechatpay_v3.platform_cert = src.platform_cert.trim();
    }

    if (body.alipay_f2f) {
      next.alipay_f2f = { ...(current.alipay_f2f || {}) };
      const src = body.alipay_f2f || {};
      const setStr = (k) => {
        if (typeof src[k] === 'string') next.alipay_f2f[k] = src[k].trim();
      };
      setStr('app_id');
      if (typeof src.gateway === 'string') {
        const v = src.gateway.trim();
        try {
          next.alipay_f2f.gateway = v ? paymentService.normalizeAlipayGateway(v) : '';
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (typeof src.notify_url === 'string') {
        const v = src.notify_url.trim();
        try {
          next.alipay_f2f.notify_url = v ? paymentService.normalizeNotifyDomain(v) : '';
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (typeof src.merchant_private_key === 'string' && src.merchant_private_key.trim()) next.alipay_f2f.merchant_private_key = src.merchant_private_key.trim();
      if (typeof src.alipay_public_key === 'string' && src.alipay_public_key.trim()) next.alipay_f2f.alipay_public_key = src.alipay_public_key.trim();
      if (typeof src.encrypt_key === 'string' && src.encrypt_key.trim()) next.alipay_f2f.encrypt_key = src.encrypt_key.trim();
    }

    if (body.unionpay) {
      next.unionpay = { ...(current.unionpay || {}) };
      const src = body.unionpay || {};
      const setStr = (k) => {
        if (typeof src[k] === 'string') next.unionpay[k] = src[k].trim();
      };
      setStr('merchant_id');
      setStr('gateway');
      if (typeof src.notify_url === 'string') {
        const v = src.notify_url.trim();
        try {
          next.unionpay.notify_url = v ? paymentService.normalizeNotifyDomain(v) : '';
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (typeof src.sign_key === 'string' && src.sign_key.trim()) next.unionpay.sign_key = src.sign_key.trim();
      if (typeof src.sign_cert === 'string' && src.sign_cert.trim()) next.unionpay.sign_cert = src.sign_cert.trim();
      if (typeof src.verify_cert === 'string' && src.verify_cert.trim()) next.unionpay.verify_cert = src.verify_cert.trim();
    }

    if (body.poll_interval_ms !== undefined && body.poll_interval_ms !== null && String(body.poll_interval_ms).trim().length > 0) {
      const v = parseInt(String(body.poll_interval_ms), 10);
      if (!Number.isFinite(v) || v < 1000) {
        return res.status(400).json({ error: '轮询间隔不得小于 1000ms' });
      }
      await settingService.setSetting('payment_poll_interval_ms', String(v));
    }

    if (body.alipay_f2f?.merchant_private_key && String(body.alipay_f2f.merchant_private_key).trim()) {
      try {
        createPrivateKeyFromInput(next.alipay_f2f?.merchant_private_key);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }
    if (body.alipay_f2f?.encrypt_key && String(body.alipay_f2f.encrypt_key).trim()) {
      const key = Buffer.from(String(next.alipay_f2f?.encrypt_key || '').trim(), 'base64');
      if (key.length !== 16) {
        return res.status(400).json({ error: '支付宝AES密钥格式不正确：应为 base64 编码的 16 字节密钥（AES-128）' });
      }
    }

    await settingService.setSetting('payment_config', JSON.stringify(next));
    const intervalRaw = await settingService.getSetting('payment_poll_interval_ms', '2000');
    let pollIntervalMs = parseInt(intervalRaw, 10);
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) pollIntervalMs = 2000;
    res.json({ message: '支付配置已保存', data: { ...paymentService.sanitizePaymentConfig(next), poll_interval_ms: pollIntervalMs } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getDataDir = async (req, res) => {
  const { baseDataDir } = require('../utils/dir');
  res.json({ data: { path: baseDataDir, is_electron: process.versions.hasOwnProperty('electron') } });
};

exports.selectDataDir = async (req, res) => {
  if (process.versions.hasOwnProperty('electron')) {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return res.json({ data: { path: null } });
    return res.json({ data: { path: result.filePaths[0] } });
  } else {
    return res.status(400).json({ error: '仅在桌面端支持选择目录' });
  }
};

exports.migrateDataDir = async (req, res) => {
  const { new_dir } = req.body;
  if (!new_dir) return res.status(400).json({ error: '新目录不能为空' });

  const { baseDataDir, setCustomDataDir } = require('../utils/dir');
  if (new_dir === baseDataDir) return res.status(400).json({ error: '新目录与当前目录相同' });

  const fs = require('fs');
  const path = require('path');
  
  if (!fs.existsSync(new_dir)) {
    return res.status(400).json({ error: '目标目录不存在' });
  }

  try {
    // recursively copy files
    await fs.promises.cp(baseDataDir, new_dir, { recursive: true });
    
    // update config
    setCustomDataDir(new_dir);

    res.json({ message: '迁移成功，即将重启应用' });

    // Restart app
    setTimeout(() => {
      if (process.versions.hasOwnProperty('electron')) {
        const { app } = require('electron');
        app.relaunch();
        app.quit();
      } else {
        process.exit(0); 
      }
    }, 1500);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
