'use strict';
const db = require('../db');
const { uuid, nowIso, MARRIAGE_STATUSES } = require('../lib/validate');
const { logAction } = require('../lib/audit');

function register(router) {
  router.get('/api/marriages', async (req, res, ctx) => {
    const personId = ctx.query.get('person_id');
    let rows;
    if (personId) {
      rows = db
        .prepare('SELECT * FROM marriages WHERE (spouse_a_id=? OR spouse_b_id=?) AND owner_id=? ORDER BY start_date')
        .all(personId, personId, ctx.user.id);
    } else {
      rows = db.prepare('SELECT * FROM marriages WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').all(ctx.user.id);
    }
    ctx.json(200, { items: rows });
  });

  router.post('/api/marriages', async (req, res, ctx) => {
    const { spouse_a_id, spouse_b_id, start_date, end_date, status, place, notes, source } = ctx.body;
    if (!spouse_a_id || !spouse_b_id) return ctx.error(400, 'يجب تحديد الزوجين.');
    if (spouse_a_id === spouse_b_id) return ctx.error(400, 'لا يمكن أن يتزوج الشخص من نفسه.');
    const st = status && MARRIAGE_STATUSES.has(status) ? status : 'married';

    const a = db.prepare('SELECT id FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(spouse_a_id, ctx.user.id);
    const b = db.prepare('SELECT id FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(spouse_b_id, ctx.user.id);
    if (!a || !b) return ctx.error(404, 'أحد الأشخاص غير موجود.');

    const id = uuid();
    db.prepare(
      `INSERT INTO marriages (id, owner_id, spouse_a_id, spouse_b_id, start_date, end_date, status, place, notes, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, ctx.user.id, spouse_a_id, spouse_b_id, start_date || null, end_date || null, st, place || null, notes || null, source || null, nowIso());
    logAction(ctx.user.id, ctx.user.id, 'create', 'marriage', id, { spouse_a_id, spouse_b_id });
    ctx.json(201, { id });
  });

  // تغيير الحالة (طلاق / ترمّل) لا يحذف السجل — التاريخ يبقى محفوظًا كما هو مطلوب
  router.patch('/api/marriages/:id', async (req, res, ctx) => {
    const existing = db.prepare('SELECT * FROM marriages WHERE id=? AND owner_id=?').get(ctx.params.id, ctx.user.id);
    if (!existing) return ctx.error(404, 'الزواج غير موجود.');
    const { status, end_date, place, notes } = ctx.body;
    const newStatus = status && MARRIAGE_STATUSES.has(status) ? status : existing.status;
    db.prepare(
      'UPDATE marriages SET status=?, end_date=COALESCE(?, end_date), place=COALESCE(?, place), notes=COALESCE(?, notes) WHERE id=? AND owner_id=?'
    ).run(newStatus, end_date || null, place || null, notes || null, ctx.params.id, ctx.user.id);
    logAction(ctx.user.id, ctx.user.id, 'update', 'marriage', ctx.params.id, { status: newStatus });
    ctx.json(200, { ok: true });
  });

  router.delete('/api/marriages/:id', async (req, res, ctx) => {
    // حذف سجل الزواج نفسه مسموح فقط إذا كان خطأ إدخال (وليس كوسيلة لحذف زواج منتهٍ)
    const existing = db.prepare('SELECT * FROM marriages WHERE id=? AND owner_id=?').get(ctx.params.id, ctx.user.id);
    if (!existing) return ctx.error(404, 'الزواج غير موجود.');
    db.prepare('DELETE FROM marriages WHERE id=? AND owner_id=?').run(ctx.params.id, ctx.user.id);
    logAction(ctx.user.id, ctx.user.id, 'delete', 'marriage', ctx.params.id, {});
    ctx.json(200, { ok: true });
  });
}

module.exports = { register };
