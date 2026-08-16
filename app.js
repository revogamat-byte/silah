'use strict';
const http = require('node:http');
const path = require('node:path');
const { Router, readJsonBody, sendJson, serveStatic, URL } = require('./lib/http-kit');
const { getUserFromToken } = require('./lib/auth');

const router = new Router();
require('./routes/auth')(router);
require('./routes/people').register(router);
require('./routes/relationships').register(router);
require('./routes/marriages').register(router);
require('./routes/kinship').register(router);
require('./routes/dashboard').register(router);
require('./routes/importExport').register(router);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// حماية أساسية من هجمات الطلبات المفرطة (Rate limiting بسيط في الذاكرة)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 300;
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count++;
  rateBuckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT_MAX;
}

const PUBLIC_ROUTES = new Set(['POST /api/auth/register', 'POST /api/auth/login']);

const server = http.createServer(async (req, res) => {
  // رؤوس أمان أساسية
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const ip = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return sendJson(res, 429, { error: 'طلبات كثيرة جدًا. حاول لاحقًا.' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    const served = serveStatic(PUBLIC_DIR, pathname, res);
    if (served) return;
    // SPA fallback
    return serveStatic(PUBLIC_DIR, '/index.html', res) || (res.writeHead(404), res.end('Not found'));
  }

  const match = router.match(req.method, pathname);
  if (!match) {
    return sendJson(res, 404, { error: 'المسار غير موجود.' });
  }

  let body = {};
  if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: e.message === 'PAYLOAD_TOO_LARGE' ? 'البيانات المرسلة كبيرة جدًا.' : 'صيغة JSON غير صحيحة.' });
    }
  }

  // ملاحظة أمان: لا نقبل رمز الجلسة عبر query string إطلاقًا (كان مدعومًا سابقًا لروابط
  // التنزيل المباشرة، لكن هذا يُسرّب الرمز عبر سجل المتصفح وسجلات الخادم). الواجهة الآن
  // تستخدم fetch() مع رأس Authorization دائمًا حتى لملفات التصدير.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let user = null;
  try {
    user = getUserFromToken(token);
  } catch (e) {
    user = null;
  }

  const routeKey = `${req.method} ${pathname}`;
  const isPublic = PUBLIC_ROUTES.has(routeKey);
  if (!isPublic && !user) {
    return sendJson(res, 401, { error: 'يجب تسجيل الدخول للوصول إلى هذا المورد.' });
  }

  const ctx = {
    body,
    params: match.params,
    query: url.searchParams,
    user,
    token,
    json: (status, obj) => sendJson(res, status, obj),
    error: (status, message) => sendJson(res, status, { error: message }),
  };

  try {
    await match.handler(req, res, ctx);
  } catch (e) {
    console.error('Unhandled route error:', e);
    if (e.status) {
      sendJson(res, e.status, { error: e.message });
    } else {
      sendJson(res, 500, { error: 'حدث خطأ غير متوقع في الخادم. تم تسجيل الخطأ.' });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`صلة (Silah) يعمل الآن على: http://localhost:${PORT}`);
});

module.exports = server;
