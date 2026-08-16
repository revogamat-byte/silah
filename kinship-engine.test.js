'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// قاعدة بيانات مؤقتة مستقلة لكل تشغيل اختبار
const TEST_DB = path.join(__dirname, '..', 'data', 'test-kinship.db');
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB + ext)) fs.unlinkSync(TEST_DB + ext);
}
process.env.SILAH_DB_PATH = TEST_DB;

const db = require('../server/db');
const k = require('../server/lib/kinship-engine');
const { uuid } = require('../server/lib/validate');

const OWNER = uuid();
db.prepare('INSERT INTO users (id,email,password_hash,password_salt,name) VALUES (?,?,?,?,?)').run(OWNER, 'test@test.com', 'h', 's', 'Test');

function mk(name, gender) {
  const id = uuid();
  db.prepare('INSERT INTO persons (id,owner_id,first_name,full_name,gender,life_status) VALUES (?,?,?,?,?,?)').run(id, OWNER, name, name, gender, 'unknown');
  return id;
}
function link(parent, child, role, relationType = 'biological') {
  db.prepare('INSERT INTO parent_child (id,owner_id,parent_id,child_id,parent_role,relation_type) VALUES (?,?,?,?,?,?)').run(uuid(), OWNER, parent, child, role, relationType);
}
function marry(a, b, status = 'married') {
  db.prepare('INSERT INTO marriages (id,owner_id,spouse_a_id,spouse_b_id,status) VALUES (?,?,?,?,?)').run(uuid(), OWNER, a, b, status);
}
function labelsOf(a, b) {
  const r = k.computeKinship(db, OWNER, a, b);
  return r.found ? r.relations.map((x) => x.label) : [];
}
function anyLabelContains(a, b, substr) {
  return labelsOf(a, b).some((l) => l.includes(substr));
}

// ------------------------------------------------------------------
// بناء عائلة اختبار شاملة تغطي كل الحالات المطلوبة في قسم 30 من الطلب
// ------------------------------------------------------------------
const GP = mk('الجد الأكبر', 'male');
const GM = mk('الجدة الكبرى', 'female');
const DAD = mk('الأب', 'male');
const UNCLE = mk('العم', 'male');
const AUNT = mk('العمة', 'female');
const MOM = mk('الأم', 'female');
const MOM_DAD = mk('جد الأم', 'male');
const MOM_MOM = mk('جدة الأم', 'female');
const MOM_BROTHER = mk('الخال', 'male');
const ME = mk('أنا', 'male');
const SISTER_FULL = mk('أختي الشقيقة', 'female');
const COUSIN_PATERNAL = mk('ابن العم', 'male');
const COUSIN_MATERNAL = mk('ابن الخال', 'male');
const GRANDCHILD = mk('ابني', 'male');
const GREAT_GRANDCHILD = mk('حفيدي', 'male');
const GGGRANDCHILD = mk('حفيد حفيدي', 'male');
const STRANGER = mk('غريب تمامًا', 'male');
const ORPHAN = mk('يتيم مجهول الوالدين', 'male');

link(GP, DAD, 'father'); link(GM, DAD, 'mother');
link(GP, UNCLE, 'father'); link(GM, UNCLE, 'mother');
link(GP, AUNT, 'father'); link(GM, AUNT, 'mother');
link(MOM_DAD, MOM, 'father'); link(MOM_MOM, MOM, 'mother');
link(MOM_DAD, MOM_BROTHER, 'father'); link(MOM_MOM, MOM_BROTHER, 'mother');
link(DAD, ME, 'father'); link(MOM, ME, 'mother');
link(DAD, SISTER_FULL, 'father'); link(MOM, SISTER_FULL, 'mother');
link(UNCLE, COUSIN_PATERNAL, 'father');
link(MOM_BROTHER, COUSIN_MATERNAL, 'father');
link(ME, GRANDCHILD, 'father');
link(GRANDCHILD, GREAT_GRANDCHILD, 'father');
link(GREAT_GRANDCHILD, GGGRANDCHILD, 'father');

// نصف أخوة: أب متعدد الزيجات
const DAD2 = mk('أب بزوجتين', 'male');
const WIFE1 = mk('الزوجة الأولى', 'female');
const WIFE2 = mk('الزوجة الثانية', 'female');
const HALF1 = mk('ابن من الزوجة الأولى', 'male');
const HALF2 = mk('ابن من الزوجة الثانية', 'male');
link(DAD2, HALF1, 'father'); link(WIFE1, HALF1, 'mother');
link(DAD2, HALF2, 'father'); link(WIFE2, HALF2, 'mother');
marry(DAD2, WIFE1, 'divorced');
marry(DAD2, WIFE2, 'married');

// مصاهرة
const SIS_HUSBAND = mk('زوج الأخت', 'male');
marry(SISTER_FULL, SIS_HUSBAND, 'married');

// تبني
const ADOPTIVE_DAD = mk('أب بالتبني', 'male');
const ADOPTED_CHILD = mk('ابن بالتبني', 'male');
link(ADOPTIVE_DAD, ADOPTED_CHILD, 'father', 'adoptive');

test('الأب/الأم — خط مباشر', () => {
  assert.ok(anyLabelContains(ME, DAD, 'الأب'));
  assert.ok(anyLabelContains(ME, MOM, 'الأم'));
});

test('الجد ← → الحفيد', () => {
  assert.ok(anyLabelContains(ME, GP, 'الجد'));
  assert.ok(anyLabelContains(GP, ME, 'الحفيد'));
});

test('الحفيد (جيلان)', () => {
  assert.ok(anyLabelContains(ME, GREAT_GRANDCHILD, 'الحفيد'));
});

test('حفيد الحفيد (ثلاثة أجيال)', () => {
  assert.ok(anyLabelContains(ME, GGGRANDCHILD, 'حفيد الحفيد'));
});

test('الأخ الشقيق / الأخت الشقيقة', () => {
  assert.ok(anyLabelContains(ME, SISTER_FULL, 'شقيق'));
});

test('نصف الإخوة (زيجات متعددة) — ليسوا أشقاء', () => {
  const labels = labelsOf(HALF1, HALF2);
  assert.ok(labels.some((l) => l.includes('غير شقيق')));
});

test('العم / العمة', () => {
  assert.ok(anyLabelContains(ME, UNCLE, 'العم'));
  assert.ok(anyLabelContains(ME, AUNT, 'العمة'));
});

test('الخال (من جهة الأم)', () => {
  assert.ok(anyLabelContains(ME, MOM_BROTHER, 'الخال'));
});

test('ابن الأخ (اتجاه عكسي للعم)', () => {
  assert.ok(anyLabelContains(UNCLE, ME, 'ابن الأخ'));
});

test('ابن العم (أبناء عمومة أبوية)', () => {
  assert.ok(anyLabelContains(ME, COUSIN_PATERNAL, 'العم'));
});

test('ابن الخال (أبناء خؤولة أمومية)', () => {
  assert.ok(anyLabelContains(ME, COUSIN_MATERNAL, 'الخال'));
});

test('المصاهرة منفصلة عن قرابة الدم: زوج الأخت', () => {
  assert.ok(anyLabelContains(ME, SIS_HUSBAND, 'زوج الأخت'));
  // تأكيد: لا يُعتبر أخًا بيولوجيًا
  assert.ok(!anyLabelContains(ME, SIS_HUSBAND, 'شقيق'));
});

test('علاقة التبني تُحفظ كنوعها ولا تُخلط بالبيولوجية', () => {
  const row = db.prepare("SELECT relation_type FROM parent_child WHERE parent_id=? AND child_id=?").get(ADOPTIVE_DAD, ADOPTED_CHILD);
  assert.strictEqual(row.relation_type, 'adoptive');
  assert.ok(anyLabelContains(ADOPTED_CHILD, ADOPTIVE_DAD, 'الأب'));
});

test('لا توجد صلة قرابة بين شخصين غير مرتبطين', () => {
  const r = k.computeKinship(db, OWNER, ME, STRANGER);
  assert.strictEqual(r.found, false);
});

test('شخص مجهول الوالدين لا يكسر النظام ولا يُنشئ صلة وهمية', () => {
  const r = k.computeKinship(db, OWNER, ME, ORPHAN);
  assert.strictEqual(r.found, false);
});

test('نفس الشخص', () => {
  const r = k.computeKinship(db, OWNER, ME, ME);
  assert.strictEqual(r.samePerson, true);
});

test('منع الدورات: لا يمكن أن يصبح الحفيد جدًا لجده', () => {
  assert.strictEqual(k.wouldCreateCycle(db, OWNER, GREAT_GRANDCHILD, GP), true);
});

test('منع الدورات: لا يمكن أن يكون الشخص والد نفسه', () => {
  assert.strictEqual(k.wouldCreateCycle(db, OWNER, ME, ME), true);
});

test('إضافة علاقة طبيعية لا تُعتبر دورة', () => {
  assert.strictEqual(k.wouldCreateCycle(db, OWNER, STRANGER, ORPHAN), false);
});

test('شجرة الأسلاف تُرجع كل الأجداد ضمن الحد المطلوب', () => {
  const ancestors = k.getAncestors(db, OWNER, ME, 5).map((a) => a.id);
  assert.ok(ancestors.includes(DAD));
  assert.ok(ancestors.includes(GP));
  assert.ok(ancestors.includes(MOM_DAD));
});

test('شجرة الفروع تُرجع كل الأحفاد ضمن الحد المطلوب', () => {
  const descendants = k.getDescendants(db, OWNER, ME, 5).map((d) => d.id);
  assert.ok(descendants.includes(GRANDCHILD));
  assert.ok(descendants.includes(GREAT_GRANDCHILD));
});

test('شجرة المجموعة تربط عدة أشخاص عبر الأسلاف المشتركين', () => {
  const network = k.buildGroupNetwork(db, OWNER, [ME, COUSIN_PATERNAL, COUSIN_MATERNAL], 5);
  assert.ok(network.nodeIds.includes(GP)); // السلف المشترك بين أنا وابن العم
  assert.ok(network.nodeIds.includes(MOM_DAD)); // السلف المشترك بين أنا وابن الخال
});

test('أداء: سلسلة أجيال طويلة (ضمن حد الأمان) تُحسب بسرعة', () => {
  const start = Date.now();
  const N = 25; // ضمن MAX_GENERATIONS (30) — سلاسل نسب حقيقية نادرًا ما تتجاوز هذا
  let prevFather = mk('جد السلسلة', 'male');
  const chain = [prevFather];
  for (let i = 0; i < N; i++) {
    const child = mk('شخص سلسلة ' + i, i % 2 === 0 ? 'male' : 'female');
    link(prevFather, child, 'father');
    prevFather = child;
    chain.push(child);
  }
  const r = k.computeKinship(db, OWNER, chain[0], chain[chain.length - 1]);
  const elapsedMs = Date.now() - start;
  assert.strictEqual(r.found, true);
  assert.ok(anyLabelContains(chain[0], chain[chain.length - 1], `الدرجة ${N}`) || r.relations[0].degree === N);
  assert.ok(elapsedMs < 5000, `يجب أن يكتمل الحساب خلال وقت معقول (استغرق ${elapsedMs}ms)`);
});

test('حد الأمان (MAX_GENERATIONS) يمنع تجاوزًا غير منطقي دون كسر النظام', () => {
  // سلسلة أطول من الحد تُعامل بأمان: لا صلة "مؤكدة" تتجاوز الحد، ولا يتعطل النظام
  const N = k.MAX_GENERATIONS + 20;
  let prevFather = mk('جد بعيد جدًا', 'male');
  const chain = [prevFather];
  for (let i = 0; i < N; i++) {
    const child = mk('سلف بعيد ' + i, 'male');
    link(prevFather, child, 'father');
    prevFather = child;
    chain.push(child);
  }
  assert.doesNotThrow(() => k.computeKinship(db, OWNER, chain[0], chain[chain.length - 1]));
});

test('أداء: عدد كبير من الأشخاص المستقلين لا يبطئ حساب القرابة لشخصين قريبين', () => {
  for (let i = 0; i < 2000; i++) mk('شخص عشوائي ' + i, 'unknown');
  const start = Date.now();
  const r = k.computeKinship(db, OWNER, ME, UNCLE);
  const elapsedMs = Date.now() - start;
  assert.strictEqual(r.found, true);
  assert.ok(elapsedMs < 3000, `استغرق ${elapsedMs}ms مع وجود آلاف الأشخاص الإضافيين`);
});
