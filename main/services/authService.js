const crypto = require('crypto');
const { dbRun, dbGet, dbAll } = require('../database');

const SESSION_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 7));

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const value = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${value}`;
};

const verifyPassword = (password, encoded) => {
  const [algorithm, salt, expected] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const toSqlDate = (date) => date.toISOString().replace('T', ' ').slice(0, 19);
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const publicUser = (user) => user && ({
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  email: user.email || null,
  status: user.status,
  created_at: user.created_at,
  updated_at: user.updated_at,
  last_login_at: user.last_login_at,
  roles: user.roles || [],
  permissions: user.permissions || []
});

const getUserById = async (id) => {
  const user = await dbGet('SELECT id, username, display_name, email, status, created_at, updated_at, last_login_at FROM users WHERE id = ?', [id]);
  if (!user) return null;
  user.roles = (await dbAll(`SELECT r.id, r.name, r.description FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name`, [id])) || [];
  user.permissions = (await dbAll(`SELECT DISTINCT p.permission_key FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?`, [id])).map(p => p.permission_key);
  return user;
};

const getUserRecord = async (identifier) => dbGet(
  'SELECT id, username, password_hash, display_name, email, status, created_at, updated_at, last_login_at FROM users WHERE (id = ? OR username = ?) LIMIT 1',
  [identifier, String(identifier)]
);

const login = async (username, password, metadata = {}) => {
  const record = await getUserRecord(String(username || '').trim());
  if (!record || record.status !== 'active' || !verifyPassword(password, record.password_hash)) {
    const error = new Error('用户名或密码错误');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await dbRun('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [toSqlDate(now), toSqlDate(now), record.id]);
  const token = crypto.randomBytes(48).toString('base64url');
  await dbRun('INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)', [tokenHash(token), record.id, toSqlDate(expires), metadata.ip || '', metadata.userAgent || '']);
  const user = await getUserById(record.id);
  return { token, expires_at: toSqlDate(expires), user: publicUser(user) };
};

const getSessionUser = async (token) => {
  if (!token) return null;
  const row = await dbGet(`SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND u.status = 'active'`, [tokenHash(token)]);
  return row ? getUserById(row.user_id) : null;
};

const revokeSession = async (token) => {
  if (token) await dbRun('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE token_hash = ?', [tokenHash(token)]);
};

const listUsers = async ({ page = 1, pageSize = 20, search = '', status = '' } = {}) => {
  page = Math.max(1, Number(page) || 1); pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const clauses = []; const params = [];
  if (search) { clauses.push('(u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)'); const q = `%${search}%`; params.push(q, q, q); }
  if (status) { clauses.push('u.status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const count = await dbGet(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  const items = await dbAll(`SELECT u.id, u.username, u.display_name, u.email, u.status, u.created_at, u.updated_at, u.last_login_at FROM users u ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  for (const user of items) user.roles = await dbAll('SELECT r.id, r.name, r.description FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name', [user.id]);
  const total = Number(count?.total || 0);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
};

const createUser = async ({ username, password, display_name, email, status = 'active', role_ids = [] }) => {
  if (!String(username || '').trim() || String(username).trim().length > 64) throw new Error('用户名不能为空且不能超过64个字符');
  if (String(password || '').length < 6) throw new Error('密码至少需要6个字符');
  const result = await dbRun('INSERT INTO users (username, password_hash, display_name, email, status, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))', [String(username).trim(), hashPassword(password), display_name || String(username).trim(), email || null, status === 'disabled' ? 'disabled' : 'active']);
  const userId = result.lastID;
  await setUserRoles(userId, role_ids);
  return publicUser(await getUserById(userId));
};

const updateUser = async (id, fields = {}) => {
  const updates = []; const params = [];
  if (fields.display_name !== undefined) { updates.push('display_name = ?'); params.push(fields.display_name); }
  if (fields.email !== undefined) { updates.push('email = ?'); params.push(fields.email || null); }
  if (fields.status !== undefined) { if (!['active', 'disabled'].includes(fields.status)) throw new Error('无效的账号状态'); updates.push('status = ?'); params.push(fields.status); }
  if (fields.password !== undefined) { if (String(fields.password).length < 6) throw new Error('密码至少需要6个字符'); updates.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (updates.length) { updates.push("updated_at = datetime('now')"); await dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, id]); }
  if (fields.role_ids !== undefined) await setUserRoles(id, fields.role_ids);
  return publicUser(await getUserById(id));
};

const setUserRoles = async (userId, roleIds) => {
  const ids = Array.isArray(roleIds) ? [...new Set(roleIds.map(Number).filter(Number.isInteger))] : [];
  await dbRun('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  for (const roleId of ids) await dbRun('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
};

const listRoles = async () => {
  const roles = await dbAll('SELECT id, name, description, built_in, created_at, updated_at FROM roles ORDER BY built_in DESC, name');
  for (const role of roles) role.permissions = (await dbAll('SELECT p.id, p.permission_key, p.name, p.description FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ? ORDER BY p.permission_key', [role.id]));
  return roles;
};

const createRole = async ({ name, description, permission_keys = [] }) => {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(name || ''))) throw new Error('角色名称仅支持2-64位字母、数字、下划线或短横线');
  const result = await dbRun('INSERT INTO roles (name, description, built_in, updated_at) VALUES (?, ?, 0, datetime(\'now\'))', [name, description || null]);
  await setRolePermissions(result.lastID, permission_keys);
  return (await listRoles()).find(r => r.id === result.lastID);
};

const setRolePermissions = async (roleId, permissionKeys) => {
  const keys = Array.isArray(permissionKeys) ? [...new Set(permissionKeys.map(String))] : [];
  await dbRun('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  for (const key of keys) {
    const permission = await dbGet('SELECT id FROM permissions WHERE permission_key = ?', [key]);
    if (permission) await dbRun('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permission.id]);
  }
};

const updateRole = async (id, fields = {}) => {
  const role = await dbGet('SELECT id, built_in FROM roles WHERE id = ?', [id]);
  if (!role) return null;
  if (fields.name !== undefined || fields.description !== undefined) {
    if (role.built_in && fields.name !== undefined) throw new Error('内置角色名称不可修改');
    const updates = []; const params = [];
    if (fields.name !== undefined) { if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(fields.name))) throw new Error('无效的角色名称'); updates.push('name = ?'); params.push(fields.name); }
    if (fields.description !== undefined) { updates.push('description = ?'); params.push(fields.description || null); }
    updates.push("updated_at = datetime('now')"); await dbRun(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  }
  if (fields.permission_keys !== undefined) await setRolePermissions(id, fields.permission_keys);
  return (await listRoles()).find(r => r.id === Number(id));
};

const writeAudit = async ({ userId, action, resource, resourceId, details, result = 'success', ip, userAgent }) => {
  await dbRun('INSERT INTO audit_logs (user_id, action, resource, resource_id, details, result, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId || null, action, resource || null, resourceId == null ? null : String(resourceId), details ? JSON.stringify(details) : null, result, ip || '', userAgent || '']);
};

module.exports = { hashPassword, verifyPassword, publicUser, getUserById, login, getSessionUser, revokeSession, listUsers, createUser, updateUser, setUserRoles, listRoles, createRole, updateRole, setRolePermissions, writeAudit };
