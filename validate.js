'use strict';
const crypto = require('node:crypto');

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/** يبني full_name تلقائيًا من المكونات إن لم يُدخله المستخدم */
function buildFullName(p) {
  if (p.full_name && p.full_name.trim()) return p.full_name.trim();
  return [p.first_name, p.father_name, p.grandfather_name, p.family_name]
    .filter((x) => x && String(x).trim())
    .join(' ');
}

const GENDERS = new Set(['male', 'female', 'unknown']);
const LIFE_STATUSES = new Set(['alive', 'deceased', 'unknown']);
const CONFIDENCE = new Set(['confirmed', 'probable', 'uncertain']);
const RELATION_TYPES = new Set(['biological', 'adoptive', 'step', 'unknown']);
const PARENT_ROLES = new Set(['father', 'mother']);
const MARRIAGE_STATUSES = new Set(['married', 'divorced', 'separated', 'widowed', 'unknown']);

class ValidationError extends Error {
  constructor(messageAr, field) {
    super(messageAr);
    this.field = field;
    this.status = 400;
  }
}

function validatePersonInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || body.first_name !== undefined) {
    if (!body.first_name || !String(body.first_name).trim()) {
      errors.push('الاسم الأول مطلوب.');
    } else {
      out.first_name = String(body.first_name).trim();
    }
  }
  if (body.father_name !== undefined) out.father_name = body.father_name ? String(body.father_name).trim() : null;
  if (body.grandfather_name !== undefined) out.grandfather_name = body.grandfather_name ? String(body.grandfather_name).trim() : null;
  if (body.family_name !== undefined) out.family_name = body.family_name ? String(body.family_name).trim() : null;
  if (body.full_name !== undefined) out.full_name = body.full_name ? String(body.full_name).trim() : null;

  if (body.gender !== undefined) {
    if (!GENDERS.has(body.gender)) errors.push('قيمة الجنس غير صحيحة.');
    else out.gender = body.gender;
  } else if (!partial) {
    out.gender = 'unknown';
  }

  if (body.life_status !== undefined) {
    if (!LIFE_STATUSES.has(body.life_status)) errors.push('قيمة حالة الحياة غير صحيحة.');
    else out.life_status = body.life_status;
  } else if (!partial) {
    out.life_status = 'unknown';
  }

  if (body.confidence !== undefined) {
    if (!CONFIDENCE.has(body.confidence)) errors.push('قيمة مستوى الموثوقية غير صحيحة.');
    else out.confidence = body.confidence;
  }

  for (const f of ['birth_date', 'death_date', 'birth_place', 'death_place', 'photo_url', 'notes', 'source']) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]) : null;
  }

  if (body.alt_names !== undefined) {
    if (!Array.isArray(body.alt_names)) errors.push('الأسماء البديلة يجب أن تكون قائمة.');
    else out.alt_names = JSON.stringify(body.alt_names.map(String));
  }

  // تحقق منطقي بسيط للتواريخ (تحذير لا حظر) — تُرجع كتحذير منفصل
  const warnings = [];
  if (out.birth_date && out.death_date) {
    const b = Date.parse(out.birth_date);
    const d = Date.parse(out.death_date);
    if (!isNaN(b) && !isNaN(d) && d < b) {
      warnings.push('تاريخ الوفاة قبل تاريخ الميلاد — يرجى التحقق من صحة البيانات.');
    }
  }

  if (errors.length) throw new ValidationError(errors.join(' '));
  return { data: out, warnings };
}

module.exports = {
  uuid,
  nowIso,
  buildFullName,
  ValidationError,
  validatePersonInput,
  GENDERS,
  LIFE_STATUSES,
  CONFIDENCE,
  RELATION_TYPES,
  PARENT_ROLES,
  MARRIAGE_STATUSES,
};
