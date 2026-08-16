'use strict';
const db = require('../db');
const { uuid, nowIso, buildFullName, validatePersonInput, ValidationError } = require('../lib/validate');
const { logAction } = require('../lib/audit');
const kinship = require('../lib/kinship-engine');

function serializePerson(row) {
  if (!row) return null;
  return {
    ...row,
    alt_names: row.alt_names ? JSON.parse(row.alt_names) : [],
  };
}

/** يكتشف أشخاصًا محتملين مطابقين بناءً على تشابه الاسم الكامل + تاريخ الميلاد */
function findPossibleDuplicates(ownerId, personData) {
  const fullName = buildFullName(personData);
  if (!fullName) return [];
  const candidates = db
    .prepare(
      `SELECT * FROM persons WHERE owner_id = ? AND deleted_at IS NULL AND
       (full_name = ? OR first_name = ?)`
    )
    .all(ownerId, fullName, personData.first_name);
  return candidates
    .filter((c) => {
      if (personData.birth_date && c.birth_date) {
        return c.birth_date === personData.birth_date;
      }
      return true;
    })
    .map(serializePerson);
}

function register(router) {
  router.get('/api/people', async (req, res, ctx) => {
    const page = Math.max(1, parseInt(ctx.query.get('page') || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(ctx.query.get('page_size') || '50', 10)));
    const offset = (page - 1) * pageSize;
    const total = db
      .prepare('SELECT COUNT(*) c FROM persons WHERE owner_id=? AND deleted_at IS NULL')
      .get(ctx.user.id).c;
    const rows = db
      .prepare(
        `SELECT * FROM persons WHERE owner_id=? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(ctx.user.id, pageSize, offset);
    ctx.json(200, { items: rows.map(serializePerson), total, page, page_size: pageSize });
  });

  router.get('/api/people/search', async (req, res, ctx) => {
    const q = (ctx.query.get('q') || '').trim();
    const limit = Math.min(50, parseInt(ctx.query.get('limit') || '20', 10));
    if (!q) return ctx.json(200, { items: [] });

    // بحث بالـ ID المباشر
    if (/^[0-9a-f-]{10,36}$/i.test(q)) {
      const byId = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(q, ctx.user.id);
      if (byId) return ctx.json(200, { items: [serializePerson(byId)] });
    }

    const like = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT DISTINCT p.* FROM persons p
         LEFT JOIN person_aliases a ON a.person_id = p.id AND a.owner_id = p.owner_id
         WHERE p.owner_id = ? AND p.deleted_at IS NULL AND (
           p.full_name LIKE ? OR p.first_name LIKE ? OR p.family_name LIKE ? OR a.alias LIKE ?
         )
         ORDER BY p.full_name LIMIT ?`
      )
      .all(ctx.user.id, like, like, like, like, limit);
    ctx.json(200, { items: rows.map(serializePerson) });
  });

  router.get('/api/people/:id', async (req, res, ctx) => {
    const row = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(ctx.params.id, ctx.user.id);
    if (!row) return ctx.error(404, 'الشخص غير موجود.');

    const parents = db
      .prepare(
        `SELECT pc.*, p.full_name, p.first_name, p.gender FROM parent_child pc
         JOIN persons p ON p.id = pc.parent_id
         WHERE pc.child_id = ? AND pc.owner_id = ?`
      )
      .all(row.id, ctx.user.id);
    const children = db
      .prepare(
        `SELECT pc.*, p.full_name, p.first_name, p.gender FROM parent_child pc
         JOIN persons p ON p.id = pc.child_id
         WHERE pc.parent_id = ? AND pc.owner_id = ?`
      )
      .all(row.id, ctx.user.id);
    const marriages = db
      .prepare(
        `SELECT m.*, 
          CASE WHEN m.spouse_a_id = ? THEN m.spouse_b_id ELSE m.spouse_a_id END as spouse_id
          FROM marriages m WHERE (m.spouse_a_id = ? OR m.spouse_b_id = ?) AND m.owner_id = ?`
      )
      .all(row.id, row.id, row.id, ctx.user.id);
    for (const m of marriages) {
      const sp = db.prepare('SELECT full_name, first_name, gender FROM persons WHERE id=?').get(m.spouse_id);
      m.spouse_name = sp ? sp.full_name || sp.first_name : null;
    }

    // إخوة: أطفال آخرون لنفس الأب أو الأم
    const parentIds = parents.map((p) => p.parent_id);
    let siblings = [];
    if (parentIds.length) {
      const placeholders = parentIds.map(() => '?').join(',');
      siblings = db
        .prepare(
          `SELECT DISTINCT p.* FROM persons p JOIN parent_child pc ON pc.child_id = p.id
           WHERE pc.parent_id IN (${placeholders}) AND p.id != ? AND pc.owner_id = ? AND p.deleted_at IS NULL`
        )
        .all(...parentIds, row.id, ctx.user.id);
    }

    ctx.json(200, {
      person: serializePerson(row),
      parents,
      children,
      marriages,
      siblings: siblings.map(serializePerson),
    });
  });

  router.post('/api/people', async (req, res, ctx) => {
    let validated;
    try {
      validated = validatePersonInput(ctx.body);
    } catch (e) {
      if (e instanceof ValidationError) return ctx.error(400, e.message);
      throw e;
    }
    const data = validated.data;
    const fullName = buildFullName({ ...data });
    const duplicates = ctx.body.skip_duplicate_check ? [] : findPossibleDuplicates(ctx.user.id, { ...data, first_name: data.first_name });
    if (duplicates.length && !ctx.body.confirm_create_anyway) {
      return ctx.json(200, {
        possible_duplicates: duplicates,
        message: 'وجدنا أشخاصًا مشابهين. يمكنك تأكيد الإنشاء أو دمج البيانات.',
      });
    }

    const id = uuid();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO persons (id, owner_id, first_name, father_name, grandfather_name, family_name, full_name,
        alt_names, gender, birth_date, death_date, life_status, birth_place, death_place, photo_url, notes,
        source, confidence, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      ctx.user.id,
      data.first_name,
      data.father_name || null,
      data.grandfather_name || null,
      data.family_name || null,
      fullName || null,
      data.alt_names || '[]',
      data.gender || 'unknown',
      data.birth_date || null,
      data.death_date || null,
      data.life_status || 'unknown',
      data.birth_place || null,
      data.death_place || null,
      data.photo_url || null,
      data.notes || null,
      data.source || null,
      data.confidence || 'confirmed',
      ts,
      ts
    );
    logAction(ctx.user.id, ctx.user.id, 'create', 'person', id, { name: fullName });
    const row = db.prepare('SELECT * FROM persons WHERE id=?').get(id);
    ctx.json(201, { person: serializePerson(row), warnings: validated.warnings });
  });

  router.patch('/api/people/:id', async (req, res, ctx) => {
    const existing = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(ctx.params.id, ctx.user.id);
    if (!existing) return ctx.error(404, 'الشخص غير موجود.');
    let validated;
    try {
      validated = validatePersonInput(ctx.body, { partial: true });
    } catch (e) {
      if (e instanceof ValidationError) return ctx.error(400, e.message);
      throw e;
    }
    const data = validated.data;
    const merged = { ...existing, ...data };
    const fullName = data.full_name !== undefined ? data.full_name : buildFullName(merged);

    db.prepare(
      `UPDATE persons SET first_name=?, father_name=?, grandfather_name=?, family_name=?, full_name=?,
        alt_names=?, gender=?, birth_date=?, death_date=?, life_status=?, birth_place=?, death_place=?,
        photo_url=?, notes=?, source=?, confidence=?, updated_at=?
       WHERE id=? AND owner_id=?`
    ).run(
      merged.first_name,
      merged.father_name || null,
      merged.grandfather_name || null,
      merged.family_name || null,
      fullName || null,
      merged.alt_names !== undefined ? merged.alt_names : existing.alt_names,
      merged.gender || 'unknown',
      merged.birth_date || null,
      merged.death_date || null,
      merged.life_status || 'unknown',
      merged.birth_place || null,
      merged.death_place || null,
      merged.photo_url || null,
      merged.notes || null,
      merged.source || null,
      merged.confidence || 'confirmed',
      nowIso(),
      ctx.params.id,
      ctx.user.id
    );
    logAction(ctx.user.id, ctx.user.id, 'update', 'person', ctx.params.id, {});
    const row = db.prepare('SELECT * FROM persons WHERE id=?').get(ctx.params.id);
    ctx.json(200, { person: serializePerson(row), warnings: validated.warnings });
  });

  router.get('/api/people/:id/delete-impact', async (req, res, ctx) => {
    const id = ctx.params.id;
    const asParent = db.prepare('SELECT COUNT(*) c FROM parent_child WHERE parent_id=? AND owner_id=?').get(id, ctx.user.id).c;
    const asChild = db.prepare('SELECT COUNT(*) c FROM parent_child WHERE child_id=? AND owner_id=?').get(id, ctx.user.id).c;
    const marriages = db.prepare('SELECT COUNT(*) c FROM marriages WHERE (spouse_a_id=? OR spouse_b_id=?) AND owner_id=?').get(id, id, ctx.user.id).c;
    ctx.json(200, {
      children_affected: asParent,
      parent_links_affected: asChild,
      marriages_affected: marriages,
      warning: asParent > 0 ? 'هذا الشخص أحد الوالدين لأشخاص آخرين. الحذف سيزيل رابط الأبوة عنهم دون حذفهم.' : null,
    });
  });

  router.delete('/api/people/:id', async (req, res, ctx) => {
    const existing = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(ctx.params.id, ctx.user.id);
    if (!existing) return ctx.error(404, 'الشخص غير موجود.');
    // Soft delete فقط — لا نفسد الـ Graph، السجلات التاريخية تبقى محفوظة
    db.prepare('UPDATE persons SET deleted_at=? WHERE id=? AND owner_id=?').run(nowIso(), ctx.params.id, ctx.user.id);
    logAction(ctx.user.id, ctx.user.id, 'delete', 'person', ctx.params.id, {});
    ctx.json(200, { ok: true, message: 'تم حذف الشخص (يمكن استرجاعه من قاعدة البيانات عند الحاجة).' });
  });

  router.post('/api/people/merge', async (req, res, ctx) => {
    const { keep_id, remove_id, fields_from_removed } = ctx.body;
    if (!keep_id || !remove_id || keep_id === remove_id) return ctx.error(400, 'يجب تحديد شخصين مختلفين للدمج.');
    const keep = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=?').get(keep_id, ctx.user.id);
    const remove = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=?').get(remove_id, ctx.user.id);
    if (!keep || !remove) return ctx.error(404, 'أحد الأشخاص غير موجود.');

    if (fields_from_removed && Array.isArray(fields_from_removed)) {
      const allowed = ['first_name', 'father_name', 'grandfather_name', 'family_name', 'full_name', 'birth_date', 'death_date', 'birth_place', 'death_place', 'notes', 'photo_url'];
      const sets = [];
      const vals = [];
      for (const f of fields_from_removed) {
        if (allowed.includes(f)) {
          sets.push(`${f}=?`);
          vals.push(remove[f]);
        }
      }
      if (sets.length) {
        vals.push(nowIso(), keep_id, ctx.user.id);
        db.prepare(`UPDATE persons SET ${sets.join(',')}, updated_at=? WHERE id=? AND owner_id=?`).run(...vals);
      }
    }

    // إعادة توجيه كل العلاقات من remove_id إلى keep_id
    db.prepare('UPDATE parent_child SET parent_id=? WHERE parent_id=? AND owner_id=?').run(keep_id, remove_id, ctx.user.id);
    db.prepare('UPDATE parent_child SET child_id=? WHERE child_id=? AND owner_id=?').run(keep_id, remove_id, ctx.user.id);
    db.prepare('UPDATE marriages SET spouse_a_id=? WHERE spouse_a_id=? AND owner_id=?').run(keep_id, remove_id, ctx.user.id);
    db.prepare('UPDATE marriages SET spouse_b_id=? WHERE spouse_b_id=? AND owner_id=?').run(keep_id, remove_id, ctx.user.id);
    db.prepare('UPDATE persons SET deleted_at=? WHERE id=? AND owner_id=?').run(nowIso(), remove_id, ctx.user.id);

    logAction(ctx.user.id, ctx.user.id, 'merge', 'person', keep_id, { removed: remove_id });
    const row = db.prepare('SELECT * FROM persons WHERE id=?').get(keep_id);
    ctx.json(200, { person: serializePerson(row) });
  });
}

module.exports = { register, serializePerson, findPossibleDuplicates };
