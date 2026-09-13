/* 校领导汇总页：按检查日期 / 单位筛选，统计 + 明细 + CSV 导出 */
(async function () {
  const user = await FS.requireRole('admin');
  if (!user) return;
  document.getElementById('btnLogout').addEventListener('click', FS.logout);

  const form = document.getElementById('filterForm');

  // 默认筛选最近 30 天
  const fromEl = form.from, toEl = form.to;
  toEl.value = FS.today();
  const d = new Date(); d.setDate(d.getDate() - 29);
  fromEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 单位下拉
  const { units } = await FS.api('/api/units');
  document.getElementById('unitSelect').insertAdjacentHTML('beforeend',
    units.map((u) => `<option value="${u.id}">${FS.esc(u.name)}</option>`).join(''));

  function getQuery() {
    const p = new URLSearchParams();
    if (form.from.value) p.set('from', form.from.value);
    if (form.to.value) p.set('to', form.to.value);
    if (form.unitId.value) p.set('unitId', form.unitId.value);
    if (form.status.value) p.set('status', form.status.value);
    return p;
  }

  async function load() {
    const qs = getQuery().toString();
    document.getElementById('btnExport').href = '/api/admin/export.csv?' + qs;
    const data = await FS.api('/api/admin/summary?' + qs);

    document.getElementById('sTotal').textContent = data.stats.total;
    document.getElementById('sDone').textContent = data.stats.done;
    document.getElementById('sPending').textContent = data.stats.pending;
    document.getElementById('sRate').textContent = data.stats.rate + '%';

    document.getElementById('unitBody').innerHTML = data.byUnit.length
      ? data.byUnit.map((u) => {
          const rate = u.total ? Math.round(u.done / u.total * 100) : 0;
          return `<tr>
            <td>${FS.esc(u.unitName)}</td><td>${u.total}</td>
            <td style="color:var(--ok)">${u.done}</td>
            <td style="color:var(--warn)">${u.pending}</td>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="bar"><span style="width:${rate}%"></span></div>${rate}%</div></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="muted">无数据</td></tr>';

    const total = data.stats.total || 0;
    document.getElementById('catBody').innerHTML = data.byCategory.length
      ? data.byCategory.map((c) => `<tr>
          <td>${FS.esc(c.category)}</td><td>${c.n}</td>
          <td>${total ? Math.round(c.n / total * 1000) / 10 : 0}%</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="muted">无数据</td></tr>';

    document.getElementById('listCount').textContent = data.issues.length;
    document.getElementById('listBody').innerHTML = data.issues.length
      ? data.issues.map((i) => `
        <tr>
          <td style="white-space:nowrap">${FS.esc(i.inspectDate)}</td>
          <td>${FS.esc(i.unitName)}</td>
          <td>${FS.esc(i.location || '-')}</td>
          <td>${FS.esc(i.category || '-')}</td>
          <td><span class="tag sev-${FS.esc(i.severity)}">${FS.esc(i.severity)}</span></td>
          <td>${FS.esc(i.description || '-')}<br>
            <span class="muted">检查人：${FS.esc(i.inspector || '-')} · key：<code>${FS.esc(i.key)}</code></span></td>
          <td>${i.problemImages.map((p) =>
            `<img class="mini-img zoomable" src="${FS.esc(p.url)}">`).join('') || '-'}</td>
          <td>${FS.statusTag(i.status)}
            ${i.rectifiedAt ? `<div class="muted">${FS.esc(i.rectifiedAt)}<br>${FS.esc(i.rectifyContact || '')}</div>` : ''}
            ${i.rectifyNote ? `<div class="muted">${FS.esc(i.rectifyNote)}</div>` : ''}</td>
          <td>${i.rectifyImages.map((p) =>
            `<img class="mini-img zoomable" src="${FS.esc(p.url)}">`).join('') || '-'}</td>
        </tr>`).join('')
      : '<tr><td colspan="9" class="muted">当前筛选条件下无记录</td></tr>';

    FS.bindLightbox(document.getElementById('listBody'));
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); load().catch((err) => FS.toast(err.message, 'error')); });
  document.getElementById('btnReset').addEventListener('click', () => {
    form.reset();
    form.unitId.value = ''; form.status.value = '';
    toEl.value = FS.today();
    load().catch((err) => FS.toast(err.message, 'error'));
  });
  load().catch((err) => FS.toast(err.message, 'error'));
})();
