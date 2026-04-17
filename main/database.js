const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { baseDataDir } = require('./utils/dir');

const dataDir = baseDataDir;

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'shop.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initDb();
  }
});

function ensureColumn(table, column, definition) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
      if (err) return reject(err);
      const exists = (rows || []).some(r => r.name === column);
      if (exists) return resolve();
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, [], (alterErr) => {
        if (alterErr) return reject(alterErr);
        resolve();
      });
    });
  });
}

function initDb() {
  db.serialize(() => {
    // 1. 商品表
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE,
        name TEXT NOT NULL,
        category_id INTEGER,
        cost_price REAL DEFAULT 0,
        last_cost_price REAL DEFAULT 0,
        retail_price REAL DEFAULT 0,
        stock REAL DEFAULT 0,
        min_stock REAL DEFAULT 5,
        unit TEXT DEFAULT '件',
        is_weighing INTEGER DEFAULT 0,
        image_url TEXT,
        expiry_date TEXT,
        deleted_at DATETIME
      )
    `);

    // 2. 订单主表
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        total_amount REAL DEFAULT 0,
        pay_method TEXT,
        pay_provider TEXT,
        pay_status TEXT,
        pay_out_trade_no TEXT,
        pay_trade_no TEXT,
        pay_confirmed_via TEXT,
        pay_paid_at DATETIME,
        pay_trace_id TEXT,
        pay_provider_status TEXT,
        pay_provider_code TEXT,
        pay_provider_msg TEXT,
        pay_provider_sub_msg TEXT,
        pay_last_sync_via TEXT,
        pay_last_sync_at DATETIME,
        status TEXT DEFAULT 'completed',
        refunded_amount REAL DEFAULT 0,
        refund_status TEXT DEFAULT 'none',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. 订单明细表
    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        product_id INTEGER,
        quantity REAL DEFAULT 1,
        unit_price REAL DEFAULT 0,
        cost_price REAL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    // 4. 库存变动表
    db.run(`
      CREATE TABLE IF NOT EXISTS stock_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        change_type TEXT,
        change_qty REAL,
        unit_cost_price REAL,
        unit_retail_price REAL,
        operator TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS product_price_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        price_type TEXT,
        old_price REAL,
        new_price REAL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS stock_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        qty_remaining REAL,
        unit_cost_price REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `);

    // 7. 退款记录表
    db.run(`
      CREATE TABLE IF NOT EXISTS refund_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        refund_amount REAL,
        refund_method TEXT,
        refund_reason TEXT,
        operator TEXT,
        trace_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. 供应商表
    db.run(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('costing_mode', 'avg')`);

    ensureColumn('products', 'last_cost_price', 'REAL DEFAULT 0').catch(() => {});
    ensureColumn('products', 'image_url', 'TEXT').catch(() => {});
    ensureColumn('products', 'brand', 'TEXT').catch(() => {});
    ensureColumn('products', 'supplier_id', 'INTEGER').catch(() => {});
    ensureColumn('products', 'supplier_ids', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_provider', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_status', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_out_trade_no', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_trade_no', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_confirmed_via', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_paid_at', 'DATETIME').catch(() => {});
    ensureColumn('orders', 'pay_trace_id', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_provider_status', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_provider_code', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_provider_msg', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_provider_sub_msg', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_last_sync_via', 'TEXT').catch(() => {});
    ensureColumn('orders', 'pay_last_sync_at', 'DATETIME').catch(() => {});
    ensureColumn('orders', 'refunded_amount', 'REAL DEFAULT 0').catch(() => {});
    ensureColumn('orders', 'refund_status', 'TEXT DEFAULT "none"').catch(() => {});
    ensureColumn('order_items', 'cost_price', 'REAL DEFAULT 0').catch(() => {});
    ensureColumn('stock_logs', 'unit_cost_price', 'REAL').catch(() => {});
    ensureColumn('stock_logs', 'unit_retail_price', 'REAL').catch(() => {});
    ensureColumn('products', 'deleted_at', 'DATETIME').catch(() => {});
  });
}

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll
};
