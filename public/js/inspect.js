/* 监管老师检查页逻辑 */
(async function () {
  const user = await FS.requireRole('inspector');
  if (!user) return;

  document.getElementById('btnLogout').addEventListener('click', FS.logout);

  // 单位列表
  let units = [];
  async function loadUnits(selected) {
    const data = await FS.api('/api/units');
    units = data.units;
    const dl = document.getElementById('unitList');
    dl.innerHTML = units.map((u) => `<option value="${FS.esc(u.name)}"></option>`).join('');
    if (selected) document.getElementById('unitInput').value = selected;
  }
  await loadUnits(localStorage.getItem('fs_last_unit') || '');

  // 记住检查人 / 单位
  const inspectorEl = document.getElementById('inspector');
  inspectorEl.value = localStorage.getItem('fs_last_inspector') || '';

  const dateEl = document.getElementById('inspectDate');
  dateEl.value = FS.today();

  // 上限展示（由后端配置决定；前端用约定值，提交时后端再兜底）
  const MAX_N = 10, MAX_MB = 8;
  document.getElementById('maxN').textContent = MAX_N;
  document.getElementById('maxMb').textContent = MAX_MB;

  /** 待提交条目：{file, url, location, category, description, severity} */
  const items = [];

  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnPick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    for (const file of Array.from(fileInput.files)) await addItem(file);
    fileInput.value = '';
    render();
  });

  async function addItem(file) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
      FS.toast(`「${file.name}」不是支持的图片格式`, 'error');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      FS.toast(`「${file.name}」超过 ${MAX_MB}MB，已忽略`, 'error');
      return;
    }
    if (items.length >= MAX_N) {
      FS.toast(`最多 ${MAX_N} 张`, 'error');
      return;
    }
    items.push({
      file,
      filename: file.name,
      url: URL.createObjectURL(file),
      location: '', category: '环境卫生', description: '', severity: '一般',
    });
  }

  const CATS = ['环境卫生', '食材存储', '加工操作', '餐具消毒', '人员管理', '设施设备', '其他'];
  const SEVS = ['一般', '较重', '严重'];

  function render() {
    const box = document.getElementById('photoList');
    if (items.length === 0) {
      box.innerHTML = '<p class="muted">尚未选择图片。</p>';
      return;
    }
    box.innerHTML = items.map((it, idx) => `
      <div class="photo-row" data-idx="${idx}">
        <div class="thumb">
          <img class="zoomable" src="${it.url}" alt="问题图">
          <button type="button" class="rm" data-act="del" title="移除">×</button>
        </div>
        <div class="photo-fields">
          <div>
            <label>具体位置</label>
            <input type="text" data-f="location" maxlength="100"
                   placeholder="如：后厨/面点间/留样柜" value="${FS.esc(it.location)}">
          </div>
          <div>
            <label>问题类别</label>
            <select data-f="category">
              ${CATS.map((c) => `<option ${c === it.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>严重程度</label>
            <select data-f="severity">
              ${SEVS.map((c) => `<option ${c === it.severity ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="full">
            <label>问题描述</label>
            <textarea data-f="description" maxlength="2000"
              placeholder="如：地面有积水、留样柜温度 12℃ 不达标…">${FS.esc(it.description)}</textarea>
          </div>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => {
        const idx2 = +el.closest('.photo-row').dataset.idx;
        items[idx2][el.dataset.f] = el.value;
      });
    });
    box.querySelectorAll('[data-act=del]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx2 = +b.closest('.photo-row').dataset.idx;
        URL.revokeObjectURL(items[idx2].url);
        items.splice(idx2, 1);
        render();
      });
    });
  }
  render();
  FS.bindLightbox(document.getElementById('photoList'));

  /* ---------------- 提交 ---------------- */
  const btnSubmit = document.getElementById('btnSubmit');
  btnSubmit.addEventListener('click', async () => {
    const unitName = document.getElementById('unitInput').value.trim();
    const inspectDate = dateEl.value;
    const inspector = inspectorEl.value.trim();
    if (!unitName) return FS.toast('请选择或输入受检单位', 'error');
    if (!inspectDate) return FS.toast('请选择检查日期', 'error');
    if (items.length === 0) return FS.toast('请先添加问题图片', 'error');

    const fd = new FormData();
    items.forEach((it) => fd.append('photos', it.file, it.filename));
    fd.append('meta', JSON.stringify({
      unitName, inspectDate, inspector,
      items: items.map((it) => ({
        filename: it.filename, location: it.location,
        category: it.category, description: it.description, severity: it.severity,
      })),
    }));

    btnSubmit.disabled = true;
    btnSubmit.textContent = '提交中…';
    try {
      const data = await FS.api('/api/inspector/issues', { method: 'POST', body: fd });
      FS.toast(`已生成 ${data.created.length} 个整改 key`, 'ok');
      localStorage.setItem('fs_last_unit', unitName);
      localStorage.setItem('fs_last_inspector', inspector);
      showResult(data);
      items.forEach((it) => URL.revokeObjectURL(it.url));
      items.length = 0;
      render();
      loadUnits(unitName);
      loadHistory();
    } catch (err) {
      FS.toast(err.status === 401 ? '登录已过期，请重新登录' : err.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = '✅ 提交检查，生成二维码';
    }
  });

  function showResult(data) {
    const card = document.getElementById('resultCard');
    const grid = document.getElementById('qrGrid');
    document.getElementById('resultCount').textContent = data.created.length;
    grid.innerHTML = data.created.map((c, i) => `
      <div class="qr-item">
        <img class="qr" src="${c.qr}" alt="二维码">
        <div class="k">${FS.esc(c.key)}</div>
        <div class="muted">${FS.esc(data.unit)} · ${FS.esc(data.inspectDate)}</div>
        <div class="muted">图 ${i + 1}/${data.created.length}</div>
      </div>`).join('');

    // key 清单 CSV
    const rows = [['key', '整改链接', '单位', '检查日期'],
      ...data.created.map((c) => [c.key, c.rectifyUrl, data.unit, data.inspectDate])];
    const csv = '﻿' + rows.map((r) => r.map((x) => {
      const s = String(x);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const a = document.getElementById('csvLink');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `整改key清单_${data.inspectDate}.csv`;
    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------------- 历史记录 ---------------- */
  async function loadHistory() {
    const tbody = document.getElementById('historyBody');
    try {
      const { issues } = await FS.api('/api/inspector/issues');
      if (!issues.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="muted">暂无记录</td></tr>';
        return;
      }
      tbody.innerHTML = issues.slice(0, 50).map((i) => `
        <tr>
          <td>${FS.esc(i.inspectDate)}</td>
          <td>${FS.esc(i.unitName)}</td>
          <td>${FS.esc(i.location || '-')}</td>
          <td>${FS.esc(i.category || '-')}</td>
          <td>${i.problemImages.map((p) =>
            `<img class="mini-img zoomable" src="${FS.esc(p.url)}">`).join('')}</td>
          <td><code><b>${FS.esc(i.key)}</b></code></td>
          <td>${FS.statusTag(i.status)}</td>
          <td>${FS.esc(i.rectifiedAt || '-')}</td>
        </tr>`).join('');
    } catch {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">加载失败</td></tr>';
    }
  }
  FS.bindLightbox(document.getElementById('historyBody'));
  loadHistory();
})();
