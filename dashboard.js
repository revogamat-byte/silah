'use strict';
const db = require('../db');
const { serializePerson } = require('./people');

function register(router) {
  router.get('/api/dashboard/stats', async (req, res, ctx) => {
    const ownerId = ctx.user.id;
    const totalPersons = db.prepare('SELECT COUNT(*) c FROM persons WHERE owner_id=? AND deleted_at IS NULL').get(ownerId).c;
    const alive = db.prepare("SELECT COUNT(*) c FROM persons WHERE owner_id=? AND deleted_at IS NULL AND life_status='alive'").get(ownerId).c;
    const deceased = db.prepare("SELECT COUNT(*) c FROM persons WHERE owner_id=? AND deleted_at IS NULL AND life_status='deceased'").get(ownerId).c;
    const marriages = db.prepare('SELECT COUNT(*) c FROM marriages WHERE owner_id=?').get(ownerId).c;
    const activeMarriages = db.prepare("SELECT COUNT(*) c FROM marriages WHERE owner_id=? AND status='married'").get(ownerId).c;
    const divorced = db.prepare("SELECT COUNT(*) c FROM marriages WHERE owner_id=? AND status='divorced'").get(ownerId).c;
    const relationships = db.prepare('SELECT COUNT(*) c FROM parent_child WHERE owner_id=?').get(ownerId).c;

    // تقدير عدد الفروع/العائلات المنفصلة عبر Union-Find بسيط على الرسم البياني
    const persons = db.prepare('SELECT id FROM persons WHERE owner_id=? AND deleted_at IS NULL').all(ownerId).map((r) => r.id);
    const parent = new Map(persons.map((id) => [id, id]));
    function find(x) {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const pcRows = db.prepare('SELECT parent_id, child_id FROM parent_child WHERE owner_id=?').all(ownerId);
    for (const r of pcRows) {
      if (parent.has(r.parent_id) && parent.has(r.child_id)) union(r.parent_id, r.child_id);
    }
    const mRows = db.prepare('SELECT spouse_a_id, spouse_b_id FROM marriages WHERE owner_id=?').all(ownerId);
    for (const r of mRows) {
      if (parent.has(r.spouse_a_id) && parent.has(r.spouse_b_id)) union(r.spouse_a_id, r.spouse_b_id);
    }
    const roots = new Set(persons.map((id) => find(id)));

    const recent = db
      .prepare('SELECT * FROM persons WHERE owner_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 8')
      .all(ownerId)
      .map(serializePerson);
    const recentActions = db
      .prepare('SELECT action, entity_type, entity_id, created_at FROM audit_log WHERE owner_id=? ORDER BY created_at DESC LIMIT 15')
      .all(ownerId);

    ctx.json(200, {
      total_persons: totalPersons,
      alive,
      deceased,
      unknown_status: totalPersons - alive - deceased,
      marriages,
      active_marriages: activeMarriages,
      divorced,
      relationships,
      family_branches: roots.size,
      recent_persons: recent,
      recent_actions: recentActions,
    });
  });
}

module.exports = { register };
