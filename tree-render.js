'use strict';

/**
 * حساب تخطيط الشجرة (منطق بحت، بدون DOM) — يمكن اختباره مباشرة في Node.
 *
 * المشكلة التي يُصلحها هذا الملف: كان التخطيط القديم يضع كل شخص حسب ترتيبه
 * البسيط داخل "صف الجيل" فقط، دون أي علاقة بموضع والده الفعلي. هذا لا يُسقط
 * أي بيانات، لكنه يُنتج خطوطًا متقاطعة وعقدًا غير مُحاذاة تحت آبائها، فيبدو
 * للمستخدم أن فرعًا كاملًا (كأبناء "علي" في المثال) "اختفى أو لا يظهر بصورة
 * صحيحة" بينما هو فعليًا موجود لكن مرسوم في مكان غير منطقي بصريًا.
 *
 * الحل: تخطيط شجرة حقيقي (Tidy Tree) حيث يُحسب عرض الشجرة الفرعية لكل شخص
 * من أبنائه أولًا (bottom-up)، ثم يوضع كل والد في مركز أبنائه تمامًا —
 * بنفس الطريقة للأسلاف (اتجاه معاكس) وللفروع.
 *
 * data: { rootId, persons, edges, marriages, ancestorDistances, descendantDistances }
 * يعيد: { positions: Map<id,{x,y}>, totalWidth, totalHeight, levels: Map<id,level> }
 */
function computeTreeLayout(data, opts) {
  const NODE_W = (opts && opts.NODE_W) || 130;
  const NODE_H = (opts && opts.NODE_H) || 64;
  const H_GAP = (opts && opts.H_GAP) || 26;
  const V_GAP = (opts && opts.V_GAP) || 90;
  const SLOT = NODE_W + H_GAP;

  // 1) تحديد مستوى كل شخص: سالب = أسلاف (أعلى الجذر)، صفر = الجذر، موجب = فروع (أسفل الجذر)
  const levels = new Map();
  levels.set(data.rootId, 0);
  for (const [id, d] of Object.entries(data.ancestorDistances || {})) {
    if (!levels.has(id)) levels.set(id, -d);
  }
  for (const [id, d] of Object.entries(data.descendantDistances || {})) {
    if (!levels.has(id)) levels.set(id, d);
  }
  for (const id of Object.keys(data.persons || {})) {
    if (!levels.has(id)) levels.set(id, 0);
  }

  // 2) لكل شخص (عدا الجذر): إيجاد "الوالد التخطيطي" — الجار الأقرب إلى الجذر
  const layoutParent = new Map();
  const edgesByNode = new Map();
  for (const e of data.edges || []) {
    if (!edgesByNode.has(e.parent_id)) edgesByNode.set(e.parent_id, []);
    if (!edgesByNode.has(e.child_id)) edgesByNode.set(e.child_id, []);
    edgesByNode.get(e.parent_id).push(e.child_id);
    edgesByNode.get(e.child_id).push(e.parent_id);
  }

  function closerLevel(lvl) {
    if (lvl > 0) return lvl - 1;
    if (lvl < 0) return lvl + 1;
    return 0;
  }

  for (const [id, lvl] of levels.entries()) {
    if (id === data.rootId || lvl === 0) continue;
    const target = closerLevel(lvl);
    const neighbors = edgesByNode.get(id) || [];
    const candidate = neighbors.find((n) => levels.get(n) === target);
    if (candidate !== undefined) layoutParent.set(id, candidate);
  }

  // 3) بناء شجرة الأبناء التخطيطية
  const layoutChildren = new Map();
  for (const [id, parentId] of layoutParent.entries()) {
    if (!layoutChildren.has(parentId)) layoutChildren.set(parentId, []);
    layoutChildren.get(parentId).push(id);
  }
  for (const children of layoutChildren.values()) {
    children.sort((a, b) => {
      const pa = (data.persons[a] || {}).created_at || '';
      const pb = (data.persons[b] || {}).created_at || '';
      return pa < pb ? -1 : pa > pb ? 1 : String(a).localeCompare(String(b));
    });
  }

  // 4) حساب عرض الشجرة الفرعية لكل عقدة (bottom-up)
  const subtreeWidth = new Map();
  function computeWidth(id) {
    const children = layoutChildren.get(id) || [];
    if (!children.length) {
      subtreeWidth.set(id, SLOT);
      return SLOT;
    }
    let sum = 0;
    for (const c of children) sum += computeWidth(c);
    const w = Math.max(SLOT, sum);
    subtreeWidth.set(id, w);
    return w;
  }
  const roots = [data.rootId, ...[...levels.keys()].filter((id) => id !== data.rootId && !layoutParent.has(id))];
  for (const r of roots) computeWidth(r);

  // 5) توزيع الإحداثيات الأفقية (bottom-up مع توسيط فعلي فوق الأبناء)
  const positions = new Map();
  let cursorX = 0;
  function placeSubtree(id, level) {
    const children = layoutChildren.get(id) || [];
    const y = level * V_GAP;
    if (!children.length) {
      positions.set(id, { x: cursorX, y });
      cursorX += SLOT;
      return positions.get(id).x + NODE_W / 2;
    }
    const childCenters = [];
    for (const c of children) {
      childCenters.push(placeSubtree(c, level + (levels.get(c) > levels.get(id) ? 1 : -1)));
    }
    const myCenter = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    positions.set(id, { x: myCenter - NODE_W / 2, y });
    return myCenter;
  }
  for (const r of roots) {
    placeSubtree(r, levels.get(r));
    cursorX += SLOT;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + NODE_W);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y + NODE_H);
  }
  if (!isFinite(minX)) { minX = 0; maxX = NODE_W; minY = 0; maxY = NODE_H; }
  const MARGIN = 20;
  for (const pos of positions.values()) {
    pos.x = pos.x - minX + MARGIN;
    pos.y = pos.y - minY + MARGIN;
  }

  return {
    positions,
    levels,
    totalWidth: maxX - minX + MARGIN * 2,
    totalHeight: maxY - minY + MARGIN * 2,
    NODE_W,
    NODE_H,
  };
}

function renderTreeSvg(container, data, onPersonClick) {
  const layout = computeTreeLayout(data);
  const { positions, totalWidth, totalHeight, NODE_W, NODE_H } = layout;

  const genderColor = { male: '#1a5f96', female: '#a12163', unknown: '#666' };

  let svgLines = '';
  for (const edge of data.edges || []) {
    const p1 = positions.get(edge.parent_id);
    const p2 = positions.get(edge.child_id);
    if (!p1 || !p2) continue;
    const parentIsHigher = p1.y <= p2.y;
    const top = parentIsHigher ? p1 : p2;
    const bottom = parentIsHigher ? p2 : p1;
    const x1 = top.x + NODE_W / 2, y1 = top.y + NODE_H;
    const x2 = bottom.x + NODE_W / 2, y2 = bottom.y;
    const midY = (y1 + y2) / 2;
    const dashed = edge.relation_type && edge.relation_type !== 'biological' ? 'stroke-dasharray="4,3"' : '';
    svgLines += `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="#0f7a6b" stroke-width="2" opacity="0.6" ${dashed} />`;
  }
  for (const m of data.marriages || []) {
    const p1 = positions.get(m.spouse_a_id);
    const p2 = positions.get(m.spouse_b_id);
    if (!p1 || !p2 || p1.y !== p2.y) continue;
    const y = p1.y + NODE_H / 2;
    const left = p1.x <= p2.x ? p1 : p2;
    const right = p1.x <= p2.x ? p2 : p1;
    const dash = m.status === 'divorced' ? 'stroke-dasharray="3,3"' : '';
    svgLines += `<line x1="${left.x + NODE_W}" y1="${y}" x2="${right.x}" y2="${y}" stroke="#c9922f" stroke-width="2" ${dash} />`;
  }

  let svgNodes = '';
  for (const [id, pos] of positions.entries()) {
    const p = data.persons[id];
    if (!p) continue;
    const isRoot = id === data.rootId;
    const color = genderColor[p.gender] || genderColor.unknown;
    const name = escapeXml(p.full_name || p.first_name || '؟');
    const sub = p.life_status === 'deceased' ? '✝' : p.birth_date ? String(p.birth_date).slice(0, 4) : '';
    svgNodes += `
      <g class="tree-node" data-id="${id}" style="cursor:pointer" transform="translate(${pos.x},${pos.y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="12" fill="${isRoot ? '#e6f4f2' : '#ffffff'}" stroke="${isRoot ? '#0f7a6b' : color}" stroke-width="${isRoot ? 2.5 : 1.5}" />
        <text x="${NODE_W / 2}" y="26" text-anchor="middle" font-size="13" font-weight="700" fill="#1c2321">${truncate(name, 16)}</text>
        <text x="${NODE_W / 2}" y="45" text-anchor="middle" font-size="11" fill="#667069">${sub}</text>
      </g>`;
  }

  container.innerHTML = `
    <div class="tree-svg-wrap" style="max-height:70vh;">
      <svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
        ${svgLines}
        ${svgNodes}
      </svg>
    </div>
  `;

  container.querySelectorAll('.tree-node').forEach((node) => {
    node.addEventListener('click', () => onPersonClick && onPersonClick(node.getAttribute('data-id')));
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeTreeLayout };
}
