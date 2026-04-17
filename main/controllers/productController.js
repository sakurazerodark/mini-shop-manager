const { db, dbGet, dbRun, dbAll } = require('../database');
const productService = require('../services/productService');
const settingService = require('../services/settingService');
const { saveBase64Image } = require('../utils/file');

exports.lookupBarcode = async (req, res) => {
  try {
    const data = await productService.lookupBarcode(req.params.barcode);
    if (!data) return res.status(404).json({ error: '未找到条码信息' });
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getAllProducts = (req, res) => {
  const sql = 'SELECT * FROM products WHERE deleted_at IS NULL';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
};

exports.getDeletedProducts = (req, res) => {
  const sql = 'SELECT * FROM products WHERE deleted_at IS NOT NULL';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
};

exports.getProductByBarcode = (req, res) => {
  const sql = 'SELECT * FROM products WHERE barcode = ? AND deleted_at IS NULL';
  db.get(sql, [req.params.barcode], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: '商品未找到' });
    res.json({ data: row });
  });
};

exports.updateProduct = async (req, res) => {
  const productId = req.params.id;
  const { name, brand, supplier_ids, barcode, category_id, min_stock, expiry_date, unit, is_weighing, image_url, image_base64, image_mime } = req.body;
  try {
    const product = await new Promise((resolve, reject) => {
      db.get("SELECT id FROM products WHERE id = ?", [productId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!product) return res.status(404).json({ error: '商品未找到' });

    let finalImageUrl = req.body.image_url !== undefined ? req.body.image_url : null;
    if (image_base64) {
      finalImageUrl = await saveBase64Image({ base64: image_base64, mime: image_mime });
    }

    const updates = [];
    const params = [];
    
    if (name !== undefined) { updates.push("name = ?"); params.push(name); }
    if (brand !== undefined) { updates.push("brand = ?"); params.push(brand); }
    if (supplier_ids !== undefined) { 
      updates.push("supplier_ids = ?"); 
      params.push(Array.isArray(supplier_ids) ? JSON.stringify(supplier_ids) : '[]'); 
    }
    if (barcode !== undefined) { updates.push("barcode = ?"); params.push(barcode); }
    if (category_id !== undefined) { updates.push("category_id = ?"); params.push(category_id); }
    if (min_stock !== undefined) { updates.push("min_stock = ?"); params.push(min_stock); }
    if (expiry_date !== undefined) { updates.push("expiry_date = ?"); params.push(expiry_date); }
    if (unit !== undefined) { updates.push("unit = ?"); params.push(unit); }
    if (is_weighing !== undefined) { updates.push("is_weighing = ?"); params.push(is_weighing ? 1 : 0); }
    if (finalImageUrl !== null) { updates.push("image_url = ?"); params.push(finalImageUrl); }

    if (updates.length === 0) return res.json({ message: '无字段更新' });

    params.push(productId);
    const sql = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
    
    await new Promise((resolve, reject) => {
      db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
    });
    res.json({ message: '商品信息更新成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.addProduct = (req, res) => {
  const { barcode, name, cost_price, retail_price, stock, min_stock, expiry_date, unit, is_weighing, image_url, image_base64, image_mime, brand, supplier_ids } = req.body;
  const sql = `INSERT INTO products (barcode, name, cost_price, last_cost_price, retail_price, stock, min_stock, expiry_date, unit, is_weighing, image_url, brand, supplier_ids)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    (async () => {
      try {
        const savedImageUrl = image_base64 ? await saveBase64Image({ base64: image_base64, mime: image_mime }) : null;
        const finalImageUrl = savedImageUrl || image_url || null;
        const sIdsStr = Array.isArray(supplier_ids) ? JSON.stringify(supplier_ids) : '[]';

        db.run(
          sql,
          [barcode, name, cost_price, cost_price, retail_price, stock, min_stock, expiry_date, unit || '件', is_weighing ? 1 : 0, finalImageUrl, brand || '', sIdsStr],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              if (err.message && err.message.includes('UNIQUE constraint failed: products.barcode')) {
                return res.status(400).json({ error: '该商品条码已存在，请不要重复添加' });
              }
              return res.status(500).json({ error: err.message });
            }
            const productId = this.lastID;
            const initialStock = Number(stock || 0);
            if (initialStock > 0) {
              db.run(
                "INSERT INTO stock_batches (product_id, qty_remaining, unit_cost_price) VALUES (?, ?, ?)",
                [productId, initialStock, Number(cost_price || 0)]
              );
            }
            db.run(
              "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'init', ?, ?, ?, ?)",
              [productId, initialStock, Number(cost_price || 0), Number(retail_price || 0), 'system']
            );
            db.run("COMMIT", (commitErr) => {
              if (commitErr) return res.status(500).json({ error: commitErr.message });
              res.json({ id: productId, message: '商品添加成功' });
            });
          }
        );
      } catch (e) {
        db.run("ROLLBACK");
        res.status(500).json({ error: e.message });
      }
    })();
  });
};

const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
});
const dbGetAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

exports.updateProductPrices = async (req, res) => {
  const productId = req.params.id;
  const { cost_price, retail_price, reason } = req.body || {};
  if (cost_price == null && retail_price == null) {
    return res.status(400).json({ error: '至少提供 cost_price 或 retail_price' });
  }
  try {
    const product = await dbGetAsync("SELECT id, stock, cost_price, last_cost_price, retail_price FROM products WHERE id = ?", [productId]);
    if (!product) return res.status(404).json({ error: '商品未找到' });

    const mode = await settingService.getCostingMode();

    await dbRunAsync("BEGIN TRANSACTION");

    const oldRetail = Number(product.retail_price || 0);
    const oldLastCost = Number(product.last_cost_price || 0);
    const oldAvgCost = Number(product.cost_price || 0);

    let nextRetail = oldRetail;
    let nextLastCost = oldLastCost;

    if (retail_price != null) nextRetail = Number(retail_price);
    if (cost_price != null) nextLastCost = Number(cost_price);

    await dbRunAsync("UPDATE products SET retail_price = ?, last_cost_price = ? WHERE id = ?", [nextRetail, nextLastCost, productId]);

    if (mode === 'avg') {
      const stock = Number(product.stock || 0);
      if (stock <= 0 && cost_price != null) {
        await dbRunAsync("UPDATE products SET cost_price = ? WHERE id = ?", [nextLastCost, productId]);
        await productService.insertPriceLog({ productId, priceType: 'avg_cost', oldPrice: oldAvgCost, newPrice: nextLastCost, reason });
      }
    } else {
      await productService.recalcAvgCostFromBatches(productId).catch(() => {});
    }

    await productService.insertPriceLog({ productId, priceType: 'retail', oldPrice: oldRetail, newPrice: nextRetail, reason });
    await productService.insertPriceLog({ productId, priceType: 'last_cost', oldPrice: oldLastCost, newPrice: nextLastCost, reason });

    await dbRunAsync("COMMIT");
    res.json({ message: '价格更新成功' });
  } catch (e) {
    await dbRunAsync("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  }
};

exports.getProductPriceLogs = async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM product_price_logs WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 200", [req.params.id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.reportProductLoss = (req, res) => {
  const { loss_qty, reason } = req.body;
  const productId = req.params.id;
  
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const updateStock = "UPDATE products SET stock = stock - ? WHERE id = ?";
    const qty = Number(loss_qty || 0);
    db.get("SELECT stock, cost_price, last_cost_price, retail_price FROM products WHERE id = ?", [productId], async (err, row) => {
      if (err || !row) {
        db.run("ROLLBACK");
        return res.status(404).json({ error: '商品未找到' });
      }
      try {
        const mode = await settingService.getCostingMode();
        let unitCost = Number(row.cost_price || 0);
        if (mode === 'fifo') {
          const result = await productService.consumeBatchesFIFO(productId, qty);
          unitCost = result.unitCost;
        }

        db.run(updateStock, [qty, productId]);
        db.run(
          "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'loss', ?, ?, ?, ?)",
          [productId, -qty, unitCost, null, reason || 'system']
        );

        if (mode === 'fifo') {
          await productService.recalcAvgCostFromBatches(productId).catch(() => {});
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) return res.status(500).json({ error: '报损失败: ' + commitErr.message });
          res.json({ message: '报损处理成功' });
        });
      } catch (e) {
        db.run("ROLLBACK");
        res.status(500).json({ error: '报损失败: ' + e.message });
      }
    });
  });
};

exports.restockProduct = (req, res) => {
  const { qty, reason, cost_price, retail_price } = req.body;
  const productId = req.params.id;
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const addQty = Number(qty || 0);
    if (addQty <= 0) {
      db.run("ROLLBACK");
      return res.status(400).json({ error: 'qty 必须大于0' });
    }

    db.get("SELECT stock, cost_price, last_cost_price, retail_price FROM products WHERE id = ?", [productId], async (err, row) => {
      if (err || !row) {
        db.run("ROLLBACK");
        return res.status(404).json({ error: '商品未找到' });
      }

      const oldStock = Number(row.stock || 0);
      const oldAvgCost = Number(row.cost_price || 0);
      const oldLastCost = Number(row.last_cost_price || 0);
      const oldRetail = Number(row.retail_price || 0);

      const inCost = cost_price != null ? Number(cost_price) : (oldLastCost || oldAvgCost || 0);
      const nextLastCost = cost_price != null ? inCost : oldLastCost;
      const nextRetail = retail_price != null ? Number(retail_price) : oldRetail;

      try {
        const mode = await settingService.getCostingMode();

        await dbRunAsync("UPDATE products SET stock = stock + ?, last_cost_price = ?, retail_price = ? WHERE id = ?", [addQty, nextLastCost, nextRetail, productId]);
        await dbRunAsync("INSERT INTO stock_batches (product_id, qty_remaining, unit_cost_price) VALUES (?, ?, ?)", [productId, addQty, inCost]);

        let nextAvgCost = oldAvgCost;
        if (mode === 'avg') {
          const newStock = oldStock + addQty;
          nextAvgCost = newStock > 0 ? ((oldStock * oldAvgCost) + (addQty * inCost)) / newStock : 0;
          await dbRunAsync("UPDATE products SET cost_price = ? WHERE id = ?", [nextAvgCost, productId]);
        } else {
          nextAvgCost = await productService.recalcAvgCostFromBatches(productId);
        }

        await dbRunAsync(
          "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'restock', ?, ?, ?, ?)",
          [productId, addQty, inCost, nextRetail, reason || 'system']
        );

        await productService.insertPriceLog({ productId, priceType: 'last_cost', oldPrice: oldLastCost, newPrice: nextLastCost, reason });
        await productService.insertPriceLog({ productId, priceType: 'avg_cost', oldPrice: oldAvgCost, newPrice: nextAvgCost, reason });
        await productService.insertPriceLog({ productId, priceType: 'retail', oldPrice: oldRetail, newPrice: nextRetail, reason });

        db.run("COMMIT", (commitErr) => {
          if (commitErr) return res.status(500).json({ error: '补货失败: ' + commitErr.message });
          res.json({ message: '补货成功' });
        });
      } catch (e) {
        db.run("ROLLBACK");
        res.status(500).json({ error: '补货失败: ' + e.message });
      }
    });
  });
};

exports.adjustProductStock = (req, res) => {
  const { actual_qty, reason, cost_price } = req.body;
  const productId = req.params.id;
  db.get("SELECT stock FROM products WHERE id = ?", [productId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: '商品未找到' });
    const diff = actual_qty - row.stock;
    if (diff === 0) return res.json({ message: '库存无变化' });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.get("SELECT stock, cost_price, last_cost_price, retail_price FROM products WHERE id = ?", [productId], async (pErr, pRow) => {
        if (pErr || !pRow) {
          db.run("ROLLBACK");
          return res.status(404).json({ error: '商品未找到' });
        }
        try {
          const mode = await settingService.getCostingMode();
          const oldStock = Number(pRow.stock || 0);
          const oldAvgCost = Number(pRow.cost_price || 0);
          const oldLastCost = Number(pRow.last_cost_price || 0);
          const retail = Number(pRow.retail_price || 0);

          let unitCost = oldAvgCost;
          if (diff > 0) {
            const inCost = cost_price != null ? Number(cost_price) : (oldLastCost || oldAvgCost || 0);
            unitCost = inCost;
            await dbRunAsync("INSERT INTO stock_batches (product_id, qty_remaining, unit_cost_price) VALUES (?, ?, ?)", [productId, diff, inCost]);
            if (cost_price != null) {
              await dbRunAsync("UPDATE products SET last_cost_price = ? WHERE id = ?", [inCost, productId]);
              await productService.insertPriceLog({ productId, priceType: 'last_cost', oldPrice: oldLastCost, newPrice: inCost, reason });
            }
          } else {
            const takeQty = Math.abs(Number(diff));
            if (mode === 'fifo') {
              const result = await productService.consumeBatchesFIFO(productId, takeQty);
              unitCost = result.unitCost;
            }
          }

          await dbRunAsync("UPDATE products SET stock = ? WHERE id = ?", [Number(actual_qty), productId]);

          let nextAvgCost = oldAvgCost;
          if (mode === 'avg') {
            if (diff > 0 && cost_price != null) {
              const newStock = Number(actual_qty);
              nextAvgCost = newStock > 0 ? ((oldStock * oldAvgCost) + (diff * unitCost)) / newStock : 0;
              await dbRunAsync("UPDATE products SET cost_price = ? WHERE id = ?", [nextAvgCost, productId]);
            }
          } else {
            nextAvgCost = await productService.recalcAvgCostFromBatches(productId);
          }

          await dbRunAsync(
            "INSERT INTO stock_logs (product_id, change_type, change_qty, unit_cost_price, unit_retail_price, operator) VALUES (?, 'adjust', ?, ?, ?, ?)",
            [productId, diff, unitCost, retail, reason || 'system']
          );

          await productService.insertPriceLog({ productId, priceType: 'avg_cost', oldPrice: oldAvgCost, newPrice: nextAvgCost, reason });

          db.run("COMMIT", (commitErr) => {
            if (commitErr) return res.status(500).json({ error: '盘点失败: ' + commitErr.message });
            res.json({ message: '盘点成功' });
          });
        } catch (e) {
          db.run("ROLLBACK");
          res.status(500).json({ error: '盘点失败: ' + e.message });
        }
      });
    });
  });
};

exports.getProductStockLogs = (req, res) => {
  const productId = req.params.id;
  db.all("SELECT * FROM stock_logs WHERE product_id = ? ORDER BY created_at DESC", [productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
};

exports.deleteProduct = (req, res) => {
  const sql = "UPDATE products SET deleted_at = CURRENT_TIMESTAMP, barcode = barcode || '_deleted_' || id WHERE id = ?";
  db.run(sql, [req.params.id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: '商品已移至已删除列表', changes: this.changes });
  });
};

exports.restoreProduct = (req, res) => {
  const id = req.params.id;
  db.get("SELECT barcode FROM products WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: '商品未找到' });
    
    // Revert barcode (remove _deleted_id suffix)
    const newBarcode = row.barcode ? row.barcode.replace(/_deleted_\d+$/, '') : row.barcode;
    
    db.run("UPDATE products SET deleted_at = NULL, barcode = ? WHERE id = ?", [newBarcode, id], function(err2) {
      if (err2) {
        if (err2.message && err2.message.includes('UNIQUE constraint failed: products.barcode')) {
          return res.status(400).json({ error: '无法恢复：该商品条码已被新商品占用' });
        }
        return res.status(500).json({ error: err2.message });
      }
      res.json({ message: '商品恢复成功' });
    });
  });
};
