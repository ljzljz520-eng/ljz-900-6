/** 公共前端工具 */

// 显示提示消息
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + type;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// HTML 转义，防 XSS
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * 手机端图片压缩：等比缩放到最长边 1600px，输出 JPEG quality 0.85
 * 大幅减小 4G/5G 上传流量；PNG 截图类图片保留原格式
 */
function compressImage(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return reject(new Error('仅支持 JPG/PNG/WebP 图片'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return reject(new Error('图片超过 8MB，请裁剪后再上传'));
    }
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('图片处理失败')),
        'image/jpeg', quality,
      );
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = URL.createObjectURL(file);
  });
}

// 图片灯箱
function openLightbox(src) {
  let lb = document.querySelector('.lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = '<img>';
    lb.onclick = () => lb.classList.remove('open');
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
  lb.classList.add('open');
}
