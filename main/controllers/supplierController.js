const supplierService = require('../services/supplierService');

exports.getAllSuppliers = async (req, res) => {
  try {
    const rows = await supplierService.getAllSuppliers();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    await supplierService.createSupplier(req.body);
    res.json({ message: '供应商添加成功' });
  } catch (e) {
    if (e.message === '供应商名称不能为空') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    await supplierService.updateSupplier(req.params.id, req.body);
    res.json({ message: '供应商修改成功' });
  } catch (e) {
    if (e.message === '供应商名称不能为空') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    await supplierService.deleteSupplier(req.params.id);
    res.json({ message: '供应商删除成功' });
  } catch (e) {
    if (e.message === '该供应商已被商品关联，无法删除') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
};
