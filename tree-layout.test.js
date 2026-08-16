'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeTreeLayout } = require('../public/js/tree-render.js');

function buildAhmedFamily() {
  // نفس المثال المذكور في تقرير المشكلة تمامًا:
  // أحمد -> محمد، علي، حسن ؛ علي -> خالد، محمود
  const ids = { ahmed: 'ahmed', mohammed: 'mohammed', ali: 'ali', hassan: 'hassan', khaled: 'khaled', mahmoud: 'mahmoud' };
  const persons = {};
  for (const id of Object.values(ids)) persons[id] = { id, first_name: id, full_name: id, gender: 'male', life_status: 'alive', created_at: id };
  const edges = [
    { parent_id: ids.ahmed, child_id: ids.mohammed, relation_type: 'biological' },
    { parent_id: ids.ahmed, child_id: ids.ali, relation_type: 'biological' },
    { parent_id: ids.ahmed, child_id: ids.hassan, relation_type: 'biological' },
    { parent_id: ids.ali, child_id: ids.khaled, relation_type: 'biological' },
    { parent_id: ids.ali, child_id: ids.mahmoud, relation_type: 'biological' },
  ];
  const descendantDistances = {
    [ids.mohammed]: 1, [ids.ali]: 1, [ids.hassan]: 1,
    [ids.khaled]: 2, [ids.mahmoud]: 2,
  };
  return {
    rootId: ids.ahmed,
    persons,
    edges,
    marriages: [],
    ancestorDistances: {},
    descendantDistances,
  };
}

test('كل الأشخاص الستة يحصلون على موضع (لا أحد يُسقَط)', () => {
  const data = buildAhmedFamily();
  const layout = computeTreeLayout(data);
  assert.strictEqual(layout.positions.size, 6);
  for (const id of Object.keys(data.persons)) {
    assert.ok(layout.positions.has(id), `الشخص ${id} يجب أن يكون له موضع في الشجرة`);
  }
});

test('لا يوجد أي تداخل (تراكب) بين مواضع الأشخاص', () => {
  const data = buildAhmedFamily();
  const layout = computeTreeLayout(data);
  const boxes = [...layout.positions.entries()].map(([id, pos]) => ({
    id, x1: pos.x, x2: pos.x + layout.NODE_W, y1: pos.y, y2: pos.y + layout.NODE_H,
  }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlapX = a.x1 < b.x2 && b.x1 < a.x2;
      const overlapY = a.y1 < b.y2 && b.y1 < a.y2;
      assert.ok(!(overlapX && overlapY), `تداخل بين ${a.id} و ${b.id}`);
    }
  }
});

test('خالد ومحمود (أبناء علي) يظهران تحت علي فعليًا، وليس تحت أحمد مباشرة', () => {
  const data = buildAhmedFamily();
  const layout = computeTreeLayout(data);
  const ali = layout.positions.get('ali');
  const khaled = layout.positions.get('khaled');
  const mahmoud = layout.positions.get('mahmoud');

  // خالد ومحمود يجب أن يكونا في الجيل الأسفل التالي مباشرة بعد علي (فرق ارتفاع واحد)
  assert.strictEqual(khaled.y - ali.y, mahmoud.y - ali.y);
  assert.ok(khaled.y > ali.y);

  // مركز أبناء علي (خالد ومحمود) يجب أن يكون تحت علي أفقيًا (محاذاة حقيقية، وليس عشوائية)
  const aliCenterX = ali.x + layout.NODE_W / 2;
  const childrenCenterX = (khaled.x + layout.NODE_W / 2 + mahmoud.x + layout.NODE_W / 2) / 2;
  assert.ok(Math.abs(aliCenterX - childrenCenterX) < 1, 'يجب أن يكون علي في مركز أبنائه تمامًا (خطأ التخطيط القديم)');
});

test('محمد وحسن (بلا أبناء) لا يتداخلان مع فرع علي رغم اختلاف عرض الفروع', () => {
  const data = buildAhmedFamily();
  const layout = computeTreeLayout(data);
  const mohammed = layout.positions.get('mohammed');
  const hassan = layout.positions.get('hassan');
  const khaled = layout.positions.get('khaled');
  const mahmoud = layout.positions.get('mahmoud');
  // نفس فحص عدم التداخل مركّزًا على هذه العقد تحديدًا
  const all = [mohammed, hassan, khaled, mahmoud];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const overlapX = all[i].x < all[j].x + layout.NODE_W && all[j].x < all[i].x + layout.NODE_W;
      const overlapY = all[i].y < all[j].y + layout.NODE_H && all[j].y < all[i].y + layout.NODE_H;
      assert.ok(!(overlapX && overlapY));
    }
  }
});

test('دعم عدة أجيال بلا حد عشوائي: إضافة جيل رابع (أبناء خالد) يظهر بصورة صحيحة', () => {
  const data = buildAhmedFamily();
  data.persons['khaled_son'] = { id: 'khaled_son', first_name: 'خالد الابن', full_name: 'خالد الابن', gender: 'male', life_status: 'alive', created_at: 'z' };
  data.edges.push({ parent_id: 'khaled', child_id: 'khaled_son', relation_type: 'biological' });
  data.descendantDistances['khaled_son'] = 3;

  const layout = computeTreeLayout(data);
  assert.strictEqual(layout.positions.size, 7);
  const khaled = layout.positions.get('khaled');
  const khaledSon = layout.positions.get('khaled_son');
  assert.ok(khaledSon.y > khaled.y);
});

test('الأداء: شجرة بها مئات الأشخاص وعشرات الأجيال تُحسب بسرعة معقولة', () => {
  const persons = {};
  const edges = [];
  const descendantDistances = {};
  let prev = 'root';
  persons[prev] = { id: prev, first_name: 'root', created_at: '0' };
  const start = Date.now();
  for (let gen = 1; gen <= 30; gen++) {
    for (let child = 0; child < 5; child++) {
      const id = `g${gen}_c${child}`;
      persons[id] = { id, first_name: id, created_at: String(gen * 10 + child) };
      edges.push({ parent_id: prev, child_id: id, relation_type: 'biological' });
      descendantDistances[id] = gen;
    }
    prev = `g${gen}_c0`; // نتابع من أول ابن لبناء عمق حقيقي
  }
  const data = { rootId: 'root', persons, edges, marriages: [], ancestorDistances: {}, descendantDistances };
  const layout = computeTreeLayout(data);
  const elapsed = Date.now() - start;
  assert.strictEqual(layout.positions.size, Object.keys(persons).length);
  assert.ok(elapsed < 2000, `استغرق ${elapsed}ms`);
});
