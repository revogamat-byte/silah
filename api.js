'use strict';

const Api = (() => {
  function getToken() {
    return localStorage.getItem('silah_token');
  }
  function setToken(token) {
    if (token) localStorage.setItem('silah_token', token);
    else localStorage.removeItem('silah_token');
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('silah_user') || 'null');
    } catch (e) {
      return null;
    }
  }
  function setUser(user) {
    if (user) localStorage.setItem('silah_user', JSON.stringify(user));
    else localStorage.removeItem('silah_user');
  }

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'حدث خطأ');
      err.status = res.status;
      err.data = data;
      if (res.status === 401) {
        setToken(null);
        setUser(null);
      }
      throw err;
    }
    return data;
  }

  return {
    getToken, setToken, getUser, setUser,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    delete: (p) => call('DELETE', p),
    isLoggedIn: () => !!getToken(),
  };
})();
