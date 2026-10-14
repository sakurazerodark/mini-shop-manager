const authService = require('../services/authService');

const getBearer = (req) => {
  const value = String(req.headers.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const authenticate = async (req, res, next) => {
  try {
    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: '需要登录', code: 'AUTH_REQUIRED' });
    const user = await authService.getSessionUser(token);
    if (!user) return res.status(401).json({ error: '登录已失效，请重新登录', code: 'SESSION_INVALID' });
    req.authToken = token;
    req.user = { ...user, permissions: user.permissions || [], roles: user.roles || [] };
    return next();
  } catch (error) {
    return next(error);
  }
};

const requirePermission = (permission) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '需要登录', code: 'AUTH_REQUIRED' });
  const permissions = req.user.permissions || [];
  if (permissions.includes('*') || permissions.includes(permission)) return next();
  return res.status(403).json({ error: '没有执行该操作的权限', code: 'FORBIDDEN', required_permission: permission });
};

const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = getBearer(req);
    if (token) {
      const user = await authService.getSessionUser(token);
      if (user) { req.authToken = token; req.user = { ...user, permissions: user.permissions || [], roles: user.roles || [] }; }
    }
    next();
  } catch (error) { next(error); }
};

module.exports = { getBearer, authenticate, requirePermission, optionalAuthenticate };
