const { db, dbGet, dbRun, dbAll } = require('../database');
const logger = require('../logger');
const orderService = require('../services/orderService');
const settingService = require('../services/settingService');
const productService = require('../services/productService');
const paymentService = require('../services/paymentService');

const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
});
const dbGetAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAllAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const toSqliteUtc = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

exports.getTodayReport = (req, res) => {
  const today = new Date().toISOString().split('T')[0] + '%';
  const sql = `
    SELECT 
      COUNT(id) as total_orders, 
      SUM(total_amount) as total_revenue,
      SUM(refunded_amount) as total_refunds,
      COUNT(CASE WHEN refunded_amount > 0 THEN 1 END) as refund_orders
    FROM orders 
    WHERE created_at LIKE ? AND status = 'completed'
  `;
  db.get(sql, [today], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ data: { 
      total_orders: row.total_orders || 0, 
      total_revenue: row.total_revenue || 0,
      total_refunds: row.total_refunds || 0,
      refund_orders: row.refund_orders || 0
    } });
  });
};

exports.getOrders = (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const requestedPageSize = parseInt(req.query.pageSize ?? req.query.limit, 10) || 20;
  const pageSize = Math.min(100, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;
  const filterType = req.query.type; 
  const searchId = req.query.id;
  const startAt = req.query.start_at ? toSqliteUtc(req.query.start_at) : null;
  const endAt = req.query.end_at ? toSqliteUtc(req.query.end_at) : null;

  if ((req.query.start_at && !startAt) || (req.query.end_at && !endAt)) {
    return res.status(400).json({ error: '时间范围格式无效' });
  }
  if (startAt && endAt && startAt >= endAt) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }
  
  let where = '1=1';
  let params = [];
  
  if (searchId) {
    where += ' AND id LIKE ?';
    params.push(`%${searchId}%`);
  }

  if (startAt) {
    where += ' AND created_at >= ?';
    params.push(startAt);
  }
  if (endAt) {
    where += ' AND created_at < ?';
    params.push(endAt);
  }
  
  if (filterType === 'payment') {
    where += " AND pay_method IS NOT NULL AND pay_method != ''";
  } else if (filterType === 'abnormal') {
    where += " AND status = 'abnormal'";
  }

  const countSql = `SELECT count(*) as total FROM orders WHERE ${where}`;
  db.get(countSql, params, (err, row) => {
    if (err) {
      logger.error(`query orders count failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
    const total = row.total;
    
    const sql = `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    db.all(sql, [...params, pageSize, offset], (err, rows) => {
      if (err) {
        logger.error(`query orders list failed: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
      res.json({
        data: rows,
        total,
        page,
        pageSize,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
        total_pages: Math.ceil(total / pageSize)
      });
    });
  });
};

exports.getRecentOrders = (req, res) => {
  const sql = `
    SELECT * FROM orders 
    ORDER BY created_at DESC 
    LIMIT 20
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ data: rows });
  });
};

exports.getOrderById = async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  try {
    const order = await dbGetAsync("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    const items = await dbAllAsync(
      `
      SELECT 
        oi.id,
        oi.product_id,
        p.barcode AS barcode,
        p.name AS name,
        p.unit AS unit,
        oi.quantity,
        oi.unit_price,
        oi.cost_price
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
      `,
      [orderId]
    );
    const normalized = (items || []).map(it => ({
      ...it,
      quantity: Number(it.quantity || 0),
      unit_price: Number(it.unit_price || 0),
      cost_price: Number(it.cost_price || 0),
      subtotal: Number(it.quantity || 0) * Number(it.unit_price || 0)
    }));
    res.json({ data: { order, items: normalized } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.createPendingOrder = async (req, res) => {
  const { order_id, items, total_amount, pay_method, pay_provider } = req.body || {};
  if (!order_id) return res.status(400).json({ error: '缺少 order_id' });
  try {
    await orderService.createPendingOrder({ orderId: order_id, totalAmount: total_amount, payMethod: pay_method, payProvider: pay_provider, items });
    res.json({ message: '已创建待支付订单', order_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.cancelOrder = async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  try {
    const order = await dbGetAsync("SELECT pay_provider, pay_out_trade_no, status, pay_status FROM orders WHERE id = ?", [orderId]);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'pending' && order.status !== 'abnormal') {
      return res.status(400).json({ error: '只能取消待支付或异常状态的订单' });
    }

    if (order.pay_provider === 'alipay' && order.pay_out_trade_no) {
      await paymentService.cancelAlipayOrder(order.pay_out_trade_no, { requestId: req.requestId, purpose: 'cancel_order' }).catch(() => {});
    }

    await orderService.cancelPendingOrder(orderId);
    await dbRunAsync("UPDATE orders SET pay_status = 'failed' WHERE id = ?", [orderId]).catch(()=>{});
    res.json({ message: '订单已取消' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.manualPayOrder = async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  try {
    const order = await dbGetAsync("SELECT status FROM orders WHERE id = ?", [orderId]);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'pending' && order.status !== 'abnormal') {
      return res.status(400).json({ error: '当前状态不可转支付' });
    }

    await orderService.markOrderPaid({ orderId, provider: 'manual', tradeNo: '', confirmedVia: 'manual' });
    await orderService.completePendingOrder(orderId, req.user?.username || req.user?.display_name || String(req.user?.id || 'system'));
    res.json({ message: '订单已手动转为支付完成', order_id: orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.completeOrder = async (req, res) => {
  try {
    await orderService.completePendingOrder(req.params.id, req.user?.username || req.user?.display_name || String(req.user?.id || 'system'));
    res.json({ message: '订单已完成', order_id: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.submitOrder = (req, res) => {
  const { order_id, items, total_amount, pay_method } = req.body;
  
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    
    const insertOrder = "INSERT INTO orders (id, total_amount, pay_method) VALUES (?, ?, ?)";
    db.run(insertOrder, [order_id, total_amount, pay_method]);
    
    const insertItem = "INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost_price) VALUES (?, ?, ?, ?, ?)";
    const updateStock = "UPDATE products SET stock = stock - ? WHERE id = ?";
    const insertStockLog = "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'sell', ?, ?, ?, ?)";
    const operator = req.user?.username || req.user?.display_name || (req.user?.id ? String(req.user.id) : 'system');

    db.get("SELECT value FROM settings WHERE key = 'costing_mode'", [], async (mErr, mRow) => {
      if (mErr) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: '订单提交失败: ' + mErr.message });
      }
      const mode = mRow?.value || 'avg';
      try {
        for (const item of items) {
          const qty = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const product = await dbGetAsync("SELECT id, stock, cost_price, last_cost_price, retail_price FROM products WHERE id = ?", [item.product_id]);
          if (!product) throw new Error('商品未找到: ' + item.product_id);

          let unitCost = Number(product.cost_price || 0);
          if (mode === 'fifo') {
            const result = await productService.consumeBatchesFIFO(item.product_id, qty);
            unitCost = result.unitCost;
          }

          await dbRunAsync(insertItem, [order_id, item.product_id, qty, unitPrice, unitCost]);
          await dbRunAsync(updateStock, [qty, item.product_id]);
          await dbRunAsync(insertStockLog, [item.product_id, -qty, unitCost, unitPrice, operator]);

          if (mode === 'fifo') {
            await productService.recalcAvgCostFromBatches(item.product_id).catch(() => {});
          }
        }

        db.run("COMMIT", (err) => {
          if (err) return res.status(500).json({ error: '订单提交失败: ' + err.message });
          res.json({ message: '结算成功', order_id });
        });
      } catch (e) {
        db.run("ROLLBACK");
        res.status(500).json({ error: '订单提交失败: ' + e.message });
      }
    });
  });
};

exports.refundOrder = async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const { amount, method, reason } = req.body || {}; 
  
  if (!amount || amount <= 0) return res.status(400).json({ error: '退款金额必须大于 0' });

  try {
    const order = await dbGetAsync("SELECT total_amount, refunded_amount, status, pay_provider, pay_out_trade_no FROM orders WHERE id = ?", [orderId]);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'completed') return res.status(400).json({ error: '只能对已完成的订单进行退款' });

    const total = Number(order.total_amount || 0);
    const alreadyRefunded = Number(order.refunded_amount || 0);
    const refundAmount = Number(amount);

    if (alreadyRefunded + refundAmount > total + 0.01) { 
      return res.status(400).json({ error: `退款总金额不能超过订单总金额 (最多可退 ${Math.max(0, total - alreadyRefunded).toFixed(2)})` });
    }

    if (method === 'original') {
      if (order.pay_provider === 'alipay' && order.pay_out_trade_no) {
        const r = await paymentService.refundAlipayOrder(order.pay_out_trade_no, refundAmount, { requestId: req.requestId, purpose: 'refund', refundReason: reason });
        if (!r.ok) return res.status(400).json({ error: r.error });
      } else if (order.pay_provider === 'wechatpay' || order.pay_provider === 'unionpay') {
        return res.status(400).json({ error: '微信/云闪付暂未实现原路退回，请使用现金退款' });
      } else if (order.pay_provider === 'cash' || order.pay_provider === 'manual') {
        return res.status(400).json({ error: '现金或人工支付请选择“现金退款”' });
      }
    }

    const newRefunded = alreadyRefunded + refundAmount;
    let newStatus = 'none';
    if (newRefunded >= total - 0.01) newStatus = 'full';
    else if (newRefunded > 0) newStatus = 'partial';

    await dbRunAsync("BEGIN TRANSACTION");
    await dbRunAsync("UPDATE orders SET refunded_amount = ?, refund_status = ? WHERE id = ?", [newRefunded, newStatus, orderId]);
    const operator = req.user?.username || (req.user?.id ? String(req.user.id) : 'unknown');
    await dbRunAsync("INSERT INTO refund_logs (order_id, refund_amount, refund_method, refund_reason, operator) VALUES (?, ?, ?, ?, ?)",
      [orderId, refundAmount, method || 'cash', reason || '', operator]);
    await dbRunAsync("COMMIT");

    res.json({ message: '退款成功', refunded_amount: newRefunded, refund_status: newStatus });
  } catch (e) {
    await dbRunAsync("ROLLBACK").catch(()=>{});
    logger.error('order refund error', { request_id: req.requestId, message: e?.message || String(e) });
    res.status(500).json({ error: e.message });
  }
};
