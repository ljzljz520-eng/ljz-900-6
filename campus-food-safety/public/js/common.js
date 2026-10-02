/* 公共工具函数 */

function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

async function api(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
  if (!res.ok) throw new Error((data && data.error) || `请求失败 (${res.status})`);
  return data;
}

/* 客户端压缩图片：最长边 maxDim，输出 JPEG，减小上传流量与存储占用 */
async function compressImage(file, maxDim = 1600, quality = 0.82) {
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return file; // 压缩失败则退回原文件
  return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* 简易图片灯箱 */
function openLightbox(src) {
  let lb = document.querySelector('.lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = '<img alt="大图">';
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
  lb.classList.add('open');
}
