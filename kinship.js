'use strict';
const db = require('../db');
const kinship = require('../lib/kinship-engine');
const { serializePerson } = require('./people');

function personBrief(id) {
  const row = db.prepare('SELECT id, full_name, first_name, gender, life_status, birth_date, death_date, photo_url FROM persons WHERE id=?').get(id);
  return row || null;
}

function enrichPath(path) {
  return path.map((step) => ({
    ...step,
    person: personBrief(step.personId),
    roleLabel: step.role === 'father' ? 'الأب' : 'الأم',
  }));
}

function register(router) {
  router.get('/api/kinship/compute', async (req, res, ctx) => {
    const a = ctx.query.get('person_a');
    const b = ctx.query.get('person_b');
    if (!a || !b) return ctx.error(400, 'يجب تحديد الشخصين.');

    const result = kinship.computeKinship(db, ctx.user.id, a, b);
    if (!result.found && result.error === 'PERSON_NOT_FOUND') {
      return ctx.error(404, 'أحد الأشخاص غير موجود.');
    }
    if (!result.found) {
      return ctx.json(200, { found: false, message: result.message });
    }

    const relations = (result.relations || []).map((r) => ({
      ...r,
      pathFromA: r.pathFromA ? enrichPath(r.pathFromA) : undefined,
      pathFromB: r.pathFromB ? enrichPath(r.pathFromB) : undefined,
    }));

    ctx.json(200, {
      found: true,
      samePerson: !!result.samePerson,
      personA: result.samePerson ? undefined : { id: a, ...personBrief(a) },
      personB: result.samePerson ? undefined : { id: b, ...personBrief(b) },
      relations,
      hasMultipleRelations: !!result.hasMultipleRelations,
    });
  });

  router.get('/api/tree/:id', async (req, res, ctx) => {
    const maxGen = Math.min(15, parseInt(ctx.query.get('max_gen') || '4', 10));
    const person = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(ctx.params.id, ctx.user.id);
    if (!person) return ctx.error(404, 'الشخص غير موجود.');

    const ancestors = kinship.getAncestors(db, ctx.user.id, person.id, maxGen);
    const descendants = kinship.getDescendants(db, ctx.user.id, person.id, maxGen);

    const allIds = new Set([person.id, ...ancestors.map((a) => a.id), ...descendants.map((d) => d.id)]);
    const persons = {};
    for (const id of allIds) persons[id] = serializePerson(db.prepare('SELECT * FROM persons WHERE id=?').get(id));

    const placeholders = [...allIds].map(() => '?').join(',');
    const edges = allIds.size
      ? db.prepare(`SELECT * FROM parent_child WHERE owner_id=? AND parent_id IN (${placeholders}) AND child_id IN (${placeholders})`).all(ctx.user.id, ...allIds, ...allIds)
      : [];
    const marriages = allIds.size
      ? db.prepare(`SELECT * FROM marriages WHERE owner_id=? AND spouse_a_id IN (${placeholders}) AND spouse_b_id IN (${placeholders})`).all(ctx.user.id, ...allIds, ...allIds)
      : [];

    ctx.json(200, {
      rootId: person.id,
      persons,
      edges,
      marriages,
      ancestorDistances: Object.fromEntries(ancestors.map((a) => [a.id, a.distance])),
      descendantDistances: Object.fromEntries(descendants.map((d) => [d.id, d.distance])),
    });
  });

  router.post('/api/tree/group', async (req, res, ctx) => {
    const { person_ids, max_gen } = ctx.body;
    if (!Array.isArray(person_ids) || person_ids.length < 2) {
      return ctx.error(400, 'يجب تحديد شخصين على الأقل لإنشاء شجرة المجموعة.');
    }
    const maxGen = max_gen ? Math.min(15, parseInt(max_gen, 10)) : 10;
    const network = kinship.buildGroupNetwork(db, ctx.user.id, person_ids, maxGen);
    const persons = {};
    for (const id of network.nodeIds) {
      const row = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=?').get(id, ctx.user.id);
      if (row) persons[id] = serializePerson(row);
    }
    ctx.json(200, { persons, edges: network.edges, requestedIds: person_ids });
  });
}

module.exports = { register };
