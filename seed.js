'use strict';
/**
 * seed.js — يُنشئ مستخدمًا تجريبيًا وعائلة كبيرة متعددة الأجيال تغطي:
 * إخوة، أخوات، أعمام، عمات، أخوال، خالات، أبناء عم، أبناء خال، زيجات متعددة،
 * طلاق، وفاة، أبناء من زيجات مختلفة، أشخاص مجهولي الأب/الأم، وأكثر من علاقة قرابة.
 *
 * الاستخدام: npm run seed   (أو node seed/seed.js)
 *           npm run seed:reset  لحذف قاعدة البيانات الحالية وإعادة الإنشاء من الصفر
 */
const path = require('node:path');
const fs = require('node:fs');

if (process.argv.includes('--reset')) {
  const dbPath = path.join(__dirname, '..', 'data', 'silah.db');
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext);
  }
  console.log('تم حذف قاعدة البيانات السابقة.');
}

const db = require('../server/db');
const { hashPassword } = require('../server/lib/auth');
const { uuid, buildFullName } = require('../server/lib/validate');

const SEED_EMAIL = 'demo@silah.app';
const SEED_PASSWORD = 'Demo@12345';

let OWNER_ID = db.prepare('SELECT id FROM users WHERE email=?').get(SEED_EMAIL)?.id;
if (!OWNER_ID) {
  const { hash, salt } = hashPassword(SEED_PASSWORD);
  OWNER_ID = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, password_salt, name) VALUES (?,?,?,?,?)').run(
    OWNER_ID, SEED_EMAIL, hash, salt, 'مستخدم تجريبي'
  );
  console.log('تم إنشاء مستخدم تجريبي:', SEED_EMAIL, '/ كلمة المرور:', SEED_PASSWORD);
} else {
  console.log('المستخدم التجريبي موجود بالفعل. سيتم إضافة بيانات جديدة إلى حسابه.');
}

function mk(fields) {
  const id = uuid();
  const full = buildFullName(fields);
  db.prepare(
    `INSERT INTO persons (id, owner_id, first_name, father_name, grandfather_name, family_name, full_name,
      alt_names, gender, birth_date, death_date, life_status, birth_place, notes, source, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, OWNER_ID, fields.first_name, fields.father_name || null, fields.grandfather_name || null,
    fields.family_name || null, full, '[]', fields.gender || 'unknown', fields.birth_date || null,
    fields.death_date || null, fields.life_status || 'unknown', fields.birth_place || null,
    fields.notes || null, 'بيانات تجريبية (seed)', 'confirmed'
  );
  return id;
}
function link(parentId, childId, role, relationType = 'biological') {
  db.prepare(
    `INSERT OR IGNORE INTO parent_child (id, owner_id, parent_id, child_id, parent_role, relation_type)
     VALUES (?,?,?,?,?,?)`
  ).run(uuid(), OWNER_ID, parentId, childId, role, relationType);
}
function marry(a, b, status, startDate, endDate) {
  db.prepare(
    `INSERT INTO marriages (id, owner_id, spouse_a_id, spouse_b_id, status, start_date, end_date)
     VALUES (?,?,?,?,?,?,?)`
  ).run(uuid(), OWNER_ID, a, b, status, startDate || null, endDate || null);
}

const FAMILY = 'العائلة الكريمة';

// الجيل الأول: الجدود المؤسسون
const jaddAkbar = mk({ first_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1935-03-01', life_status: 'deceased', death_date: '2010-05-12', birth_place: 'دمشق' });
const jaddaAkbar = mk({ first_name: 'فاطمة', family_name: FAMILY, gender: 'female', birth_date: '1938-07-19', life_status: 'deceased', death_date: '2015-01-03', birth_place: 'دمشق' });
marry(jaddAkbar, jaddaAkbar, 'widowed', '1955-06-01', '2010-05-12');

// أبناء الجد الأكبر (الجيل الثاني): 3 أبناء + بنتان
const dad = mk({ first_name: 'محمود', father_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1958-02-10', life_status: 'alive', birth_place: 'دمشق' });
const uncle1 = mk({ first_name: 'خالد', father_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1960-11-23', life_status: 'alive' });
const uncle2 = mk({ first_name: 'ياسر', father_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1963-04-17', life_status: 'deceased', death_date: '2020-09-01' });
const aunt1 = mk({ first_name: 'سميرة', father_name: 'سالم', family_name: FAMILY, gender: 'female', birth_date: '1965-08-30', life_status: 'alive' });
const aunt2 = mk({ first_name: 'ليلى', father_name: 'سالم', family_name: FAMILY, gender: 'female', birth_date: '1967-01-05', life_status: 'alive' });
for (const child of [dad, uncle1, uncle2, aunt1, aunt2]) {
  link(jaddAkbar, child, 'father');
  link(jaddaAkbar, child, 'mother');
}

// عائلة الأم (جدود من جهة الأم)
const momGrandpa = mk({ first_name: 'عبد الرحمن', family_name: 'بيت الشامي', gender: 'male', birth_date: '1932-01-01', life_status: 'deceased', death_date: '2005-03-03' });
const momGrandma = mk({ first_name: 'زينب', family_name: 'بيت الشامي', gender: 'female', birth_date: '1936-06-06', life_status: 'deceased', death_date: '2012-12-12' });
marry(momGrandpa, momGrandma, 'widowed', '1954-01-01', '2005-03-03');
const mom = mk({ first_name: 'هيام', father_name: 'عبد الرحمن', family_name: 'بيت الشامي', gender: 'female', birth_date: '1961-09-09', life_status: 'alive' });
const momBrother = mk({ first_name: 'ماجد', father_name: 'عبد الرحمن', family_name: 'بيت الشامي', gender: 'male', birth_date: '1959-05-05', life_status: 'alive' });
const momSister = mk({ first_name: 'رنا', father_name: 'عبد الرحمن', family_name: 'بيت الشامي', gender: 'female', birth_date: '1964-10-10', life_status: 'alive' });
for (const child of [mom, momBrother, momSister]) {
  link(momGrandpa, child, 'father');
  link(momGrandma, child, 'mother');
}

// زواج الأب والأم
marry(dad, mom, 'married', '1985-06-15');

// الجيل الثالث: أنا وإخوتي الأشقاء
const me = mk({ first_name: 'عمر', father_name: 'محمود', grandfather_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1988-03-20', life_status: 'alive' });
const sisterFull = mk({ first_name: 'نور', father_name: 'محمود', grandfather_name: 'سالم', family_name: FAMILY, gender: 'female', birth_date: '1990-07-11', life_status: 'alive' });
link(dad, me, 'father'); link(mom, me, 'mother');
link(dad, sisterFull, 'father'); link(mom, sisterFull, 'mother');

// زواج متعدد للأب: طلاق ثم زواج ثانٍ، أبناء من كل زواج
const dad2 = mk({ first_name: 'رياض', family_name: 'بيت الحلبي', gender: 'male', birth_date: '1955-01-01', life_status: 'alive' });
const wife1 = mk({ first_name: 'عبير', family_name: 'بيت الحلبي', gender: 'female', birth_date: '1958-01-01', life_status: 'alive' });
const wife2 = mk({ first_name: 'دلال', family_name: 'بيت الحلبي', gender: 'female', birth_date: '1970-01-01', life_status: 'alive' });
marry(dad2, wife1, 'divorced', '1980-01-01', '1995-01-01');
marry(dad2, wife2, 'married', '1996-01-01');
const halfBrother1 = mk({ first_name: 'باسل', father_name: 'رياض', family_name: 'بيت الحلبي', gender: 'male', birth_date: '1985-01-01', life_status: 'alive' });
const halfBrother2 = mk({ first_name: 'كريم', father_name: 'رياض', family_name: 'بيت الحلبي', gender: 'male', birth_date: '1998-01-01', life_status: 'alive' });
link(dad2, halfBrother1, 'father'); link(wife1, halfBrother1, 'mother');
link(dad2, halfBrother2, 'father'); link(wife2, halfBrother2, 'mother');

// أبناء العم (من عم1) وأبناء العمة (من عمة1) وأبناء الخال (من خال الأم)
const cousinPaternalM = mk({ first_name: 'طارق', father_name: 'خالد', grandfather_name: 'سالم', family_name: FAMILY, gender: 'male', birth_date: '1991-01-01', life_status: 'alive' });
link(uncle1, cousinPaternalM, 'father');
const cousinPaternalF = mk({ first_name: 'هدى', father_name: 'ياسر', grandfather_name: 'سالم', family_name: FAMILY, gender: 'female', birth_date: '1993-01-01', life_status: 'alive' });
link(uncle2, cousinPaternalF, 'father');
const cousinFromAunt = mk({ first_name: 'وائل', father_name: 'غير مسجل', family_name: 'بيت أخرى', gender: 'male', birth_date: '1992-01-01', life_status: 'alive' });
link(aunt1, cousinFromAunt, 'mother');
const cousinMaternal = mk({ first_name: 'سامر', father_name: 'ماجد', family_name: 'بيت الشامي', gender: 'male', birth_date: '1994-01-01', life_status: 'alive' });
link(momBrother, cousinMaternal, 'father');

// زوج الأخت (مصاهرة) وأبناؤهما
const sisterHusband = mk({ first_name: 'فادي', family_name: 'بيت مختلف', gender: 'male', birth_date: '1987-01-01', life_status: 'alive' });
marry(sisterFull, sisterHusband, 'married', '2015-05-05');
const nieceFromSister = mk({ first_name: 'ملك', father_name: 'فادي', gender: 'female', birth_date: '2017-01-01', life_status: 'alive' });
link(sisterHusband, nieceFromSister, 'father');
link(sisterFull, nieceFromSister, 'mother');

// زوجتي وأبنائي (لاختبار الحفيد/الحفيدة من منظور الجد)
const myWife = mk({ first_name: 'ريما', family_name: 'بيت آخر', gender: 'female', birth_date: '1990-01-01', life_status: 'alive' });
marry(me, myWife, 'married', '2012-06-01');
const mySon = mk({ first_name: 'يوسف', father_name: 'عمر', grandfather_name: 'محمود', family_name: FAMILY, gender: 'male', birth_date: '2013-09-01', life_status: 'alive' });
const myDaughter = mk({ first_name: 'لين', father_name: 'عمر', grandfather_name: 'محمود', family_name: FAMILY, gender: 'female', birth_date: '2016-02-14', life_status: 'alive' });
link(me, mySon, 'father'); link(myWife, mySon, 'mother');
link(me, myDaughter, 'father'); link(myWife, myDaughter, 'mother');

// شخص مجهول الأب والأم بالكامل (يجب ألا يمنع النظام إنشاءه)
mk({ first_name: 'مجهول', notes: 'شخص لا تُعرف أصوله — تم إدخاله كسجل مستقل بلا والدين.', gender: 'unknown', life_status: 'unknown' });

// حالة تبني: أب بالتبني وابن متبنى — يُحفظ نوع العلاقة منفصلاً عن البيولوجي
const adoptiveDad = mk({ first_name: 'سعيد', family_name: 'بيت الكرم', gender: 'male', birth_date: '1970-01-01', life_status: 'alive' });
const adoptedChild = mk({ first_name: 'آدم', family_name: 'بيت الكرم', gender: 'male', birth_date: '2010-01-01', life_status: 'alive', notes: 'ابن بالتبني — العلاقة مسجلة كـ adoptive وليست بيولوجية.' });
link(adoptiveDad, adoptedChild, 'father', 'adoptive');

// زواج أقارب حقيقي: عمر (ابن العم) يتزوج من هدى (ابنة عم أخرى) — علاقة قرابة إضافية للمثال (اختياري، معطّل افتراضيًا لتفادي تعقيد بيانات العرض)
// (تُركت كتعليق لتوضيح أن النظام يدعمها دون كسر البيانات إن أراد المستخدم إضافتها لاحقًا)

console.log('---------------------------------------------------');
console.log('اكتمل إدخال البيانات التجريبية بنجاح.');
console.log('تسجيل الدخول: ', SEED_EMAIL, '/', SEED_PASSWORD);
console.log('عدد الأشخاص المضافون في هذا التشغيل ضمن حساب المستخدم التجريبي.');
console.log('---------------------------------------------------');

module.exports = {
  OWNER_ID, me, dad, mom, sisterFull, uncle1, uncle2, aunt1, aunt2, momBrother, momSister,
  cousinPaternalM, cousinPaternalF, cousinMaternal, cousinFromAunt, sisterHusband,
  halfBrother1, halfBrother2, jaddAkbar, jaddaAkbar, momGrandpa, momGrandma,
  mySon, myDaughter, adoptiveDad, adoptedChild,
};
