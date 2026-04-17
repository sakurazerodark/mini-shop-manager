const { dbGet, dbRun, dbAll } = require("../database");
const { fetchJsonWithTimeout } = require("../utils/http");
const { saveBase64Image } = require("../utils/file");
const { getSetting } = require("./settingService");

const parseJsonFromEnv = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

const deepFindFirstString = (root, keys) => {
  if (!root || typeof root !== 'object') return null;
  const keySet = new Set((keys || []).map(k => String(k).toLowerCase()));
  const queue = [root];
  let guard = 0;
  while (queue.length && guard < 3000) {
    guard++;
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const v of cur) queue.push(v);
      continue;
    }
    for (const [k, v] of Object.entries(cur)) {
      const lk = String(k).toLowerCase();
      if (keySet.has(lk)) {
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (Array.isArray(v)) {
          const firstStr = v.find(x => typeof x === 'string' && x.trim());
          if (firstStr) return firstStr.trim();
        }
      }
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return null;
};

const normalizeLookup = (payload, source) => {
  const name = deepFindFirstString(payload, [
    'name', 'goodsname', 'productname', 'product_name', 'title', 'goods_name', 'spmc', 'mc', 'itemname', 'item_name'
  ]);
  const imageUrl = deepFindFirstString(payload, [
    'image', 'imageurl', 'image_url', 'img', 'pic', 'picture', 'images', 'imageurls', 'image_urls', 'image_front_url', 'image_front_small_url'
  ]);
  if (!name && !imageUrl) return null;
  return { name: name || '', image_url: imageUrl || null, source };
};

const lookupBarcodeCN = async (barcode) => {
  const urlTpl = process.env.BARCODE_CN_LOOKUP_URL || process.env.BARCODE_LOOKUP_CN_URL;
  if (urlTpl) {
    const headers = parseJsonFromEnv(process.env.BARCODE_CN_LOOKUP_HEADERS) || {};
    const url = urlTpl.replaceAll('{barcode}', encodeURIComponent(barcode)).replaceAll('${barcode}', encodeURIComponent(barcode));
    const resp = await fetchJsonWithTimeout(url, { headers: { 'User-Agent': 'mini-shop-manager/0.0.0', ...headers } }, 6000).catch(() => null);
    if (!resp?.ok || !resp.json) return null;
    return normalizeLookup(resp.json, 'cn');
  }

  const provider = (process.env.BARCODE_CN_PROVIDER || await getSetting('barcode_cn_provider', 'tanshuapi')).trim();
  if (provider !== 'tanshuapi') return null;

  const key = (process.env.TANSHUAPI_KEY || await getSetting('tanshuapi_key', '')).trim();
  if (!key) return null;

  const url = `https://api.tanshuapi.com/api/barcode/v1/index?key=${encodeURIComponent(key)}&barcode=${encodeURIComponent(barcode)}`;
  const resp = await fetchJsonWithTimeout(url, { headers: { 'User-Agent': 'mini-shop-manager/0.0.0' } }, 6000).catch(() => null);
  const payload = resp?.json;
  if (!payload) return null;

  const code = Number(payload.code);
  if (code === 1) {
    const data = payload.data || {};
    const name = String(data.goods_name || '').trim();
    const imageUrl = String(data.image || '').trim();
    if (!name && !imageUrl) return null;
    return { name, image_url: imageUrl || null, source: 'tanshuapi' };
  }

  const msg = String(payload.msg || '').trim();
  const systemCodeMessage = {
    10001: '错误的请求KEY',
    10002: '该KEY无请求权限',
    10003: 'KEY过期',
    10004: '未知的请求源',
    10005: '被禁止的IP',
    10006: '被禁止的KEY',
    10007: '请求超过次数限制',
    10008: '接口维护'
  };
  if (systemCodeMessage[code]) {
    throw new Error(`探数API: ${systemCodeMessage[code]}`);
  }
  if (code === 207703) return null;
  if (msg) throw new Error(`探数API: ${msg}`);
  return null;
};

const lookupBarcode = async (barcode) => {
  const code = String(barcode || '').trim();
  if (!code) return null;

  const cn = await lookupBarcodeCN(code);
  if (cn) return cn;

  const off = await fetchJsonWithTimeout(
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
    { headers: { 'User-Agent': 'mini-shop-manager/0.0.0' } },
    5000
  ).catch(() => null);
  if (off?.ok && off.json?.status === 1) {
    const p = off.json.product || {};
    const name = p.product_name || p.generic_name || '';
    const imageUrl = p.image_front_small_url || p.image_url || p.image_front_url || '';
    if (name || imageUrl) {
      return { name, image_url: imageUrl || null, source: 'openfoodfacts' };
    }
  }

  const upc = await fetchJsonWithTimeout(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
    { headers: { 'User-Agent': 'mini-shop-manager/0.0.0' } },
    5000
  ).catch(() => null);
  const item = upc?.ok ? upc.json?.items?.[0] : null;
  if (item) {
    const name = item.title || item.description || '';
    const imageUrl = Array.isArray(item.images) ? item.images[0] : null;
    if (name || imageUrl) {
      return { name, image_url: imageUrl || null, source: 'upcitemdb' };
    }
  }

  return null;
};

const recalcAvgCostFromBatches = async (productId) => {
  const row = await dbGet(
    "SELECT SUM(qty_remaining) AS qty, SUM(qty_remaining * unit_cost_price) AS total_cost FROM stock_batches WHERE product_id = ? AND qty_remaining > 0",
    [productId]
  );
  const qty = Number(row?.qty || 0);
  const totalCost = Number(row?.total_cost || 0);
  const avg = qty > 0 ? totalCost / qty : 0;
  await dbRun("UPDATE products SET cost_price = ? WHERE id = ?", [avg, productId]);
  return avg;
};

const consumeBatchesFIFO = async (productId, qty) => {
  let remaining = Number(qty);
  let totalCost = 0;
  if (remaining <= 0) return { totalCost: 0, unitCost: 0 };

  const batches = await dbAll(
    "SELECT id, qty_remaining, unit_cost_price FROM stock_batches WHERE product_id = ? AND qty_remaining > 0 ORDER BY created_at ASC, id ASC",
    [productId]
  );

  for (const b of batches) {
    if (remaining <= 0) break;
    const canTake = Math.min(remaining, Number(b.qty_remaining));
    remaining -= canTake;
    totalCost += canTake * Number(b.unit_cost_price || 0);
    const left = Number(b.qty_remaining) - canTake;
    if (left <= 0) {
      await dbRun("DELETE FROM stock_batches WHERE id = ?", [b.id]);
    } else {
      await dbRun("UPDATE stock_batches SET qty_remaining = ? WHERE id = ?", [left, b.id]);
    }
  }

  const taken = Number(qty) - remaining;
  const unitCost = taken > 0 ? totalCost / taken : 0;
  return { totalCost, unitCost, shortage: remaining };
};

const insertPriceLog = async ({ productId, priceType, oldPrice, newPrice, reason }) => {
  if (oldPrice === newPrice) return;
  await dbRun(
    "INSERT INTO product_price_logs (product_id, price_type, old_price, new_price, reason) VALUES (?, ?, ?, ?, ?)",
    [productId, priceType, oldPrice ?? null, newPrice ?? null, reason || 'system']
  );
};

const getAllProducts = async () => {
  return await dbAll("SELECT * FROM products");
};

const getProductByBarcode = async (barcode) => {
  return await dbGet("SELECT * FROM products WHERE barcode = ?", [barcode]);
};

const getProductById = async (id) => {
  return await dbGet("SELECT * FROM products WHERE id = ?", [id]);
};

const updateProduct = async (id, updates) => {
  const params = [];
  const sets = [];
  for (const [k, v] of Object.entries(updates)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (!sets.length) return;
  params.push(id);
  await dbRun(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
};

const addProduct = async (product) => {
  const { barcode, name, cost_price, retail_price, stock, min_stock, expiry_date, unit, is_weighing, finalImageUrl, brand, sIdsStr } = product;
  const sql = `INSERT INTO products (barcode, name, cost_price, last_cost_price, retail_price, stock, min_stock, expiry_date, unit, is_weighing, image_url, brand, supplier_ids)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await dbRun("BEGIN TRANSACTION");
  try {
    const result = await new Promise((resolve, reject) => {
      const { db } = require('../database');
      db.run(sql, [barcode, name, cost_price, cost_price, retail_price, stock, min_stock, expiry_date, unit || '件', is_weighing ? 1 : 0, finalImageUrl, brand || '', sIdsStr], function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      });
    });
    const productId = result;
    const initialStock = Number(stock || 0);
    if (initialStock > 0) {
      await dbRun("INSERT INTO stock_batches (product_id, qty_remaining, unit_cost_price) VALUES (?, ?, ?)", [productId, initialStock, Number(cost_price || 0)]);
    }
    await dbRun("INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'init', ?, ?, ?, ?)", [productId, initialStock, Number(cost_price || 0), Number(retail_price || 0), 'system']);
    await dbRun("COMMIT");
    return productId;
  } catch (e) {
    await dbRun("ROLLBACK").catch(() => {});
    throw e;
  }
};

const deleteProduct = async (id) => {
  return await dbRun("DELETE FROM products WHERE id = ?", [id]);
};

const getProductPriceLogs = async (id) => {
  return await dbAll("SELECT * FROM product_price_logs WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 200", [id]);
};

const getProductStockLogs = async (id) => {
  return await dbAll("SELECT * FROM stock_logs WHERE product_id = ? ORDER BY created_at DESC", [id]);
};

module.exports = {
  lookupBarcode,
  recalcAvgCostFromBatches,
  consumeBatchesFIFO,
  insertPriceLog,
  getAllProducts,
  getProductByBarcode,
  getProductById,
  updateProduct,
  addProduct,
  deleteProduct,
  getProductPriceLogs,
  getProductStockLogs
};
