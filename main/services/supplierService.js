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
  const inUse = await dbGet("SELECT id FROM products WHERE supplier_id = ? LIMIT 1", [id]);
  if (inUse) throw new Error('该供应商已被商品关联，无法删除');
  await dbRun("DELETE FROM suppliers WHERE id = ?", [id]);
};

module.exports = {
  getAllSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier
};
