import request from './request'

export const getSuppliers = () => request.get('/suppliers')
export const createSupplier = (data) => request.post('/suppliers', data)
export const deleteSupplier = (id) => request.delete(`/suppliers/${id}`)
