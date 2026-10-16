import request from './request'

export const getBasicSettings = () => request.get('/settings/basic')
export const updateBasicSettings = (data) => request.put('/settings/basic', data)
export const getBarcodeLookup = () => request.get('/settings/barcode_lookup')
export const updateBarcodeLookup = (data) => request.put('/settings/barcode_lookup', data)
export const getCostingMode = () => request.get('/settings/costing_mode')
export const updateCostingMode = (data) => request.put('/settings/costing_mode', data)
export const getPayments = () => request.get('/settings/payments')
export const updatePayments = (data) => request.put('/settings/payments', data)
export const getDataDir = () => request.get('/settings/data_dir')
// The native directory picker can remain open longer than the normal API timeout.
export const selectDataDir = () => request.post('/settings/data_dir/select', null, { timeout: 0 })
// Copying a data directory depends on its size, so let the user wait for it.
export const migrateDataDir = (data) => request.post('/settings/data_dir/migrate', data, { timeout: 0 })
export const getNetworkConfig = () => request.get('/settings/network')
export const updateNetworkConfig = (data) => request.put('/settings/network', data)
export const getDefaultPassword = () => request.get('/settings/default-password/status')
export const updateDefaultPassword = (data) => request.put('/settings/default-password', data)
