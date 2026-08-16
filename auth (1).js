'use strict';
const db = require('../db');
const { uuid, nowIso } = require('../lib/validate');
const { hashPassword, verifyPassword, createSession, revokeSession } = require('../lib/auth');
const { logAction } = require('../lib/audit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function register(router) {
  router.post('/api/auth/register', async (req, res, ctx) => {
    const { email, password, name } = ctx.body;
    if (!email || !EMAIL_RE.test(email)) {
      return ctx.error(400, 'يرجى إدخال بريد إلكتروني صحيح.');
    }
    if (!password || String(password).length < 8) {
      return ctx.error(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
    }
    if (!name || !String(name).trim()) {
      return ctx.error(400, 'الاسم مطلوب.');
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return ctx.error(409, 'هذا البريد الإلكتروني مسجل بالفعل.');
    }
    const { hash, salt } = hashPassword(password);
    const id = uuid();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, password_salt, name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, email.toLowerCase(), hash, salt, String(name).trim(), nowIso());
    const token = createSession(id);
    logAction(id, id, 'register', 'user', id, {});
    ctx.json(201, { token, user: { id, email: email.toLowerCase(), name: String(name).trim() } });
  });

  router.post('/api/auth/login', async (req, res, ctx) => {
    const { email, password } = ctx.body;
    if (!email || !password) return ctx.error(400, 'يرجى إدخال البريد الإلكتروني وكلمة المرور.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      return ctx.error(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }
    const token = createSession(user.id);
    logAction(user.id, user.id, 'login', 'user', user.id, {});
    ctx.json(200, { token, user: { id: user.id, email: user.email, name: user.name } });
  });

  router.post('/api/auth/logout', async (req, res, ctx) => {
    const token = ctx.token;
    revokeSession(token);
    ctx.json(200, { ok: true });
  });

  router.get('/api/auth/me', async (req, res, ctx) => {
    if (!ctx.user) return ctx.error(401, 'غير مسجل الدخول.');
    ctx.json(200, { user: ctx.user });
  });
}

module.exports = register;
