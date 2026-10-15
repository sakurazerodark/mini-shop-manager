const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { protect, PERMISSIONS } = require('../middleware/permissions');

router.get('/', protect(PERMISSIONS.ORDER_VIEW), supplierController.getAllSuppliers);
router.post('/', protect(PERMISSIONS.ORDER_MANAGE), supplierController.createSupplier);
router.put('/:id', protect(PERMISSIONS.ORDER_MANAGE), supplierController.updateSupplier);
router.delete('/:id', protect(PERMISSIONS.ORDER_MANAGE), supplierController.deleteSupplier);

module.exports = router;
