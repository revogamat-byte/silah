'use strict';
const db = require('../db');
const { uuid, nowIso, PARENT_ROLES, RELATION_TYPES } = require('../lib/validate');
const { logAction } = require('../lib/audit');
const { wouldCreateCycle } = require('../lib/kinship-engine');

function register(router) {
  router.post('/api/relationships/parent-child', async (req, res, ctx) => {
    const { parent_id, child_id, parent_role, relation_type, notes, source, marriage_id } = ctx.body;
    if (!parent_id || !child_id) return ctx.error(400, 'يجب تحديد الوالد والابن.');
    if (!PARENT_ROLES.has(parent_role)) return ctx.error(400, 'يجب تحديد دور الوالد (أب أو أم).');
    const relType = relation_type && RELATION_TYPES.has(relation_type) ? relation_type : 'biological';

    const parent = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(parent_id, ctx.user.id);
    const child = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(child_id, ctx.user.id);
    if (!parent || !child) return ctx.error(404, 'الشخص المحدد غير موجود.');

    if (parent_id === child_id) {
      return ctx.error(400, 'لا يمكن أن يكون الشخص والدًا لنفسه.');
    }
    if (wouldCreateCycle(db, ctx.user.id, parent_id, child_id)) {
      return ctx.error(400, 'هذه العلاقة تُنشئ دورة غير منطقية في شجرة النسب (الشخص يصبح سلفًا لنفسه). لم تتم الإضافة.');
    }

    // تحقق: هل يوجد بالفعل أب أو أم مسجلين لهذا الطفل بنفس الدور؟ (تحذير وليس منعًا صارمًا لعلاقات step/adoptive)
    const existingSameRole = db
      .prepare('SELECT p.full_name FROM parent_child pc JOIN persons p ON p.id=pc.parent_id WHERE pc.child_id=? AND pc.parent_role=? AND pc.owner_id=? AND pc.relation_type=?')
      .all(child_id, parent_role, ctx.user.id, 'biological');
    let warning = null;
    if (relType === 'biological' && existingSameRole.length > 0) {
      warning = `تنبيه: يوجد بالفعل ${parent_role === 'father' ? 'أب' : 'أم'} بيولوجي مسجل لهذا الشخص (${existingSameRole[0].full_name}). تحقق من صحة البيانات قبل المتابعة إن كان هذا خطأً.`;
    }

    const id = uuid();
    try {
      db.prepare(
        `INSERT INTO parent_child (id, owner_id, parent_id, child_id, parent_role, relation_type, marriage_id, notes, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(id, ctx.user.id, parent_id, child_id, parent_role, relType, marriage_id || null, notes || null, source || null, nowIso());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return ctx.error(409, 'هذه العلاقة مسجلة بالفعل.');
      }
      throw e;
    }
    logAction(ctx.user.id, ctx.user.id, 'create', 'parent_child', id, { parent_id, child_id, parent_role });
    ctx.json(201, { id, warning });
  });

  router.delete('/api/relationships/parent-child/:id', async (req, res, ctx) => {
    const row = db.prepare('SELECT * FROM parent_child WHERE id=? AND owner_id=?').get(ctx.params.id, ctx.user.id);
    if (!row) return ctx.error(404, 'العلاقة غير موجودة.');
    db.prepare('DELETE FROM parent_child WHERE id=? AND owner_id=?').run(ctx.params.id, ctx.user.id);
    logAction(ctx.user.id, ctx.user.id, 'delete', 'parent_child', ctx.params.id, {});
    ctx.json(200, { ok: true });
  });
}

module.exports = { register };
