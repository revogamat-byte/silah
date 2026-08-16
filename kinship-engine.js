'use strict';
/**
 * kinship-engine.js
 * ------------------
 * محرك حساب صلات القرابة. يعتمد بالكامل على Graph Traversal (BFS) وإيجاد
 * أقرب سلف مشترك (LCA). لا يستخدم أي ذكاء اصطناعي، ولا سلاسل if محدودة
 * لعدد ثابت من الحالات — الخوارزمية عامة (generic) وتعمل لأي درجة قرابة.
 *
 * مصدر الحقيقة الوحيد: جدولا persons و parent_child و marriages.
 * كل نتيجة قابلة للتتبع عبر المسار (path) الذي يعيده المحرك.
 */

const MAX_GENERATIONS = 30; // حد أمان لمنع الدوران اللانهائي، وليس قيدًا هندسيًا فعليًا

/**
 * يبني خرائط قرابة في الذاكرة لمستخدم واحد فقط (owner_id) من قاعدة البيانات.
 * هذا يُحمَّل مرة واحدة لكل عملية حساب، وليس Graph كامل يُرسل للمتصفح.
 */
function buildGraph(db, ownerId) {
  const parentRows = db
    .prepare(
      `SELECT id, parent_id, child_id, parent_role, relation_type
       FROM parent_child WHERE owner_id = ?`
    )
    .all(ownerId);

  const marriageRows = db
    .prepare(
      `SELECT id, spouse_a_id, spouse_b_id, status FROM marriages WHERE owner_id = ?`
    )
    .all(ownerId);

  // parentsOf[childId] = [{ personId, role, relationType }]
  const parentsOf = new Map();
  // childrenOf[parentId] = [{ personId, role, relationType, coParentId }]
  const childrenOf = new Map();
  // spousesOf[personId] = [{ personId, status, marriageId }]
  const spousesOf = new Map();

  for (const r of parentRows) {
    if (!parentsOf.has(r.child_id)) parentsOf.set(r.child_id, []);
    parentsOf.get(r.child_id).push({
      personId: r.parent_id,
      role: r.parent_role,
      relationType: r.relation_type,
    });

    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push({
      personId: r.child_id,
      role: r.parent_role,
      relationType: r.relation_type,
    });
  }

  for (const m of marriageRows) {
    if (!spousesOf.has(m.spouse_a_id)) spousesOf.set(m.spouse_a_id, []);
    if (!spousesOf.has(m.spouse_b_id)) spousesOf.set(m.spouse_b_id, []);
    spousesOf.get(m.spouse_a_id).push({ personId: m.spouse_b_id, status: m.status, marriageId: m.id });
    spousesOf.get(m.spouse_b_id).push({ personId: m.spouse_a_id, status: m.status, marriageId: m.id });
  }

  return { parentsOf, childrenOf, spousesOf };
}

/**
 * BFS صاعد من شخص إلى كل أسلافه، مع الاحتفاظ بكامل المسار (وليس فقط المسافة)
 * حتى نستطيع لاحقًا معرفة جنس القرابة (أب/أم) ونوع العلاقة (بيولوجي/تبني) في كل خطوة.
 * يعيد Map: ancestorId -> [ { distance, path: [ {personId, role, relationType} ... ] } ]
 * (قد يكون هناك أكثر من مسار لنفس السلف عند وجود زواج أقارب — لذلك القيمة مصفوفة).
 */
function findAncestorsWithPaths(graph, startId) {
  const results = new Map(); // ancestorId -> array of paths
  const queue = [{ personId: startId, distance: 0, path: [] }];
  const visitedAtDistance = new Map(); // to avoid unbounded blow-up: cap paths per node

  while (queue.length) {
    const current = queue.shift();
    if (current.distance > MAX_GENERATIONS) continue;

    if (current.distance > 0) {
      if (!results.has(current.personId)) results.set(current.personId, []);
      const existing = results.get(current.personId);
      // احتفظ بحد أقصى معقول من المسارات لكل سلف لمنع الانفجار التوافقي
      if (existing.length < 6) existing.push({ distance: current.distance, path: current.path });
    }

    const parents = graph.parentsOf.get(current.personId) || [];
    for (const p of parents) {
      // منع الدوران: لا نعيد زيارة شخص هو بالفعل في المسار الحالي
      if (current.path.some((step) => step.personId === p.personId) || p.personId === startId) {
        continue;
      }
      queue.push({
        personId: p.personId,
        distance: current.distance + 1,
        path: [...current.path, { personId: p.personId, role: p.role, relationType: p.relationType }],
      });
    }
  }
  return results;
}

/** أقصر مسافة فقط (لسرعة الفحوصات الأولية) */
function shortestAncestorDistances(ancestorsWithPaths) {
  const map = new Map();
  for (const [id, paths] of ancestorsWithPaths.entries()) {
    const min = Math.min(...paths.map((p) => p.distance));
    map.set(id, min);
  }
  return map;
}

/**
 * يبحث عن جميع الأسلاف المشتركين بين شخصين ويرتبهم حسب مجموع المسافة (الأقرب أولًا).
 */
function findCommonAncestors(ancestorsA, ancestorsB) {
  const common = [];
  for (const [ancestorId, pathsA] of ancestorsA.entries()) {
    if (ancestorsB.has(ancestorId)) {
      const pathsB = ancestorsB.get(ancestorId);
      const dA = Math.min(...pathsA.map((p) => p.distance));
      const dB = Math.min(...pathsB.map((p) => p.distance));
      common.push({
        ancestorId,
        distanceA: dA,
        distanceB: dB,
        totalDistance: dA + dB,
        pathA: pathsA.find((p) => p.distance === dA).path,
        pathB: pathsB.find((p) => p.distance === dB).path,
      });
    }
  }
  common.sort((a, b) => a.totalDistance - b.totalDistance);
  return common;
}

/** يتحقق: هل personId هو مباشرة أحد آباء/أمهات (0 أو 1 مسافة) في مسار مباشر */
function isDirectLine(distanceA, distanceB) {
  return distanceA === 0 || distanceB === 0;
}

const ORDINAL_AR = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة'];

/** تسمية الخط المباشر (أب/جد/ابن/حفيد ...) بحسب عدد الأجيال والجنس */
function directLineLabel(generations, gender) {
  const isMale = gender === 'male';
  if (generations === 1) return isMale ? 'الأب' : 'الأم';
  if (generations === 2) return isMale ? 'الجد' : 'الجدة';
  if (generations === 3) return isMale ? 'جد الجد (الجد الأكبر)' : 'جدة الجد (الجدة الكبرى)';
  return `${isMale ? 'جد' : 'جدة'} من الدرجة ${generations} (سلف مباشر عبر ${generations} أجيال)`;
}
function directDescendantLabel(generations, gender) {
  const isMale = gender === 'male';
  if (generations === 1) return isMale ? 'الابن' : 'الابنة';
  if (generations === 2) return isMale ? 'الحفيد' : 'الحفيدة';
  if (generations === 3) return isMale ? 'حفيد الحفيد' : 'حفيدة الحفيد';
  return `${isMale ? 'حفيد' : 'حفيدة'} من الدرجة ${generations} (نسل مباشر عبر ${generations} أجيال)`;
}

/**
 * تسمية علاقة العم/العمة/الخال/الخالة والنسب الفرعي (ابن عم، ابن ابن عم ...)
 * uncleSideGenderChain: يحدد إن كانت القرابة من ناحية الأب (عم/عمة) أو الأم (خال/خالة)
 * عبر جنس السلف المشترك المتفرع + دور الوالد (father/mother) في أول خطوة من مسار الشخص الأصغر جيلاً.
 */
function auncleLabel(targetGender, side /* 'father' | 'mother' */, removedLevels) {
  const isMale = targetGender === 'male';
  const base = side === 'father' ? (isMale ? 'العم' : 'العمة') : (isMale ? 'الخال' : 'الخالة');
  if (removedLevels === 0) return base;
  // "عم الأب/الجد" لعدة أجيال أعلى (great-uncle وما بعدها)
  const prefix = 'جد '.repeat(removedLevels);
  return `${prefix}${base} (قرابة عمومة/خؤولة أبعد بـ${removedLevels} جيل)`;
}

function cousinLabel(side /* father|mother|mixed */, degree, removed) {
  const sideWord = side === 'father' ? 'من ناحية الأب' : side === 'mother' ? 'من ناحية الأم' : '';
  let base;
  if (degree === 1 && removed === 0) base = 'ابن/ابنة عم أو خال (أبناء عمومة/خؤولة من الدرجة الأولى)';
  else if (degree === 2 && removed === 0) base = 'أبناء عمومة/خؤولة من الدرجة الثانية';
  else base = `أبناء عمومة/خؤولة من الدرجة ${degree}`;
  if (removed > 0) base += ` (مع فارق ${removed} جيل بين الفرعين)`;
  return sideWord ? `${base} ${sideWord}` : base;
}

/**
 * يحدد جانب القرابة (أب/أم) من منظور الشخص الذي يبدأ منه هذا المسار:
 * أول خطوة في المسار هي أقرب والد للشخص نفسه (أب أو أم) المؤدي نحو السلف المشترك.
 */
function sideOfPath(path) {
  if (!path.length) return null;
  const firstStep = path[0]; // أقرب خطوة إلى الشخص المرجعي نفسه (والده المباشر في هذا الفرع)
  return firstStep.role === 'father' ? 'father' : 'mother';
}

/** يحدد جنس أقرب شخص في المسار (الوالد المباشر الذي يربط الشخص بالفرع) لتحديد أخ/أخت أو عم/عمة...الخ */
function connectingRelativeGender(db, path, ownerId) {
  if (!path.length) return 'unknown';
  const connectorId = path[0].personId;
  const row = db.prepare('SELECT gender FROM persons WHERE id = ? AND owner_id = ?').get(connectorId, ownerId);
  return row ? row.gender : 'unknown';
}

/**
 * يتحقق هل هناك أكثر من زواج بين parentsOf السلف المشترك أدى لأخوة أشقاء أو لأشقاء من جهة واحدة فقط.
 */
function siblingType(graph, personAId, personBId) {
  const parentsA = new Set((graph.parentsOf.get(personAId) || []).map((p) => p.personId));
  const parentsB = new Set((graph.parentsOf.get(personBId) || []).map((p) => p.personId));
  const shared = [...parentsA].filter((p) => parentsB.has(p));
  if (shared.length >= 2) return 'full'; // أخ/أخت شقيق/ة (نفس الأب والأم)
  if (shared.length === 1) return 'half';
  return 'none';
}

/**
 * يبني وصف "المصاهرة" (Affinity) بين شخصين إن لم توجد قرابة دم مباشرة، أو بالإضافة إليها.
 * يفحص: هل أحدهما زوج/زوجة لقريب دم للآخر، أو قريب دم لزوج/زوجة الآخر.
 */
function genderOf(db, ownerId, id) {
  const row = db.prepare('SELECT gender FROM persons WHERE id=? AND owner_id=?').get(id, ownerId);
  return row ? row.gender : 'unknown';
}

/**
 * يبني وصف علاقات "المصاهرة" (Affinity) بين شخصين — منفصلة تمامًا عن قرابة الدم.
 * يفحص كلا الاتجاهين: أقارب دم لأحد الزوجين ↔ الطرف الآخر، وأزواج الأبناء/البنات.
 */
function findAffinityRelations(db, graph, ownerId, personAId, personBId) {
  const relations = [];
  const spousesA = (graph.spousesOf.get(personAId) || []).map((s) => s.personId);
  const spousesB = (graph.spousesOf.get(personBId) || []).map((s) => s.personId);

  if (spousesA.includes(personBId)) {
    relations.push({ kind: 'marriage', label: 'زوج/زوجة (علاقة زواج مباشرة)' });
  }

  // 1) B هو أحد أقارب دم أحد أزواج A (أخو/أخت الزوج، أبو/أم الزوج)
  for (const spouseId of spousesA) {
    if (spouseId === personBId) continue;
    const siblingCheck = siblingType(graph, spouseId, personBId);
    if (siblingCheck !== 'none') {
      const g = genderOf(db, ownerId, personBId);
      relations.push({ kind: 'affinity', label: g === 'male' ? 'أخو الزوج/الزوجة' : g === 'female' ? 'أخت الزوج/الزوجة' : 'شقيق الزوج/الزوجة' });
    }
    const parentOfSpouse = (graph.parentsOf.get(spouseId) || []).find((p) => p.personId === personBId);
    if (parentOfSpouse) {
      relations.push({ kind: 'affinity', label: parentOfSpouse.role === 'father' ? 'أبو الزوج/الزوجة (الحمو)' : 'أم الزوج/الزوجة (الحماة)' });
    }
  }

  // 2) A هو أحد أقارب دم أحد أزواج B (نفس الفحص من الاتجاه الآخر — كأن يكون الشخص A هو "زوج أخت B")
  for (const spouseId of spousesB) {
    if (spouseId === personAId) continue;
    const siblingCheck = siblingType(graph, spouseId, personAId);
    if (siblingCheck !== 'none') {
      const g = genderOf(db, ownerId, personBId);
      relations.push({ kind: 'affinity', label: g === 'male' ? 'زوج الأخت' : g === 'female' ? 'زوجة الأخ' : 'زوج/زوجة الشقيق' });
    }
    const parentOfSpouse = (graph.parentsOf.get(spouseId) || []).find((p) => p.personId === personAId);
    if (parentOfSpouse) {
      relations.push({ kind: 'affinity', label: 'حمو/حماة ابنه أو ابنته المتزوج/ة (مصاهرة عبر والد الزوج)' });
    }
  }

  // 3) B زوج/ة لأحد أبناء/بنات A (كنّة أو صهر)
  const childrenA = (graph.childrenOf.get(personAId) || []).map((c) => c.personId);
  for (const childId of childrenA) {
    const spousesOfChild = (graph.spousesOf.get(childId) || []).map((s) => s.personId);
    if (spousesOfChild.includes(personBId)) {
      const isSon = genderOf(db, ownerId, childId) === 'male';
      relations.push({ kind: 'affinity', label: isSon ? 'زوجة الابن (الكنّة)' : 'زوج الابنة (الصهر)' });
    }
  }
  // 4) A زوج/ة لأحد أبناء/بنات B (من الاتجاه الآخر)
  const childrenB = (graph.childrenOf.get(personBId) || []).map((c) => c.personId);
  for (const childId of childrenB) {
    const spousesOfChild = (graph.spousesOf.get(childId) || []).map((s) => s.personId);
    if (spousesOfChild.includes(personAId)) {
      const isSonInLaw = genderOf(db, ownerId, personAId) === 'male';
      relations.push({ kind: 'affinity', label: isSonInLaw ? 'زوج الابنة (الصهر)' : 'زوجة الابن (الكنّة)' });
    }
  }

  return relations;
}

/**
 * الدالة الرئيسية: تحسب صلة القرابة بين شخصين لمستخدم معيّن.
 * تعيد كائنًا يحتوي: found, relations[] (قد يكون أكثر من علاقة), commonAncestors, notes
 */
function computeKinship(db, ownerId, personAId, personBId) {
  if (personAId === personBId) {
    return {
      found: true,
      samePerson: true,
      relations: [{ label: 'نفس الشخص', type: 'self', degree: 0, path: [] }],
    };
  }

  const personA = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=?').get(personAId, ownerId);
  const personB = db.prepare('SELECT * FROM persons WHERE id=? AND owner_id=?').get(personBId, ownerId);
  if (!personA || !personB) {
    return { found: false, error: 'PERSON_NOT_FOUND' };
  }

  const graph = buildGraph(db, ownerId);
  const ancestorsA = findAncestorsWithPaths(graph, personAId);
  const ancestorsB = findAncestorsWithPaths(graph, personBId);
  const commonAncestors = findCommonAncestors(ancestorsA, ancestorsB);

  // حالة الخط المباشر: أحد الشخصين هو نفسه سلف الآخر (وليس له سلف مشترك "ثالث")
  // هذه الحالة لا تظهر في تقاطع ancestorsA/ancestorsB لأن الشخص لا يُعتبر من أسلاف نفسه بمسافة صفر.
  if (ancestorsA.has(personBId)) {
    const best = ancestorsA.get(personBId).reduce((a, b) => (a.distance <= b.distance ? a : b));
    commonAncestors.unshift({
      ancestorId: personBId,
      distanceA: best.distance,
      distanceB: 0,
      totalDistance: best.distance,
      pathA: best.path,
      pathB: [],
    });
  } else if (ancestorsB.has(personAId)) {
    const best = ancestorsB.get(personAId).reduce((a, b) => (a.distance <= b.distance ? a : b));
    commonAncestors.unshift({
      ancestorId: personAId,
      distanceA: 0,
      distanceB: best.distance,
      totalDistance: best.distance,
      pathA: [],
      pathB: best.path,
    });
  }
  commonAncestors.sort((a, b) => a.totalDistance - b.totalDistance);

  const bloodRelations = [];
  const bySignature = new Map(); // لدمج الأسلاف المشتركين (مثل الجد والجدة معًا) الذين ينتجون نفس نوع القرابة

  if (commonAncestors.length > 0) {
    // نأخذ كل الأسلاف المشتركين ذوي أقل مجموع مسافة (قد يكون هناك أكثر من واحد بنفس الدرجة = علاقة مضاعفة حقيقية،
    // أو ببساطة زوجان (جد وجدة) ينتجان نفس صلة القرابة — يتم دمجهما في نتيجة واحدة أدناه)
    const minTotal = commonAncestors[0].totalDistance;
    const closest = commonAncestors.filter((c) => c.totalDistance === minTotal);

    for (const ca of closest) {
      const { distanceA, distanceB, pathA, pathB, ancestorId } = ca;
      let label;
      let type;
      let degree = null;
      let signature;

      if (isDirectLine(distanceA, distanceB)) {
        if (distanceA === 0) {
          label = directDescendantLabel(distanceB, personB.gender);
          type = 'descendant';
          degree = distanceB;
        } else {
          label = directLineLabel(distanceA, personB.gender);
          type = 'ancestor';
          degree = distanceA;
        }
        signature = `${type}|${degree}`;
      } else if (distanceA === 1 && distanceB === 1) {
        const st = siblingType(graph, personAId, personBId);
        const bGender = personB.gender;
        const word = bGender === 'male' ? 'أخ' : bGender === 'female' ? 'أخت' : 'شقيق';
        const sharedSide = sideOfPath(pathB) === 'father' ? 'الأب' : 'الأم';
        label = st === 'full' ? `${word} شقيق (نفس الأب والأم)` : `${word} من ${sharedSide} فقط (غير شقيق)`;
        type = 'sibling';
        degree = 1;
        signature = `${type}|${st}`;
      } else if (Math.min(distanceA, distanceB) === 1) {
        // عم/عمة/خال/خالة (الجيل الأعلى) مقابل ابن الأخ/بنت الأخت (الجيل الأدنى)
        const olderIsA = distanceA < distanceB; // A هو الجيل الأعلى (العم/الخال) بالنسبة لـ B
        const removed = Math.max(distanceA, distanceB) - 2;
        const elderPerson = olderIsA ? personA : personB;
        const youngerPerson = olderIsA ? personB : personA;
        const youngerPath = olderIsA ? pathB : pathA;
        const sideFromYounger = sideOfPath(youngerPath); // هل العم/الخال من ناحية أب الأصغر أم أمه
        const siblingGender = connectingRelativeGender(db, youngerPath, ownerId); // جنس والد الأصغر (شقيق الأكبر)

        // الاصطلاح: التسمية تصف "من هو personB بالنسبة لـ personA" (كما في حالة الخط المباشر أعلاه)
        if (olderIsA) {
          // A هو الجيل الأعلى ⇒ B هو الأصغر ⇒ B هو ابن/بنت أخ/أخت A
          const isMaleYounger = youngerPerson.gender === 'male';
          const siblingWord = siblingGender === 'male' ? 'الأخ' : siblingGender === 'female' ? 'الأخت' : 'الشقيق';
          label = `${isMaleYounger ? 'ابن' : 'بنت'} ${siblingWord}${removed > 0 ? ` (بامتداد ${removed} جيل إضافي)` : ''}`;
          type = 'niece_nephew';
        } else {
          // B هو الجيل الأعلى ⇒ B هو عم/عمة/خال/خالة A
          label = auncleLabel(elderPerson.gender, sideFromYounger, removed);
          type = 'uncle_aunt';
        }
        degree = Math.max(distanceA, distanceB) - 1;
        signature = `${type}|${sideFromYounger}|${siblingGender}|${degree}`;
      } else {
        // أبناء عم/خال (درجة أولى) وما بعدها، مع مراعاة الفروع المتباعدة (removed)
        // الاصطلاح: التسمية دائمًا تصف "من هو personB بالنسبة لـ personA" — لذلك side يُحسب من مسار A دومًا.
        const degreeNum = Math.min(distanceA, distanceB) - 1;
        const removed = Math.abs(distanceA - distanceB);
        const sideOfA = sideOfPath(pathA); // عبر أي والد لـ A تصل القرابة (أب أم أم)

        if (degreeNum === 1 && removed === 0) {
          const siblingGenderOfB = connectingRelativeGender(db, pathB, ownerId); // جنس والد B (شقيق والد A)
          const base = sideOfA === 'father'
            ? (siblingGenderOfB === 'male' ? 'العم' : 'العمة')
            : (siblingGenderOfB === 'male' ? 'الخال' : 'الخالة');
          label = `${personB.gender === 'male' ? 'ابن' : 'بنت'} ${base} (أبناء عمومة/خؤولة من الدرجة الأولى)`;
          signature = `${type}|${sideOfA}|${siblingGenderOfB}|${degreeNum}|${removed}`;
        } else {
          label = cousinLabel(sideOfA, degreeNum, removed);
          signature = `cousin_generic|${sideOfA}|${degreeNum}|${removed}`;
        }
        type = 'cousin';
        degree = degreeNum;
      }

      if (bySignature.has(signature)) {
        bySignature.get(signature).commonAncestorIds.push(ancestorId);
      } else {
        bySignature.set(signature, {
          label,
          type,
          degree,
          commonAncestorIds: [ancestorId],
          distanceFromA: distanceA,
          distanceFromB: distanceB,
          pathFromA: pathA,
          pathFromB: pathB,
        });
      }
    }

    for (const rel of bySignature.values()) {
      const names = rel.commonAncestorIds
        .map((id) => (db.prepare('SELECT full_name, first_name FROM persons WHERE id=?').get(id) || {}))
        .map((p) => p.full_name || p.first_name)
        .filter(Boolean);
      bloodRelations.push({ ...rel, commonAncestorName: names.join(' و ') });
    }
  }

  const affinityRelations = findAffinityRelations(db, graph, ownerId, personAId, personBId).map((r) => ({
    label: r.label,
    type: r.kind === 'marriage' ? 'spouse' : 'in_law',
    degree: null,
  }));

  const allRelations = [...bloodRelations, ...affinityRelations];

  if (allRelations.length === 0) {
    return {
      found: false,
      relations: [],
      message:
        commonAncestors.length === 0
          ? 'لم يتم العثور على صلة قرابة معروفة ضمن البيانات الحالية.'
          : 'قد توجد صلة قرابة، لكن البيانات المسجلة غير كافية لإثباتها.',
    };
  }

  return {
    found: true,
    personA: { id: personA.id, name: personA.full_name || personA.first_name },
    personB: { id: personB.id, name: personB.full_name || personB.first_name },
    relations: allRelations,
    hasMultipleRelations: allRelations.length > 1,
    allCommonAncestors: commonAncestors.slice(0, 10), // أهم المسارات فقط لتفادي إغراق الواجهة
  };
}

/** يعيد جميع أسلاف شخص (آباء، أجداد ...) حتى حد الأجيال المطلوب، لبناء الشجرة */
function getAncestors(db, ownerId, personId, maxGen = MAX_GENERATIONS) {
  const graph = buildGraph(db, ownerId);
  const result = findAncestorsWithPaths(graph, personId);
  const out = [];
  for (const [id, paths] of result.entries()) {
    const minPath = paths.reduce((a, b) => (a.distance <= b.distance ? a : b));
    if (minPath.distance <= maxGen) out.push({ id, distance: minPath.distance });
  }
  return out;
}

/** يعيد جميع فروع/نسل شخص حتى حد الأجيال المطلوب */
function getDescendants(db, ownerId, personId, maxGen = MAX_GENERATIONS) {
  const graph = buildGraph(db, ownerId);
  const out = [];
  const queue = [{ personId, distance: 0 }];
  const visited = new Set([personId]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.distance > 0) out.push({ id: cur.personId, distance: cur.distance });
    if (cur.distance >= maxGen) continue;
    const children = graph.childrenOf.get(cur.personId) || [];
    for (const c of children) {
      if (visited.has(c.personId)) continue;
      visited.add(c.personId);
      queue.push({ personId: c.personId, distance: cur.distance + 1 });
    }
  }
  return out;
}

/**
 * يستخرج الشبكة العائلية التي تربط مجموعة من الأشخاص (لبناء شجرة مجموعة).
 * يجمع كل الأسلاف والسلالات لكل شخص حتى maxGen، ثم يبني تقاطعات المسارات.
 */
function buildGroupNetwork(db, ownerId, personIds, maxGen = 10) {
  const graph = buildGraph(db, ownerId);
  const nodeSet = new Set(personIds);
  const edges = [];

  for (const pid of personIds) {
    const ancestors = findAncestorsWithPaths(graph, pid);
    for (const [ancestorId, paths] of ancestors.entries()) {
      const best = paths.reduce((a, b) => (a.distance <= b.distance ? a : b));
      if (best.distance > maxGen) continue;
      nodeSet.add(ancestorId);
      let prev = pid;
      for (const step of best.path) {
        nodeSet.add(step.personId);
        edges.push({ parent: step.personId, child: prev, role: step.role, relationType: step.relationType });
        prev = step.personId;
      }
    }
  }

  return { nodeIds: [...nodeSet], edges };
}

/** كشف الدورات: يتحقق أن إضافة علاقة أب/ابن جديدة لن تُنشئ دورة (شخص يصبح سلف نفسه) */
function wouldCreateCycle(db, ownerId, parentId, childId) {
  if (parentId === childId) return true;
  const graph = buildGraph(db, ownerId);
  // هل parentId هو بالفعل أحد نسل childId؟ إن كان كذلك فإضافة (parentId->childId) تُنشئ دورة
  const descendantsOfChild = getDescendantsSet(graph, childId);
  return descendantsOfChild.has(parentId);
}

function getDescendantsSet(graph, personId) {
  const visited = new Set();
  const queue = [personId];
  while (queue.length) {
    const cur = queue.shift();
    const children = graph.childrenOf.get(cur) || [];
    for (const c of children) {
      if (!visited.has(c.personId)) {
        visited.add(c.personId);
        queue.push(c.personId);
      }
    }
  }
  return visited;
}

module.exports = {
  buildGraph,
  findAncestorsWithPaths,
  findCommonAncestors,
  computeKinship,
  getAncestors,
  getDescendants,
  buildGroupNetwork,
  wouldCreateCycle,
  MAX_GENERATIONS,
};
