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

    // Authentication and authorization tables.
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT,
        built_in INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        permission_key TEXT NOT NULL UNIQUE,
        name TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME,
        ip TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        details TEXT,
        result TEXT NOT NULL DEFAULT 'success',
        ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    const permissionSeeds = [
      ['account.view', '查看账号'], ['account.manage', '管理账号'],
      ['role.view', '查看角色'], ['role.manage', '管理角色'],
      ['payment.config.view', '查看支付配置'], ['payment.config.manage', '管理支付配置'],
      ['payment.method.manage', '管理支付方式'], ['payment.create', '创建收款'],
      ['payment.confirm', '确认支付'], ['payment.record.view', '查看支付记录'],
      ['payment.reconcile', '对账'], ['refund.view', '查看退款'],
      ['refund.request', '发起退款'], ['refund.approve', '审批退款'],
      ['refund.execute', '执行退款'], ['order.view', '查看订单'],
      ['order.manage', '管理订单'], ['report.view', '查看报表'],
      ['report.export', '导出报表'], ['exception.manage', '处理异常'],
      ['archive.view', '查看归档'], ['archive.run', '执行归档'],
      ['archive.restore', '恢复归档'], ['*', '全部权限']
    ];
    permissionSeeds.forEach(([key, name]) => {
      db.run('INSERT OR IGNORE INTO permissions (permission_key, name) VALUES (?, ?)', [key, name]);
    });
    const roleSeeds = [
      ['store_owner', '店主/超级管理员', 1], ['admin', '管理员', 1],
      ['manager', '经理', 1], ['cashier', '收银员', 1],
      ['finance_auditor', '财务/审计', 1], ['readonly', '只读用户', 1]
    ];
    roleSeeds.forEach(([name, description, builtIn]) => {
      db.run('INSERT OR IGNORE INTO roles (name, description, built_in) VALUES (?, ?, ?)', [name, description, builtIn]);
    });
    // The seed statements run in this serialized queue after the role/permission inserts.
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'store_owner'`);
    // Administrators handle daily operations but cannot alter accounts/roles.
    db.run(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'admin')`);
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'admin' AND p.permission_key IN
      ('payment.config.view','payment.config.manage','payment.method.manage','payment.create','payment.confirm','payment.record.view','payment.reconcile','refund.view','refund.request','refund.approve','refund.execute','order.view','order.manage','report.view','report.export','exception.manage','archive.view')`);
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'manager' AND p.permission_key IN
      ('account.view','payment.config.view','payment.create','payment.confirm','payment.record.view','payment.reconcile','refund.view','refund.request','order.view','order.manage','report.view','report.export','exception.manage')`);
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'cashier' AND p.permission_key IN ('payment.create','payment.confirm','payment.record.view','order.view')`);
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'finance_auditor' AND p.permission_key IN ('order.view','payment.record.view','payment.reconcile','refund.view','report.view','report.export')`);
    db.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = 'readonly' AND p.permission_key IN ('account.view','role.view','order.view','payment.record.view','refund.view','report.view','archive.view')`);

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
