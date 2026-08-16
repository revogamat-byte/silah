'use strict';

window.SILAH_LANG = localStorage.getItem('silah_lang') || 'ar';

function applyLangToDocument() {
  const lang = window.SILAH_LANG;
  const dict = window.SILAH_I18N[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = dict.dir;
  document.body.dir = dict.dir;
  document.title = dict.app_name + ' — ' + dict.tagline;
}

const ROUTES = {
  '#/login': { page: 'login', public: true },
  '#/register': { page: 'register', public: true },
  '#/dashboard': { page: 'dashboard' },
  '#/add-person': { page: 'addPerson' },
  '#/search': { page: 'search' },
  '#/kinship': { page: 'kinship' },
  '#/families': { page: 'families' },
  '#/import-export': { page: 'importExport' },
};

function matchRoute(hash) {
  if (ROUTES[hash]) return { ...ROUTES[hash], params: {} };
  let m = hash.match(/^#\/person\/([^/]+)$/);
  if (m) return { page: 'personView', params: { id: m[1] } };
  m = hash.match(/^#\/person\/([^/]+)\/edit$/);
  if (m) return { page: 'editPerson', params: { id: m[1] } };
  m = hash.match(/^#\/tree\/([^/]+)$/);
  if (m) return { page: 'tree', params: { id: m[1] } };
  return null;
}

const NAV_ITEMS = [
  { route: '#/dashboard', icon: '🏠', label: 'nav_dashboard' },
  { route: '#/search', icon: '🔍', label: 'nav_search' },
  { route: '#/add-person', icon: '➕', label: 'nav_add_person' },
  { route: '#/kinship', icon: '🔗', label: 'nav_kinship' },
  { route: '#/families', icon: '🌳', label: 'nav_families' },
  { route: '#/import-export', icon: '📁', label: 'nav_import_export' },
];

function renderShell() {
  const navSlot = document.getElementById('nav-slot');
  const topbarSlot = document.getElementById('topbar-slot');

  if (!Api.isLoggedIn()) {
    navSlot.innerHTML = '';
    topbarSlot.innerHTML = '';
    return;
  }

  const currentHash = location.hash || '#/dashboard';
  navSlot.innerHTML = `
    <nav class="bottom-nav">
      ${NAV_ITEMS.map(
        (item) => `
        <a href="${item.route}" class="${currentHash.startsWith(item.route) ? 'active' : ''}">
          <span class="icon">${item.icon}</span>
          <span>${t(item.label)}</span>
        </a>`
      ).join('')}
    </nav>
  `;

  const user = Api.getUser();
  topbarSlot.innerHTML = `
    <div class="topbar">
      <a href="#/dashboard" class="brand"><span class="logo-mark">ص</span> ${t('app_name')}</a>
      <div class="topbar-actions">
        <button class="lang-switch" id="lang-btn">${window.SILAH_LANG === 'ar' ? 'EN' : 'AR'}</button>
        <span class="muted" style="display:none" id="user-name-slot"></span>
        <button class="btn secondary" id="logout-btn">${t('nav_logout')}</button>
      </div>
    </div>
  `;
  if (user) {
    const slot = document.getElementById('user-name-slot');
    slot.style.display = 'inline';
    slot.textContent = user.name;
  }
  document.getElementById('logout-btn').onclick = async () => {
    try { await Api.post('/api/auth/logout'); } catch (e) {}
    Api.setToken(null);
    Api.setUser(null);
    location.hash = '#/login';
  };
  document.getElementById('lang-btn').onclick = () => {
    window.SILAH_LANG = window.SILAH_LANG === 'ar' ? 'en' : 'ar';
    localStorage.setItem('silah_lang', window.SILAH_LANG);
    applyLangToDocument();
    render();
  };
}

async function render() {
  applyLangToDocument();
  const hash = location.hash || '#/dashboard';
  const match = matchRoute(hash);
  const content = document.getElementById('page-content');

  if (!match) {
    content.innerHTML = `<div class="card text-center">404</div>`;
    return;
  }

  if (!match.public && !Api.isLoggedIn()) {
    location.hash = '#/login';
    return;
  }
  if (match.public && Api.isLoggedIn() && (match.page === 'login' || match.page === 'register')) {
    location.hash = '#/dashboard';
    return;
  }

  renderShell();

  const pageFn = window.Pages[match.page];
  if (!pageFn) {
    content.innerHTML = `<div class="card text-center">صفحة غير موجودة</div>`;
    return;
  }
  content.innerHTML = `<div class="text-center" style="padding:60px 0"><span class="spinner"></span></div>`;
  try {
    await pageFn(content, match.params);
  } catch (e) {
    console.error(e);
    if (e.status === 401) {
      location.hash = '#/login';
      return;
    }
    content.innerHTML = `<div class="alert error">${e.message || 'حدث خطأ غير متوقع.'}</div>`;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) location.hash = Api.isLoggedIn() ? '#/dashboard' : '#/login';
  render();
});
