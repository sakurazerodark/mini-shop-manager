const { dbGet, dbRun, dbAll } = require('../database');

const getAllSuppliers = async () => {
  return await dbAll("SELECT * FROM suppliers ORDER BY id DESC");
};

const createSupplier = async ({ name, contact, phone, address }) => {
  if (!name) throw new Error('供应商名称不能为空');
  await dbRun("INSERT INTO suppliers (name, contact, phone, address) VALUES (?, ?, ?, ?)", [name, contact || '', phone || '', address || '']);
};

const updateSupplier = async (id, { name, contact, phone, address }) => {
  if (!name) throw new Error('供应商名称不能为空');
  await dbRun("UPDATE suppliers SET name = ?, contact = ?, phone = ?, address = ? WHERE id = ?", [name, contact || '', phone || '', address || '', id]);
};

const deleteSupplier = async (id) => {
  const linkedProducts = await dbAll("SELECT id, supplier_id, supplier_ids FROM products");
  const inUse = (linkedProducts || []).find(product => {
    if (String(product.supplier_id || '') === String(id)) return true;
    try {
      return (JSON.parse(product.supplier_ids || '[]') || []).map(String).includes(String(id));
    } catch {
      return false;
    }
  });
  if (inUse) throw new Error('该供应商已被商品关联，无法删除');
  await dbRun("DELETE FROM suppliers WHERE id = ?", [id]);
};

module.exports = {
  getAllSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier
};
