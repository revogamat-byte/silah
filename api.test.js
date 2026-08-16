'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const TEST_DB = path.join(__dirname, '..', 'data', 'test-api.db');
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB + ext)) fs.unlinkSync(TEST_DB + ext);
}
process.env.SILAH_DB_PATH = TEST_DB;
process.env.PORT = '0'; // منفذ عشوائي متاح

const server = require('../server/app');

function waitForListen() {
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
}

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(chunks); } catch (e) { parsed = chunks; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('تسجيل مستخدم جديد وتسجيل الدخول', async () => {
  await waitForListen();
  const reg = await request('POST', '/api/auth/register', { body: { email: 'user1@test.com', password: 'password123', name: 'مستخدم1' } });
  assert.strictEqual(reg.status, 201);
  assert.ok(reg.body.token);

  const login = await request('POST', '/api/auth/login', { body: { email: 'user1@test.com', password: 'password123' } });
  assert.strictEqual(login.status, 200);
  assert.ok(login.body.token);

  const badLogin = await request('POST', '/api/auth/login', { body: { email: 'user1@test.com', password: 'wrong' } });
  assert.strictEqual(badLogin.status, 401);
});

test('لا يمكن الوصول لأي مورد API بدون تسجيل دخول', async () => {
  const res = await request('GET', '/api/people');
  assert.strictEqual(res.status, 401);
});

test('إنشاء شخص عبر API والتحقق من صحة الحقول', async () => {
  const reg = await request('POST', '/api/auth/register', { body: { email: 'user2@test.com', password: 'password123', name: 'مستخدم2' } });
  const token = reg.body.token;

  const missingName = await request('POST', '/api/people', { token, body: { gender: 'male' } });
  assert.strictEqual(missingName.status, 400);

  const created = await request('POST', '/api/people', { token, body: { first_name: 'أحمد', gender: 'male', confirm_create_anyway: true } });
  assert.strictEqual(created.status, 201);
  assert.ok(created.body.person.id);
});

test('عزل البيانات: مستخدم لا يرى أشخاص مستخدم آخر (IDOR protection)', async () => {
  const regA = await request('POST', '/api/auth/register', { body: { email: 'isoA@test.com', password: 'password123', name: 'أ' } });
  const regB = await request('POST', '/api/auth/register', { body: { email: 'isoB@test.com', password: 'password123', name: 'ب' } });
  const tokenA = regA.body.token;
  const tokenB = regB.body.token;

  const personA = await request('POST', '/api/people', { token: tokenA, body: { first_name: 'سري_أ', gender: 'male', confirm_create_anyway: true } });
  const personAId = personA.body.person.id;

  // مستخدم B يحاول الوصول لشخص يملكه مستخدم A مباشرة عبر الـ ID
  const attempt = await request('GET', `/api/people/${personAId}`, { token: tokenB });
  assert.strictEqual(attempt.status, 404); // لا يُكشف عن وجوده حتى

  // وقائمة أشخاص B فارغة رغم وجود شخص لدى A
  const listB = await request('GET', '/api/people', { token: tokenB });
  assert.strictEqual(listB.body.total, 0);

  // بحث B لا يجد شخص A
  const searchB = await request('GET', `/api/people/search?q=${encodeURIComponent('سري')}`, { token: tokenB });
  assert.strictEqual(searchB.body.items.length, 0);
});

test('استيراد CSV: preview يكتشف الأخطاء دون كتابة بيانات، commit يكتب الصحيح فقط', async () => {
  const reg = await request('POST', '/api/auth/register', { body: { email: 'importer@test.com', password: 'password123', name: 'مستورد' } });
  const token = reg.body.token;

  const csvBad = 'first_name,gender\n,male\nسالم,invalid_gender';
  const preview = await request('POST', '/api/import/preview', { token, body: { format: 'csv', content: csvBad } });
  assert.strictEqual(preview.status, 200);
  assert.ok(preview.body.errors.length >= 2);
  assert.strictEqual(preview.body.can_import, false);

  const commitBad = await request('POST', '/api/import/commit', { token, body: { format: 'csv', content: csvBad } });
  assert.strictEqual(commitBad.status, 400);

  const listAfterFailedImport = await request('GET', '/api/people', { token });
  assert.strictEqual(listAfterFailedImport.body.total, 0); // لم يتأثر شيء (rollback/رفض كامل)

  const csvGood = 'local_id,first_name,gender,father_local_id\n1,الجد,male,\n2,الابن,male,1';
  const commitGood = await request('POST', '/api/import/commit', { token, body: { format: 'csv', content: csvGood } });
  assert.strictEqual(commitGood.status, 200);
  assert.strictEqual(commitGood.body.imported, 2);

  const listAfter = await request('GET', '/api/people', { token });
  assert.strictEqual(listAfter.body.total, 2);
});

test('تصدير JSON يُرجع كل بيانات المستخدم', async () => {
  const reg = await request('POST', '/api/auth/register', { body: { email: 'exporter@test.com', password: 'password123', name: 'مصدّر' } });
  const token = reg.body.token;
  await request('POST', '/api/people', { token, body: { first_name: 'شخص للتصدير', gender: 'male', confirm_create_anyway: true } });
  const exported = await request('GET', '/api/export?format=json', { token });
  assert.strictEqual(exported.status, 200);
  assert.strictEqual(exported.body.persons.length, 1);
});

test('كشف التكرار عند الإضافة يعرض تحذيرًا بدل الإنشاء المباشر', async () => {
  const reg = await request('POST', '/api/auth/register', { body: { email: 'dup@test.com', password: 'password123', name: 'مكرر' } });
  const token = reg.body.token;
  await request('POST', '/api/people', { token, body: { first_name: 'محمد أحمد', gender: 'male', confirm_create_anyway: true } });
  const attempt2 = await request('POST', '/api/people', { token, body: { first_name: 'محمد أحمد', gender: 'male' } });
  assert.ok(attempt2.body.possible_duplicates && attempt2.body.possible_duplicates.length > 0);
});

test('الحذف الآمن: soft delete لا يفسد العلاقات المرتبطة', async () => {
  const reg = await request('POST', '/api/auth/register', { body: { email: 'del@test.com', password: 'password123', name: 'حذف' } });
  const token = reg.body.token;
  const parent = await request('POST', '/api/people', { token, body: { first_name: 'أب للحذف', gender: 'male', confirm_create_anyway: true } });
  const child = await request('POST', '/api/people', { token, body: { first_name: 'ابن', gender: 'male', confirm_create_anyway: true } });
  await request('POST', '/api/relationships/parent-child', { token, body: { parent_id: parent.body.person.id, child_id: child.body.person.id, parent_role: 'father' } });

  const impact = await request('GET', `/api/people/${parent.body.person.id}/delete-impact`, { token });
  assert.strictEqual(impact.body.children_affected, 1);

  const del = await request('DELETE', `/api/people/${parent.body.person.id}`, { token });
  assert.strictEqual(del.status, 200);

  const afterDelete = await request('GET', `/api/people/${parent.body.person.id}`, { token });
  assert.strictEqual(afterDelete.status, 404); // لا يظهر في الاستعلامات العادية بعد الحذف الناعم
});

test.after(() => {
  server.close();
});
