/* 食堂负责人整改页：凭 key 查看问题、上传整改图 */
(function () {
  const keyEl = document.getElementById('keyInput');
  const detailCard = document.getElementById('detailCard');

  function normalizeKey(k) {
    return String(k || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  async function openIssue(key) {
    key = normalizeKey(key);
    if (key.length !== 8) return FS.toast('请输入 8 位 key', 'error');
    keyEl.value = key;
    history.replaceState(null, '', '/rectify.html?key=' + encodeURIComponent(key));
    try {
      const { issue } = await FS.api('/api/rectify/' + encodeURIComponent(key));
      renderDetail(issue);
    } catch (err) {
      detailCard.classList.add('hidden');
      FS.toast(err.message, 'error');
    }
  }

  document.getElementById('btnGo').addEventListener('click', () => openIssue(keyEl.value));
  keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openIssue(keyEl.value); });
  keyEl.addEventListener('input', () => { keyEl.value = normalizeKey(keyEl.value); });

  /* ---------- 渲染问题详情 ---------- */
  function renderDetail(i) {
    const done = i.status === '已整改';
    detailCard.classList.remove('hidden');
    document.getElementById('detailBody').innerHTML = `
      <div class="grid grid-3" style="margin-bottom:14px">
        <div><div class="muted">受检单位</div><b>${FS.esc(i.unitName)}</b></div>
        <div><div class="muted">检查日期</div><b>${FS.esc(i.inspectDate)}</b></div>
        <div><div class="muted">状态</div>${FS.statusTag(i.status)}</div>
        <div><div class="muted">位置</div><b>${FS.esc(i.location || '-')}</b></div>
        <div><div class="muted">类别 / 严重程度</div><b>${FS.esc(i.category || '-')}
          <span class="tag sev-${FS.esc(i.severity)}">${FS.esc(i.severity)}</span></b></div>
        <div><div class="muted">检查人</div><b>${FS.esc(i.inspector || '-')}</b></div>
      </div>
      <div style="margin-bottom:14px">
        <div class="muted">问题描述</div>
        <div>${FS.esc(i.description || '（无描述，以照片为准）').replace(/\n/g, '<br>')}</div>
      </div>
      <div style="margin-bottom:16px">
        <div class="muted">问题照片（${i.problemImages.length} 张）</div>
        ${i.problemImages.map((p) =>
          `<img class="mini-img zoomable" style="width:120px;height:120px" src="${FS.esc(p.url)}">`).join('')}
      </div>
      ${done ? doneBlock(i) : formBlock(i)}`;
    FS.bindLightbox(detailCard);

    if (!done) bindForm(i.key);
  }

  function doneBlock(i) {
    return `
      <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:16px">
        <b style="color:#166534">✅ 该问题已于 ${FS.esc(i.rectifiedAt || '')} 完成整改提交</b>
        ${i.rectifyNote ? `<p style="margin:8px 0 0">整改说明：${FS.esc(i.rectifyNote)}</p>` : ''}
        ${i.rectifyContact ? `<p class="muted" style="margin:4px 0 10px">提交人：${FS.esc(i.rectifyContact)}</p>` : ''}
        <div class="muted">整改照片（${i.rectifyImages.length} 张）</div>
        ${i.rectifyImages.map((p) =>
          `<img class="mini-img zoomable" style="width:120px;height:120px" src="${FS.esc(p.url)}">`).join('')}
      </div>`;
  }

  function formBlock(i) {
    return `
      <div style="border-top:2px dashed #e5e7eb;padding-top:16px">
        <h2 style="margin-top:0">第三步：拍摄整改后照片（1–4 张，单张 ≤8MB）</h2>
        <input type="file" id="rFile" accept="image/jpeg,image/png,image/gif,image/webp"
               multiple capture="environment" class="hidden">
        <button class="btn" id="rPick" type="button">📷 拍照 / 选择整改图</button>
        <div id="rList" style="margin-top:12px"></div>
        <div class="grid grid-2" style="margin-top:14px">
          <div>
            <label>整改负责人 / 联系电话 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="rContact" maxlength="100" placeholder="如：张经理 138xxxx">
          </div>
          <div>
            <label>整改说明</label>
            <input type="text" id="rNote" maxlength="1000" placeholder="如：已疏通地漏并消毒">
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn" id="rSubmit" type="button">✅ 确认提交整改</button>
          <span class="muted">提交后状态变为「已整改」，校领导汇总页实时可见。</span>
        </div>
      </div>`;
  }

  const MAX_N = 4, MAX_MB = 8;
  let rectFiles = [];

  function bindForm(key) {
    rectFiles = [];
    const fileEl = document.getElementById('rFile');
    document.getElementById('rPick').addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      for (const f of Array.from(fileEl.files)) {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { FS.toast(`${f.name} 格式不支持`, 'error'); continue; }
        if (f.size > MAX_MB * 1024 * 1024) { FS.toast(`${f.name} 超过 ${MAX_MB}MB`, 'error'); continue; }
        if (rectFiles.length >= MAX_N) { FS.toast(`最多 ${MAX_N} 张`, 'error'); break; }
        rectFiles.push({ file: f, url: URL.createObjectURL(f) });
      }
      fileEl.value = '';
      renderRectFiles();
    });

    function renderRectFiles() {
      const box = document.getElementById('rList');
      if (!rectFiles.length) { box.innerHTML = '<p class="muted">尚未选择整改照片。</p>'; return; }
      box.innerHTML = rectFiles.map((r, idx) => `
        <span style="display:inline-block;position:relative;margin:4px">
          <img class="zoomable" src="${r.url}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">
          <button type="button" data-rm="${idx}"
            style="position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;
            border:none;background:#dc2626;color:#fff;cursor:pointer">×</button>
        </span>`).join('');
      box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        URL.revokeObjectURL(rectFiles[+b.dataset.rm].url);
        rectFiles.splice(+b.dataset.rm, 1);
        renderRectFiles();
      }));
    }
    renderRectFiles();

    document.getElementById('rSubmit').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const contact = document.getElementById('rContact').value.trim();
      const note = document.getElementById('rNote').value.trim();
      if (rectFiles.length === 0) return FS.toast('请至少上传 1 张整改照片', 'error');
      if (!contact) return FS.toast('请填写整改负责人/联系方式', 'error');

      const fd = new FormData();
      rectFiles.forEach((r) => fd.append('photos', r.file));
      fd.append('contact', contact);
      fd.append('note', note);

      btn.disabled = true; btn.textContent = '提交中…';
      try {
        await FS.api('/api/rectify/' + encodeURIComponent(key), { method: 'POST', body: fd });
        FS.toast('整改已提交，感谢配合！', 'ok');
        rectFiles.forEach((r) => URL.revokeObjectURL(r.url));
        await openIssue(key);
      } catch (err) {
        FS.toast(err.message, 'error');
        btn.disabled = false; btn.textContent = '✅ 确认提交整改';
      }
    });
  }

  /* ---------- 摄像头扫码（BarcodeDetector，失败则提示手输） ---------- */
  const scanHint = document.getElementById('scanHint');
  if (!('BarcodeDetector' in window)) {
    scanHint.textContent = '当前浏览器不支持网页扫码，请直接输入 key（微信/系统相机扫码也可打开本页）。';
  }
  document.getElementById('btnScan').addEventListener('click', async () => {
    const video = document.getElementById('scanVideo');
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
      return FS.toast('该浏览器不支持扫码，请手动输入 key', 'error');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      video.srcObject = stream;
      video.classList.remove('hidden');
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      scanHint.textContent = '将二维码对准取景框…';
      let stopped = false;
      const timer = setInterval(async () => {
        if (stopped || video.readyState < 2) return;
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length) {
          let val = codes[0].rawValue || '';
          const m = val.match(/[?&]key=([A-Z0-9]{8})/i);
          if (m) val = m[1];
          val = normalizeKey(val);
          if (val.length === 8) {
            stopped = true; clearInterval(timer);
            stream.getTracks().forEach((t) => t.stop());
            video.classList.add('hidden');
            openIssue(val);
          }
        }
      }, 500);
      setTimeout(() => {
        if (!stopped) { stopped = true; clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); video.classList.add('hidden'); }
      }, 60000);
    } catch {
      FS.toast('无法打开摄像头（需 HTTPS 且授权），可手动输入 key', 'error');
    }
  });

  /* 支持 ?key= 直接进入 */
  const q = new URLSearchParams(location.search);
  if (q.get('key')) openIssue(q.get('key'));
})();
