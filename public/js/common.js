/* 公共前端工具 */
window.FS = (function () {
  async function api(url, opts = {}) {
    const init = { headers: {}, ...opts };
    if (init.body && !(init.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `请求失败 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer = null;
  function toast(msg, type = '') {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 图片灯箱（事件委托，给容器调用即可） */
  function bindLightbox(container) {
    container.addEventListener('click', (e) => {
      const img = e.target.closest('img.zoomable');
      if (!img) return;
      let box = document.querySelector('.lightbox');
      if (!box) {
        box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = '<img alt="预览">';
        box.addEventListener('click', () => box.classList.remove('show'));
        document.body.appendChild(box);
      }
      box.querySelector('img').src = img.src;
      box.classList.add('show');
    });
  }

  /** 页面鉴权：不符合角色则跳转登录页 */
  async function requireRole(role) {
    const { user } = await api('/api/me');
    if (!user || (role && user.role !== role)) {
      location.href = '/login.html?role=' + encodeURIComponent(role || '') +
        '&next=' + encodeURIComponent(location.pathname + location.search);
      return null;
    }
    return user;
  }

  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    location.href = '/index.html';
  }

  function statusTag(status) {
    return status === '已整改'
      ? '<span class="tag done">已整改</span>'
      : '<span class="tag pending">待整改</span>';
  }

  return { api, toast, esc, today, bindLightbox, requireRole, logout, statusTag };
})();
