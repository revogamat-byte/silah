'use strict';
const db = require('../db');
const { parseCsv, stringifyCsv } = require('../lib/csv');
const { uuid, nowIso, buildFullName, GENDERS, LIFE_STATUSES } = require('../lib/validate');
const { logAction } = require('../lib/audit');
const { serializePerson } = require('./people');

const PERSON_COLUMNS = [
  'local_id', 'first_name', 'father_name', 'grandfather_name', 'family_name', 'full_name',
  'gender', 'birth_date', 'death_date', 'life_status', 'birth_place', 'death_place',
  'notes', 'source', 'father_local_id', 'mother_local_id',
];

function normalizeRecords(body) {
  if (body.format === 'csv') {
    return parseCsv(body.content || '');
  }
  if (Array.isArray(body.persons)) return body.persons;
  throw new Error('لا توجد بيانات صالحة للاستيراد.');
}

function validateRecords(records) {
  const errors = [];
  const seenLocalIds = new Set();
  records.forEach((r, idx) => {
    const line = idx + 2; // +2: حساب سطر العنوان في CSV
    if (!r.first_name || !String(r.first_name).trim()) {
      errors.push({ line, error: 'الاسم الأول مطلوب.' });
    }
    if (r.gender && !GENDERS.has(r.gender)) {
      errors.push({ line, error: `قيمة الجنس غير صحيحة: ${r.gender}` });
    }
    if (r.life_status && !LIFE_STATUSES.has(r.life_status)) {
      errors.push({ line, error: `قيمة حالة الحياة غير صحيحة: ${r.life_status}` });
    }
    if (r.local_id) {
      if (seenLocalIds.has(r.local_id)) errors.push({ line, error: `معرف محلي مكرر: ${r.local_id}` });
      seenLocalIds.add(r.local_id);
    }
    if (r.birth_date && r.death_date) {
      const b = Date.parse(r.birth_date);
      const d = Date.parse(r.death_date);
      if (!isNaN(b) && !isNaN(d) && d < b) {
        errors.push({ line, error: 'تاريخ الوفاة قبل تاريخ الميلاد.' });
      }
    }
  });
  return errors;
}

function register(router) {
  router.post('/api/import/preview', async (req, res, ctx) => {
    let records;
    try {
      records = normalizeRecords(ctx.body);
    } catch (e) {
      return ctx.error(400, e.message);
    }
    const errors = validateRecords(records);

    // فحص التكرار مقابل القاعدة الحالية
    const existing = db.prepare('SELECT id, full_name, first_name, birth_date FROM persons WHERE owner_id=? AND deleted_at IS NULL').all(ctx.user.id);
    const duplicates = [];
    records.forEach((r, idx) => {
      const fullName = buildFullName(r);
      const match = existing.find((e) => (e.full_name === fullName || e.first_name === r.first_name) && (!r.birth_date || e.birth_date === r.birth_date));
      if (match) duplicates.push({ line: idx + 2, record_name: fullName, matched_existing_id: match.id, matched_existing_name: match.full_name });
    });

    ctx.json(200, {
      total_records: records.length,
      valid_records: records.length - new Set(errors.map((e) => e.line)).size,
      errors,
      possible_duplicates: duplicates,
      can_import: errors.length === 0,
      sample: records.slice(0, 10),
    });
  });

  router.post('/api/import/commit', async (req, res, ctx) => {
    let records;
    try {
      records = normalizeRecords(ctx.body);
    } catch (e) {
      return ctx.error(400, e.message);
    }
    const errors = validateRecords(records);
    if (errors.length) {
      return ctx.json(400, { ok: false, errors, message: 'تم رفض الاستيراد بالكامل بسبب أخطاء في البيانات. لم يتم تعديل قاعدة البيانات.' });
    }

    const localIdToRealId = new Map();
    const ownerId = ctx.user.id;

    try {
      db.exec('BEGIN');

      // الممر الأول: إنشاء كل الأشخاص
      const insertStmt = db.prepare(
        `INSERT INTO persons (id, owner_id, first_name, father_name, grandfather_name, family_name, full_name,
          alt_names, gender, birth_date, death_date, life_status, birth_place, death_place, notes, source,
          confidence, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      for (const r of records) {
        const id = uuid();
        const fullName = r.full_name || buildFullName(r);
        const ts = nowIso();
        insertStmt.run(
          id, ownerId, r.first_name, r.father_name || null, r.grandfather_name || null, r.family_name || null,
          fullName || null, '[]', r.gender && GENDERS.has(r.gender) ? r.gender : 'unknown',
          r.birth_date || null, r.death_date || null, r.life_status && LIFE_STATUSES.has(r.life_status) ? r.life_status : 'unknown',
          r.birth_place || null, r.death_place || null, r.notes || null, r.source || 'استيراد',
          'confirmed', ts, ts
        );
        if (r.local_id) localIdToRealId.set(String(r.local_id), id);
      }

      // الممر الثاني: ربط الوالدين بعد إنشاء الجميع (لدعم الإشارة إلى local_id لأشخاص لاحقين في الملف)
      const pcStmt = db.prepare(
        `INSERT OR IGNORE INTO parent_child (id, owner_id, parent_id, child_id, parent_role, relation_type, created_at)
         VALUES (?,?,?,?,?,?,?)`
      );
      records.forEach((r) => {
        const childId = localIdToRealId.get(String(r.local_id));
        if (!childId) return;
        if (r.father_local_id && localIdToRealId.has(String(r.father_local_id))) {
          pcStmt.run(uuid(), ownerId, localIdToRealId.get(String(r.father_local_id)), childId, 'father', 'biological', nowIso());
        }
        if (r.mother_local_id && localIdToRealId.has(String(r.mother_local_id))) {
          pcStmt.run(uuid(), ownerId, localIdToRealId.get(String(r.mother_local_id)), childId, 'mother', 'biological', nowIso());
        }
      });

      db.exec('COMMIT');
      logAction(ownerId, ownerId, 'import', 'person', null, { count: records.length });
      ctx.json(200, { ok: true, imported: records.length });
    } catch (e) {
      db.exec('ROLLBACK');
      ctx.error(500, 'فشل الاستيراد. تم التراجع عن جميع التغييرات ولم تتأثر قاعدة البيانات. السبب: ' + e.message);
    }
  });

  router.get('/api/export', async (req, res, ctx) => {
    const format = ctx.query.get('format') === 'csv' ? 'csv' : 'json';
    const ownerId = ctx.user.id;
    const persons = db.prepare('SELECT * FROM persons WHERE owner_id=? AND deleted_at IS NULL').all(ownerId).map(serializePerson);
    const relationships = db.prepare('SELECT * FROM parent_child WHERE owner_id=?').all(ownerId);
    const marriages = db.prepare('SELECT * FROM marriages WHERE owner_id=?').all(ownerId);

    if (format === 'json') {
      ctx.json(200, { exported_at: nowIso(), persons, relationships, marriages });
      return;
    }
    const csv = stringifyCsv(
      persons.map((p) => ({ ...p, local_id: p.id })),
      ['local_id', 'first_name', 'father_name', 'grandfather_name', 'family_name', 'full_name', 'gender', 'birth_date', 'death_date', 'life_status', 'birth_place', 'death_place', 'notes', 'source']
    );
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="silah-export.csv"',
    });
    res.end('\uFEFF' + csv); // BOM لدعم صحيح للعربية في Excel
  });
}

module.exports = { register };
