'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/** 生成人类可读的整改 key，如 K7X9-M2PQ-4R8W（去掉易混淆字符 0/O/1/I） */
function genKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** 通过文件头魔数判断真实图片类型，防止伪装扩展名上传 */
function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp' };
  }
  return null;
}

/**
 * 把图片 buffer 写入 uploads/<kind>/YYYY-MM/<随机名>.<ext>
 * @param {'problems'|'rectifications'} kind
 * @returns 相对 uploads/ 的路径，如 problems/2026-10/ab12cd.jpg
 */
function saveImage(kind, buf) {
  const type = sniffImageType(buf);
  if (!type) {
    const err = new Error('文件不是有效的 JPG/PNG/WebP 图片');
    err.status = 400;
    throw err;
  }
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dir = path.join(config.uploadDir, kind, month);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + type.ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return `${kind}/${month}/${name}`;
}

/** 删除一张已存储的图片（失败不抛错） */
function removeImage(relPath) {
  try {
    const abs = path.join(config.uploadDir, relPath);
    if (abs.startsWith(config.uploadDir)) fs.unlinkSync(abs);
  } catch (_) { /* ignore */ }
}

/** 简易内存限流器：key -> 时间戳数组 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length === 0) hits.delete(k); else hits.set(k, kept);
    }
  }, windowMs).unref();

  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}

module.exports = { genKey, sniffImageType, saveImage, removeImage, createRateLimiter };
