const { dbGet, dbRun, dbAll } = require('../database');
const { getCostingMode } = require('./settingService');
const { consumeBatchesFIFO, recalcAvgCostFromBatches } = require('./productService');

const createPendingOrder = async ({ orderId, totalAmount, payMethod, items }) => {
  await dbRun("BEGIN TRANSACTION");
  try {
    await dbRun("INSERT INTO orders (id, total_amount, pay_method, status, pay_status) VALUES (?, ?, ?, 'pending', 'created')", [orderId, totalAmount, payMethod]);
    for (const item of items || []) {
      const qty = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const productId = item.product_id;
      await dbRun("INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost_price) VALUES (?, ?, ?, ?, 0)", [orderId, productId, qty, unitPrice]);
    }
    await dbRun("COMMIT");
  } catch (e) {
    await dbRun("ROLLBACK").catch(() => {});
    throw e;
  }
};

const cancelPendingOrder = async (orderId) => {
  await dbRun("UPDATE orders SET status = 'canceled', pay_status = 'canceled' WHERE id = ? AND status IN ('pending', 'abnormal')", [orderId]);
};

const completePendingOrder = async (orderId) => {
  const order = await dbGet("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'completed' && order.pay_status === 'paid') return;
  if (order.status !== 'pending' && order.status !== 'abnormal') throw new Error('订单状态不允许完成: ' + order.status);

  const items = await dbAll("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
  if (!items.length) throw new Error('订单明细为空');

  const mode = await getCostingMode();
  await dbRun("BEGIN TRANSACTION");
  try {
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const product = await dbGet("SELECT id, stock, cost_price FROM products WHERE id = ?", [item.product_id]);
      if (!product) throw new Error('商品未找到: ' + item.product_id);

      let unitCost = Number(product.cost_price || 0);
      if (mode === 'fifo') {
        const result = await consumeBatchesFIFO(item.product_id, qty);
        unitCost = result.unitCost;
      }

      await dbRun("UPDATE order_items SET cost_price = ? WHERE id = ?", [unitCost, item.id]);
      await dbRun("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, item.product_id]);
      await dbRun(
        "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'sell', ?, ?, ?, 'system')",
        [item.product_id, -qty, unitCost, unitPrice]
      );

      if (mode === 'fifo') {
        await recalcAvgCostFromBatches(item.product_id).catch(() => {});
      }
    }

    const fallbackVia = String(order.pay_method || '').trim() === 'cash' ? 'cash' : 'manual';
    await dbRun(
      "UPDATE orders SET status = 'completed', pay_status = 'paid', pay_confirmed_via = COALESCE(pay_confirmed_via, ?), pay_paid_at = COALESCE(pay_paid_at, CURRENT_TIMESTAMP) WHERE id = ?",
      [fallbackVia, orderId]
    );
    await dbRun("COMMIT");
  } catch (e) {
    await dbRun("ROLLBACK").catch(() => {});
    throw e;
  }
};

const markOrderPaid = async ({ orderId, provider, tradeNo, confirmedVia }) => {
  const via = String(confirmedVia || '').trim() || null;
  const prov = String(provider || '').trim() || null;
  const tn = String(tradeNo || '').trim() || null;
  await dbRun(
    "UPDATE orders SET pay_provider = COALESCE(pay_provider, ?), pay_trade_no = COALESCE(pay_trade_no, ?), pay_status = 'paid', pay_confirmed_via = COALESCE(pay_confirmed_via, ?), pay_paid_at = COALESCE(pay_paid_at, CURRENT_TIMESTAMP) WHERE id = ?",
    [prov, tn, via, String(orderId)]
  ).catch(() => {});
};

const updateOrderPayMeta = async ({
  orderId,
  provider,
  outTradeNo,
  tradeNo,
  traceId,
  providerStatus,
  providerCode,
  providerMsg,
  providerSubMsg,
  syncVia,
  payStatus
}) => {
  const oid = String(orderId || '').trim();
  if (!oid) return;
  const prov = provider ? String(provider).trim() : null;
  const outNo = outTradeNo ? String(outTradeNo).trim() : null;
  const tn = tradeNo ? String(tradeNo).trim() : null;
  const tid = traceId ? String(traceId).trim() : null;
  const ps = providerStatus ? String(providerStatus).trim() : null;
  const pc = providerCode ? String(providerCode).trim() : null;
  const pm = providerMsg ? String(providerMsg).trim() : null;
  const psm = providerSubMsg ? String(providerSubMsg).trim() : null;
  const via = syncVia ? String(syncVia).trim() : null;
  const internal = payStatus ? String(payStatus).trim() : null;
  await dbRun(
    `
    UPDATE orders SET
      pay_provider = COALESCE(pay_provider, ?),
      pay_out_trade_no = COALESCE(pay_out_trade_no, ?),
      pay_trade_no = COALESCE(pay_trade_no, ?),
      pay_trace_id = COALESCE(pay_trace_id, ?),
      pay_provider_status = COALESCE(?, pay_provider_status),
      pay_provider_code = COALESCE(?, pay_provider_code),
      pay_provider_msg = COALESCE(?, pay_provider_msg),
      pay_provider_sub_msg = COALESCE(?, pay_provider_sub_msg),
      pay_last_sync_via = COALESCE(?, pay_last_sync_via),
      pay_last_sync_at = CURRENT_TIMESTAMP,
      pay_status = CASE WHEN pay_status = 'paid' THEN pay_status ELSE COALESCE(?, pay_status) END
    WHERE id = ?
    `,
    [prov, outNo, tn, tid, ps, pc, pm, psm, via, internal, oid]
  ).catch(() => {});
};

module.exports = {
  createPendingOrder,
  cancelPendingOrder,
  completePendingOrder,
  markOrderPaid,
  updateOrderPayMeta
};
