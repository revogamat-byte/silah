'use strict';

function personCardHtml(p) {
  const initial = (p.full_name || p.first_name || '؟').charAt(0);
  return `
    <div class="person-row" data-person-id="${p.id}">
      <div class="avatar">${initial}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.full_name || p.first_name)}</div>
        <div class="muted">
          <span class="badge ${p.gender}">${t(p.gender)}</span>
          <span class="badge ${p.life_status}">${t(p.life_status) || p.life_status}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function bindPersonRowNav(container) {
  container.querySelectorAll('[data-person-id]').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = '#/person/' + el.getAttribute('data-person-id');
    });
  });
}

async function personPicker(container, inputId, hiddenId, resultsId) {
  const input = container.querySelector('#' + inputId);
  const hidden = container.querySelector('#' + hiddenId);
  const results = container.querySelector('#' + resultsId);
  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    hidden.value = '';
    const q = input.value.trim();
    if (q.length < 1) { results.innerHTML = ''; return; }
    timeout = setTimeout(async () => {
      const res = await Api.get('/api/people/search?q=' + encodeURIComponent(q));
      results.innerHTML = res.items
        .map((p) => `<div class="person-row" data-pick="${p.id}" data-name="${escapeHtml(p.full_name || p.first_name)}">${personCardHtml(p)}</div>`)
        .join('') || `<div class="muted" style="padding:8px;">${t('no_results')}</div>`;
      results.querySelectorAll('[data-pick]').forEach((el) => {
        el.addEventListener('click', () => {
          hidden.value = el.getAttribute('data-pick');
          input.value = el.getAttribute('data-name');
          results.innerHTML = '';
        });
      });
    }, 250);
  });
}

window.Pages = {};

// ---------------------------------------------------------------- تسجيل الدخول
window.Pages.login = async function (container) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div class="card">
        <div class="brand"><span class="logo-mark">ص</span> ${t('app_name')}</div>
        <div class="tagline">${t('tagline')}</div>
        <div id="auth-alert"></div>
        <form id="login-form">
          <div class="field"><label>${t('email')}</label><input type="email" name="email" required /></div>
          <div class="field"><label>${t('password')}</label><input type="password" name="password" required /></div>
          <button class="btn" style="width:100%" type="submit">${t('login_btn')}</button>
        </form>
        <p class="text-center muted" style="margin-top:14px;">${t('no_account')} <a href="#/register">${t('register_btn')}</a></p>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await Api.post('/api/auth/login', { email: fd.get('email'), password: fd.get('password') });
      Api.setToken(res.token);
      Api.setUser(res.user);
      location.hash = '#/dashboard';
    } catch (err) {
      document.getElementById('auth-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  });
};

window.Pages.register = async function (container) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div class="card">
        <div class="brand"><span class="logo-mark">ص</span> ${t('app_name')}</div>
        <div class="tagline">${t('tagline')}</div>
        <div id="auth-alert"></div>
        <form id="register-form">
          <div class="field"><label>${t('full_name_field')}</label><input type="text" name="name" required /></div>
          <div class="field"><label>${t('email')}</label><input type="email" name="email" required /></div>
          <div class="field"><label>${t('password')}</label><input type="password" name="password" minlength="8" required /></div>
          <button class="btn" style="width:100%" type="submit">${t('register_btn')}</button>
        </form>
        <p class="text-center muted" style="margin-top:14px;">${t('have_account')} <a href="#/login">${t('login_btn')}</a></p>
      </div>
    </div>
  `;
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await Api.post('/api/auth/register', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') });
      Api.setToken(res.token);
      Api.setUser(res.user);
      location.hash = '#/dashboard';
    } catch (err) {
      document.getElementById('auth-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  });
};

// ---------------------------------------------------------------- لوحة التحكم
window.Pages.dashboard = async function (container) {
  const stats = await Api.get('/api/dashboard/stats');
  container.innerHTML = `
    <h1>${t('nav_dashboard')}</h1>
    <div class="grid">
      <div class="card stat-box"><div class="num">${stats.total_persons}</div><div class="label">${t('stat_total_persons')}</div></div>
      <div class="card stat-box"><div class="num">${stats.alive}</div><div class="label">${t('stat_alive')}</div></div>
      <div class="card stat-box"><div class="num">${stats.deceased}</div><div class="label">${t('stat_deceased')}</div></div>
      <div class="card stat-box"><div class="num">${stats.marriages}</div><div class="label">${t('stat_marriages')}</div></div>
      <div class="card stat-box"><div class="num">${stats.family_branches}</div><div class="label">${t('stat_branches')}</div></div>
      <div class="card stat-box"><div class="num">${stats.relationships}</div><div class="label">${t('stat_relationships')}</div></div>
    </div>
    <div class="card">
      <h2>${t('recent_persons')}</h2>
      <div id="recent-list">${stats.recent_persons.map(personCardHtml).join('') || `<p class="muted">${t('no_results')}</p>`}</div>
    </div>
  `;
  bindPersonRowNav(container);
};

// ---------------------------------------------------------------- إضافة / تعديل شخص
function personFormHtml(existing) {
  const p = existing || {};
  return `
    <div id="form-alert"></div>
    <form id="person-form">
      <div class="field-row">
        <div class="field"><label>${t('first_name')} *</label><input name="first_name" required value="${escapeHtml(p.first_name)}" /></div>
        <div class="field"><label>${t('father_name')}</label><input name="father_name" value="${escapeHtml(p.father_name)}" /></div>
        <div class="field"><label>${t('grandfather_name')}</label><input name="grandfather_name" value="${escapeHtml(p.grandfather_name)}" /></div>
        <div class="field"><label>${t('family_name')}</label><input name="family_name" value="${escapeHtml(p.family_name)}" /></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${t('gender')}</label>
          <select name="gender">
            <option value="unknown" ${!p.gender || p.gender === 'unknown' ? 'selected' : ''}>${t('unknown')}</option>
            <option value="male" ${p.gender === 'male' ? 'selected' : ''}>${t('male')}</option>
            <option value="female" ${p.gender === 'female' ? 'selected' : ''}>${t('female')}</option>
          </select>
        </div>
        <div class="field">
          <label>${t('life_status')}</label>
          <select name="life_status">
            <option value="unknown" ${!p.life_status || p.life_status === 'unknown' ? 'selected' : ''}>${t('unknown')}</option>
            <option value="alive" ${p.life_status === 'alive' ? 'selected' : ''}>${t('alive')}</option>
            <option value="deceased" ${p.life_status === 'deceased' ? 'selected' : ''}>${t('deceased')}</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('birth_date')}</label><input type="date" name="birth_date" value="${escapeHtml(p.birth_date)}" /></div>
        <div class="field"><label>${t('death_date')}</label><input type="date" name="death_date" value="${escapeHtml(p.death_date)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('birth_place')}</label><input name="birth_place" value="${escapeHtml(p.birth_place)}" /></div>
        <div class="field"><label>${t('death_place')}</label><input name="death_place" value="${escapeHtml(p.death_place)}" /></div>
      </div>
      <div class="field"><label>${t('source')}</label><input name="source" value="${escapeHtml(p.source)}" /></div>
      <div class="field"><label>${t('notes')}</label><textarea name="notes" rows="3">${escapeHtml(p.notes)}</textarea></div>
      <div class="btn-row">
        <button class="btn" type="submit">${t('save')}</button>
        <button class="btn secondary" type="button" id="cancel-btn">${t('cancel')}</button>
      </div>
    </form>
  `;
}

function formToPersonPayload(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = v === '' ? null : v;
  return obj;
}

window.Pages.addPerson = async function (container) {
  container.innerHTML = `<div class="card"><h1>${t('add_person_title')}</h1>${personFormHtml()}</div>`;
  document.getElementById('cancel-btn').onclick = () => history.back();
  document.getElementById('person-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = formToPersonPayload(e.target);
    try {
      const res = await Api.post('/api/people', payload);
      if (res.possible_duplicates && res.possible_duplicates.length) {
        renderDuplicateChoice(container, payload, res.possible_duplicates);
        return;
      }
      location.hash = '#/person/' + res.person.id;
    } catch (err) {
      document.getElementById('form-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  });
};

function renderDuplicateChoice(container, payload, duplicates) {
  container.innerHTML = `
    <div class="card">
      <h2>وجدنا أشخاصًا مشابهين</h2>
      <p class="muted">تحقق قبل إنشاء سجل جديد قد يكون مكررًا.</p>
      ${duplicates.map((d) => `<div class="person-row" data-goto="${d.id}">${personCardHtml(d)}</div>`).join('')}
      <div class="btn-row">
        <button class="btn" id="create-anyway">إنشاء شخص جديد على أي حال</button>
      </div>
    </div>
  `;
  container.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => (location.hash = '#/person/' + el.getAttribute('data-goto')));
  });
  document.getElementById('create-anyway').onclick = async () => {
    const res = await Api.post('/api/people', { ...payload, confirm_create_anyway: true });
    location.hash = '#/person/' + res.person.id;
  };
}

window.Pages.editPerson = async function (container, params) {
  const data = await Api.get('/api/people/' + params.id);
  container.innerHTML = `<div class="card"><h1>${t('edit')}: ${escapeHtml(data.person.full_name)}</h1>${personFormHtml(data.person)}</div>`;
  document.getElementById('cancel-btn').onclick = () => (location.hash = '#/person/' + params.id);
  document.getElementById('person-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = formToPersonPayload(e.target);
    try {
      await Api.patch('/api/people/' + params.id, payload);
      location.hash = '#/person/' + params.id;
    } catch (err) {
      document.getElementById('form-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  });
};

// ---------------------------------------------------------------- صفحة الشخص
window.Pages.personView = async function (container, params) {
  const data = await Api.get('/api/people/' + params.id);
  const p = data.person;
  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;gap:14px;align-items:center;">
          <div class="avatar" style="width:64px;height:64px;font-size:1.5rem;">${(p.full_name || p.first_name || '؟').charAt(0)}</div>
          <div>
            <h1 class="mt-0">${escapeHtml(p.full_name || p.first_name)}</h1>
            <span class="badge ${p.gender}">${t(p.gender)}</span>
            <span class="badge ${p.life_status}">${t(p.life_status)}</span>
          </div>
        </div>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn secondary" id="edit-btn">${t('edit')}</button>
          <button class="btn secondary" id="tree-btn">${t('view_tree')}</button>
          <button class="btn danger" id="delete-btn">${t('delete')}</button>
        </div>
      </div>
      <div class="field-row" style="margin-top:16px;">
        ${p.birth_date ? `<div><span class="muted">${t('birth_date')}: </span>${escapeHtml(p.birth_date)}</div>` : ''}
        ${p.death_date ? `<div><span class="muted">${t('death_date')}: </span>${escapeHtml(p.death_date)}</div>` : ''}
        ${p.birth_place ? `<div><span class="muted">${t('birth_place')}: </span>${escapeHtml(p.birth_place)}</div>` : ''}
      </div>
      ${p.notes ? `<p class="muted">${escapeHtml(p.notes)}</p>` : ''}
    </div>

    <div class="card">
      <h2>${t('parents')}</h2>
      <div id="parents-list">${data.parents.map((pp) => `<div class="person-row" data-person-id="${pp.parent_id}">${personCardHtml({ id: pp.parent_id, full_name: pp.full_name, first_name: pp.first_name, gender: pp.gender, life_status: '' })}<span class="badge">${pp.parent_role === 'father' ? t('father_name') : 'أم'} · ${pp.relation_type}</span></div>`).join('') || `<p class="muted">${t('no_results')}</p>`}</div>
      <button class="btn secondary" id="add-parent-btn">${t('add_relationship')}</button>
    </div>

    <div class="card">
      <h2>${t('children')}</h2>
      <div>${data.children.map((c) => `<div class="person-row" data-person-id="${c.child_id}">${personCardHtml({ id: c.child_id, full_name: c.full_name, first_name: c.first_name, gender: c.gender, life_status: '' })}</div>`).join('') || `<p class="muted">${t('no_results')}</p>`}</div>
      <button class="btn secondary" id="add-child-btn">${t('add_relationship')}</button>
    </div>

    <div class="card">
      <h2>${t('siblings')}</h2>
      <div>${data.siblings.map(personCardHtml).join('') || `<p class="muted">${t('no_results')}</p>`}</div>
    </div>

    <div class="card">
      <h2>${t('spouses')}</h2>
      <div>${data.marriages.map((m) => `
        <div class="person-row" data-person-id="${m.spouse_id}">
          ${personCardHtml({ id: m.spouse_id, full_name: m.spouse_name, gender: 'unknown', life_status: '' })}
          <span class="badge">${marriageStatusLabel(m.status)}</span>
        </div>`).join('') || `<p class="muted">${t('no_results')}</p>`}</div>
      <button class="btn secondary" id="add-marriage-btn">${t('add_marriage')}</button>
    </div>

    <div id="modal-slot"></div>
  `;
  bindPersonRowNav(container);
  document.getElementById('edit-btn').onclick = () => (location.hash = '#/person/' + p.id + '/edit');
  document.getElementById('tree-btn').onclick = () => (location.hash = '#/tree/' + p.id);
  document.getElementById('delete-btn').onclick = () => confirmDeletePerson(p.id);
  document.getElementById('add-parent-btn').onclick = () => openAddParentModal(container, p.id, 'parent');
  document.getElementById('add-child-btn').onclick = () => openAddParentModal(container, p.id, 'child');
  document.getElementById('add-marriage-btn').onclick = () => openAddMarriageModal(container, p.id);
};

function marriageStatusLabel(s) {
  return { married: 'متزوجان', divorced: 'مطلّقان', separated: 'منفصلان', widowed: 'ترمّل', unknown: 'غير معروف' }[s] || s;
}

async function confirmDeletePerson(id) {
  const impact = await Api.get(`/api/people/${id}/delete-impact`);
  let msg = t('confirm_delete');
  if (impact.warning) msg += '\n\n' + impact.warning;
  if (!confirm(msg)) return;
  await Api.delete('/api/people/' + id);
  location.hash = '#/dashboard';
}

function openAddParentModal(container, personId, mode) {
  const slot = document.getElementById('modal-slot');
  slot.innerHTML = `
    <div class="card">
      <h3>${t('add_relationship')}</h3>
      <div class="field">
        <label>${mode === 'parent' ? t('parents') : t('children')}</label>
        <input id="rel-search-input" placeholder="${t('search_placeholder')}" />
        <input type="hidden" id="rel-search-hidden" />
        <div id="rel-search-results"></div>
      </div>
      ${mode === 'parent' ? `
      <div class="field">
        <label>${t('gender')}: أب أم أم؟</label>
        <select id="rel-role"><option value="father">أب</option><option value="mother">أم</option></select>
      </div>` : `
      <div class="field">
        <label>هذا الشخص هو الأب أم الأم للطفل المحدد؟</label>
        <select id="rel-role"><option value="father">أب</option><option value="mother">أم</option></select>
      </div>`}
      <div class="field">
        <label>نوع العلاقة</label>
        <select id="rel-type">
          <option value="biological">بيولوجية</option>
          <option value="adoptive">تبني</option>
          <option value="step">زوج/ة الأب أو الأم</option>
          <option value="unknown">غير معروفة</option>
        </select>
      </div>
      <div id="rel-alert"></div>
      <div class="btn-row">
        <button class="btn" id="rel-save">${t('save')}</button>
        <button class="btn secondary" id="rel-cancel">${t('cancel')}</button>
      </div>
    </div>
  `;
  personPicker(slot, 'rel-search-input', 'rel-search-hidden', 'rel-search-results');
  document.getElementById('rel-cancel').onclick = () => (slot.innerHTML = '');
  document.getElementById('rel-save').onclick = async () => {
    const otherId = document.getElementById('rel-search-hidden').value;
    if (!otherId) return;
    const role = document.getElementById('rel-role').value;
    const relationType = document.getElementById('rel-type').value;
    const payload = mode === 'parent'
      ? { parent_id: otherId, child_id: personId, parent_role: role, relation_type: relationType }
      : { parent_id: personId, child_id: otherId, parent_role: role, relation_type: relationType };
    try {
      const res = await Api.post('/api/relationships/parent-child', payload);
      if (res.warning) {
        document.getElementById('rel-alert').innerHTML = `<div class="alert warning">${escapeHtml(res.warning)}</div>`;
        setTimeout(() => window.Pages.personView(container, { id: personId }), 1400);
      } else {
        // إعادة رسم البيانات المُحدَّثة فقط عبر استدعاء API جديد، بدل إعادة تحميل الصفحة بالكامل
        await window.Pages.personView(container, { id: personId });
      }
    } catch (err) {
      document.getElementById('rel-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  };
}

function openAddMarriageModal(container, personId) {
  const slot = document.getElementById('modal-slot');
  slot.innerHTML = `
    <div class="card">
      <h3>${t('add_marriage')}</h3>
      <div class="field">
        <label>${t('kinship_person_b')}</label>
        <input id="mar-search-input" placeholder="${t('search_placeholder')}" />
        <input type="hidden" id="mar-search-hidden" />
        <div id="mar-search-results"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>تاريخ البداية</label><input type="date" id="mar-start" /></div>
        <div class="field"><label>الحالة</label>
          <select id="mar-status">
            <option value="married">متزوجان</option>
            <option value="divorced">مطلّقان</option>
            <option value="widowed">ترمّل</option>
            <option value="separated">منفصلان</option>
          </select>
        </div>
      </div>
      <div id="mar-alert"></div>
      <div class="btn-row">
        <button class="btn" id="mar-save">${t('save')}</button>
        <button class="btn secondary" id="mar-cancel">${t('cancel')}</button>
      </div>
    </div>
  `;
  personPicker(slot, 'mar-search-input', 'mar-search-hidden', 'mar-search-results');
  document.getElementById('mar-cancel').onclick = () => (slot.innerHTML = '');
  document.getElementById('mar-save').onclick = async () => {
    const spouseId = document.getElementById('mar-search-hidden').value;
    if (!spouseId) return;
    try {
      await Api.post('/api/marriages', {
        spouse_a_id: personId,
        spouse_b_id: spouseId,
        start_date: document.getElementById('mar-start').value || null,
        status: document.getElementById('mar-status').value,
      });
      // إعادة رسم البيانات المُحدَّثة فقط عبر استدعاء API جديد، بدل إعادة تحميل الصفحة بالكامل
      await window.Pages.personView(container, { id: personId });
    } catch (err) {
      document.getElementById('mar-alert').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  };
}

// ---------------------------------------------------------------- البحث
window.Pages.search = async function (container) {
  container.innerHTML = `
    <h1>${t('nav_search')}</h1>
    <div class="card">
      <div class="field">
        <input id="search-input" placeholder="${t('search_placeholder')}" autofocus />
      </div>
      <div id="search-results"></div>
    </div>
  `;
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    timeout = setTimeout(async () => {
      const res = await Api.get('/api/people/search?q=' + encodeURIComponent(q) + '&limit=40');
      results.innerHTML = res.items.map(personCardHtml).join('') || `<p class="muted">${t('no_results')}</p>`;
      bindPersonRowNav(results);
    }, 250);
  });
};

// ---------------------------------------------------------------- حساب صلة القرابة
window.Pages.kinship = async function (container) {
  container.innerHTML = `
    <h1>${t('nav_kinship')}</h1>
    <div class="card">
      <div class="field">
        <label>${t('kinship_person_a')}</label>
        <input id="ka-input" placeholder="${t('search_placeholder')}" />
        <input type="hidden" id="ka-hidden" />
        <div id="ka-results"></div>
      </div>
      <div class="field">
        <label>${t('kinship_person_b')}</label>
        <input id="kb-input" placeholder="${t('search_placeholder')}" />
        <input type="hidden" id="kb-hidden" />
        <div id="kb-results"></div>
      </div>
      <button class="btn" id="kinship-calc-btn">${t('kinship_calculate')}</button>
    </div>
    <div id="kinship-result"></div>
  `;
  personPicker(container, 'ka-input', 'ka-hidden', 'ka-results');
  personPicker(container, 'kb-input', 'kb-hidden', 'kb-results');
  document.getElementById('kinship-calc-btn').onclick = async () => {
    const a = document.getElementById('ka-hidden').value;
    const b = document.getElementById('kb-hidden').value;
    const resultDiv = document.getElementById('kinship-result');
    if (!a || !b) {
      resultDiv.innerHTML = `<div class="alert warning">يرجى اختيار كلا الشخصين من نتائج البحث.</div>`;
      return;
    }
    resultDiv.innerHTML = `<div class="text-center" style="padding:20px"><span class="spinner"></span></div>`;
    const res = await Api.get(`/api/kinship/compute?person_a=${a}&person_b=${b}`);
    renderKinshipResult(resultDiv, res);
  };
};

function renderKinshipResult(container, res) {
  if (!res.found) {
    container.innerHTML = `<div class="alert info">${escapeHtml(res.message)}</div>`;
    return;
  }
  if (res.samePerson) {
    container.innerHTML = `<div class="alert info">نفس الشخص.</div>`;
    return;
  }
  let html = '';
  if (res.hasMultipleRelations) {
    html += `<div class="alert info">توجد بينهما أكثر من صلة قرابة (${res.relations.length}):</div>`;
  }
  for (const rel of res.relations) {
    html += `
      <div class="result-relation">
        <div class="rel-label">${escapeHtml(res.personB.full_name || res.personB.first_name)} — ${escapeHtml(rel.label)}</div>
        ${rel.degree !== null && rel.degree !== undefined ? `<div class="muted">الدرجة: ${rel.degree}</div>` : ''}
        ${renderPathVisual(rel)}
      </div>
    `;
  }
  container.innerHTML = html;
}

function renderPathVisual(rel) {
  if (!rel.pathFromA && !rel.pathFromB) return '';
  const partsA = (rel.pathFromA || []).slice().reverse();
  const partsB = rel.pathFromB || [];
  let steps = [];
  steps.push({ label: 'الشخص الأول' });
  for (const s of partsA) steps.push({ label: (s.person && (s.person.full_name || s.person.first_name)) + ' (' + s.roleLabel + ')' });
  if (rel.commonAncestorName) steps.push({ label: 'السلف المشترك: ' + rel.commonAncestorName });
  for (const s of partsB.slice().reverse()) steps.push({ label: (s.person && (s.person.full_name || s.person.first_name)) + ' (' + s.roleLabel + ')' });
  steps.push({ label: 'الشخص الثاني' });

  return `<div class="kinship-path">${steps.map((s, i) => `${i > 0 ? '<span class="arrow">←</span>' : ''}<span class="step">${escapeHtml(s.label)}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- شجرة النسب الفردية
window.Pages.tree = async function (container, params) {
  container.innerHTML = `
    <h1>${t('nav_tree')}</h1>
    <div class="card">
      <div class="field">
        <label>عدد الأجيال</label>
        <select id="max-gen-select">
          <option value="2">2</option>
          <option value="3" selected>3</option>
          <option value="4">4</option>
          <option value="6">6</option>
          <option value="10">10</option>
        </select>
      </div>
      <div id="tree-container"></div>
    </div>
  `;
  const draw = async () => {
    const maxGen = document.getElementById('max-gen-select').value;
    const data = await Api.get(`/api/tree/${params.id}?max_gen=${maxGen}`);
    renderTreeSvg(document.getElementById('tree-container'), data, (id) => (location.hash = '#/person/' + id));
  };
  document.getElementById('max-gen-select').onchange = draw;
  await draw();
};

// ---------------------------------------------------------------- العائلات (شجرة مجموعة)
window.Pages.families = async function (container) {
  container.innerHTML = `
    <h1>${t('nav_families')}</h1>
    <div class="card">
      <p class="muted">اختر عدة أشخاص لبناء شبكة القرابة التي تربطهم.</p>
      <div class="field">
        <input id="group-input" placeholder="${t('search_placeholder')}" />
        <div id="group-results"></div>
      </div>
      <div id="group-selected" class="btn-row"></div>
      <div class="field" style="margin-top:10px;">
        <label>الحد الأقصى للأجيال</label>
        <select id="group-max-gen">
          <option value="3">3</option>
          <option value="5" selected>5</option>
          <option value="10">10</option>
          <option value="20">بدون حد تقريبًا</option>
        </select>
      </div>
      <button class="btn" id="group-build-btn">إنشاء شجرة المجموعة</button>
    </div>
    <div id="group-tree-container"></div>
  `;
  const selected = new Map();
  const input = document.getElementById('group-input');
  const results = document.getElementById('group-results');
  const selectedDiv = document.getElementById('group-selected');

  function renderSelected() {
    selectedDiv.innerHTML = [...selected.entries()]
      .map(([id, name]) => `<span class="badge" style="background:#e6f4f2;color:#0a5c50;padding:6px 10px;">${escapeHtml(name)} <a href="#" data-remove="${id}" style="color:#c0392b;">×</a></span>`)
      .join('');
    selectedDiv.querySelectorAll('[data-remove]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        selected.delete(el.getAttribute('data-remove'));
        renderSelected();
      });
    });
  }

  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    timeout = setTimeout(async () => {
      const res = await Api.get('/api/people/search?q=' + encodeURIComponent(q));
      results.innerHTML = res.items.map((p) => `<div class="person-row" data-add="${p.id}" data-name="${escapeHtml(p.full_name || p.first_name)}">${personCardHtml(p)}</div>`).join('');
      results.querySelectorAll('[data-add]').forEach((el) => {
        el.addEventListener('click', () => {
          selected.set(el.getAttribute('data-add'), el.getAttribute('data-name'));
          renderSelected();
          results.innerHTML = '';
          input.value = '';
        });
      });
    }, 250);
  });

  document.getElementById('group-build-btn').onclick = async () => {
    if (selected.size < 2) {
      alert('يرجى اختيار شخصين على الأقل.');
      return;
    }
    const maxGen = document.getElementById('group-max-gen').value;
    const data = await Api.post('/api/tree/group', { person_ids: [...selected.keys()], max_gen: Number(maxGen) });
    const treeData = {
      rootId: [...selected.keys()][0],
      persons: data.persons,
      edges: data.edges,
      marriages: [],
      ancestorDistances: {},
      descendantDistances: {},
    };
    // ترتيب بسيط: استخدم عرض شجرة فردي حول أول شخص محدد لتبسيط العرض
    const single = await Api.get(`/api/tree/${[...selected.keys()][0]}?max_gen=${maxGen}`);
    renderTreeSvg(document.getElementById('group-tree-container'), single, (id) => (location.hash = '#/person/' + id));
  };
};

// ---------------------------------------------------------------- الاستيراد والتصدير
window.Pages.importExport = async function (container) {
  container.innerHTML = `
    <h1>${t('nav_import_export')}</h1>
    <div class="card">
      <h2>${t('export_title')}</h2>
      <div class="btn-row">
        <button class="btn" id="export-json-btn">تصدير JSON</button>
        <button class="btn secondary" id="export-csv-btn">تصدير CSV</button>
      </div>
    </div>
    <div class="card">
      <h2>${t('import_title')}</h2>
      <p class="muted">ملف CSV بترويسة: local_id, first_name, father_name, grandfather_name, family_name, gender, birth_date, death_date, life_status, birth_place, death_place, notes, father_local_id, mother_local_id</p>
      <div class="field"><input type="file" id="import-file" accept=".csv,.json" /></div>
      <div id="import-preview"></div>
      <div class="btn-row">
        <button class="btn secondary" id="preview-btn">معاينة قبل الاستيراد</button>
        <button class="btn" id="commit-btn" disabled>تأكيد الاستيراد</button>
      </div>
    </div>
  `;

  async function downloadExport(format) {
    // نجلب الملف عبر fetch مع رأس Authorization العادي (بدون وضع رمز الجلسة في الرابط/العنوان مطلقًا)،
    // ثم ننشئ رابط تنزيل محلي مؤقت (Blob) — هذا يمنع تسرّب رمز الجلسة عبر سجل المتصفح أو سجلات الخادم.
    const res = await fetch(`/api/export?format=${format}`, {
      headers: { Authorization: 'Bearer ' + Api.getToken() },
    });
    if (!res.ok) {
      alert('تعذّر التصدير. حاول مرة أخرى.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silah-export.${format === 'csv' ? 'csv' : 'json'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  document.getElementById('export-json-btn').onclick = () => downloadExport('json');
  document.getElementById('export-csv-btn').onclick = () => downloadExport('csv');

  let fileContent = null;
  let fileFormat = null;
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileContent = await file.text();
    fileFormat = file.name.endsWith('.json') ? 'json' : 'csv';
    document.getElementById('commit-btn').disabled = true;
  });

  document.getElementById('preview-btn').onclick = async () => {
    if (!fileContent) return;
    const body = fileFormat === 'csv' ? { format: 'csv', content: fileContent } : { persons: JSON.parse(fileContent).persons || JSON.parse(fileContent) };
    const res = await Api.post('/api/import/preview', body);
    const previewDiv = document.getElementById('import-preview');
    previewDiv.innerHTML = `
      <div class="alert ${res.can_import ? 'success' : 'error'}">
        إجمالي السجلات: ${res.total_records} — صالحة: ${res.valid_records} — أخطاء: ${res.errors.length}
      </div>
      ${res.errors.length ? `<ul>${res.errors.slice(0, 20).map((e) => `<li>سطر ${e.line}: ${escapeHtml(e.error)}</li>`).join('')}</ul>` : ''}
      ${res.possible_duplicates.length ? `<div class="alert warning">تحذير: ${res.possible_duplicates.length} سجل قد يكون مكررًا لأشخاص موجودين.</div>` : ''}
    `;
    document.getElementById('commit-btn').disabled = !res.can_import;
    document.getElementById('commit-btn').onclick = async () => {
      const commitRes = await Api.post('/api/import/commit', body);
      previewDiv.innerHTML += `<div class="alert success">تم استيراد ${commitRes.imported} سجل بنجاح.</div>`;
    };
  };
};
