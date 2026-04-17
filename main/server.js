const express = require('express');
const cors = require('cors');
const { db, dbRun, dbAll } = require('./database');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    logger.access({
      request_id: requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
    });
  });
  next();
});
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf?.toString('utf8') || '';
  }
}));

const { baseDataDir } = require('./utils/dir');
const uploadsDir = path.join(baseDataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));



app.use('/api', require('./routes'));

app.use((err, req, res, next) => {
  logger.error('unhandled error', { request_id: req?.requestId, message: err?.message || String(err), stack: err?.stack || '' });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器错误' });
});

// Serve frontend build if needed
app.use(express.static(path.join(__dirname, '..', 'dist')));

// 启动服务器
function startServer() {
  return new Promise((resolve) => {
    const { getAppConfig } = require('./utils/dir');
    const config = getAppConfig();
    const host = config.remoteAccess ? '0.0.0.0' : '127.0.0.1';

    const server = app.listen(PORT, host, () => {
      logger.info('server started', { port: PORT, host });
      const { reconcileAlipayOrder } = require('./services/paymentService');

      setInterval(async () => {
        try {
          const rows = await dbAll(
            "SELECT id FROM orders WHERE status = 'pending' AND (pay_provider = 'alipay' OR pay_method = 'alipay') AND (pay_status IS NULL OR pay_status != 'paid') ORDER BY created_at DESC LIMIT 20"
          );
          if (!rows?.length) return;
          for (const r of rows) {
            const orderId = String(r.id || '').trim();
            if (!orderId) continue;
            const result = await reconcileAlipayOrder(orderId, { purpose: 'reconcile_job' }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
            if (result?.ok && result?.paid) {
              const tail = (v, n = 8) => {
                const s = String(v || '');
                return !s ? '' : s.length <= n ? s : s.slice(-n);
              };
              logger.info('alipay reconcile paid', { order_id: orderId, trade_no_tail: tail(result.trade_no), trade_status: result.trade_status, trace_id: result.trace_id || '' });
            }
          }
        } catch (e) {
          logger.error('alipay reconcile job error', { message: e?.message || String(e) });
        }
      }, 30_000);

      // 异常订单检测定时任务 (超过1小时未支付的订单标记为异常)
      setInterval(async () => {
        try {
          const result = await dbRun(
            "UPDATE orders SET status = 'abnormal' WHERE status = 'pending' AND created_at <= datetime('now', '-1 hour')"
          );
          if (result.changes > 0) {
            logger.info('abnormal orders marked', { count: result.changes });
          }
        } catch (e) {
          logger.error('abnormal orders job error', { message: e?.message || String(e) });
        }
      }, 60_000);

      resolve(server);
    });
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { message: reason?.message || String(reason), stack: reason?.stack || '' });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err?.message || String(err), stack: err?.stack || '' });
  if (process.versions.hasOwnProperty('electron')) {
    const { app, dialog } = require('electron');
    try {
      if (dialog && app.isReady()) {
        dialog.showErrorBox('致命错误', err?.message || String(err));
      }
    } catch (_) {}
    if (app) app.quit();
  } else {
    process.exit(1);
  }
});

module.exports = { startServer, app };