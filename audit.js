'use strict';
const db = require('../db');
const { uuid, nowIso } = require('./validate');

function logAction(ownerId, actorUserId, action, entityType, entityId, details) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, owner_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), ownerId, actorUserId, action, entityType, entityId || null, details ? JSON.stringify(details) : null, nowIso());
  } catch (e) {
    // التدقيق لا يجب أن يوقف العملية الأساسية أبدًا
    console.error('audit log failed', e);
  }
}

module.exports = { logAction };
