import { config } from '../config.js';

export function resolveUser(req, res, next) {
  const headerUserId = req.get('x-user-id');
  const resolvedUserId = (headerUserId || config.app.defaultDevUserId || 'default-user').trim();

  req.userId = resolvedUserId || 'default-user';
  next();
}

export default resolveUser;
