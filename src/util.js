'use strict';
/**
 * 通用工具：时间常量比较、审计日志、key 生成、图片校验、二维码、路径转换。
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('./db');
const config = require('./config');

/** 防止登录接口时序攻击的常量耗时字符串比较 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 长度不同也做一次等长比较，避免提前返回
    timingSafeEqualPad(ba, bb);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
function timingSafeEqualPad(ba, bb) {
  const len = Math.max(ba.length, bb.length);
  crypto.timingSafeEqual(
    Buffer.concat([ba, Buffer.alloc(len)]).subarray(0, len),
    Buffer.concat([bb, Buffer.alloc(len)]).subarray(0, len)
  );
}

/** 生成 8 位整改 key（去掉易混字符 0/O/1/I/L），并保证库内唯一 */
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genIssueKey() {
  const find = db.prepare('SELECT 1 FROM issues WHERE issue_key = ?');
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(8);
    let key = '';
    for (let i = 0; i < 8; i++) key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
    if (!find.get(key)) return key;
  }
  throw new Error('issue key 生成冲突，请重试');
}

/** 操作审计 */
const stmtLog = db.prepare(
  'INSERT INTO audit_logs(role, action, detail, ip) VALUES (?,?,?,?)'
);
function audit(role, action, detail, ip) {
  try {
    stmtLog.run(role || null, action, detail ? String(detail).slice(0, 1000) : null, ip || null);
  } catch (_) { /* 日志失败不影响主流程 */ }
}

/**
 * 魔数校验：防止伪造扩展名上传非图片。
 * 支持 jpg/png/gif/webp，返回标准扩展名；不合法返回 null。
 */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}

/** 物理路径 -> 相对 URL 路径，如 /uploads/2026/09/xxx.jpg */
function toRelUrl(absPath) {
  const rel = path.relative(config.UPLOAD_DIR, absPath).split(path.sep).join('/');
  return '/uploads/' + rel;
}

/** 生成整改页面链接 */
function rectifyUrl(req, key) {
  const base = config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/rectify.html?key=${encodeURIComponent(key)}`;
}

/** 生成二维码 dataURL（PNG base64），失败返回 null（不影响主流程） */
async function qrDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 320,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' },
    });
  } catch (_) {
    return null;
  }
}

/** 统一的问题单输出映射（含图片数组解析、二维码按需附加） */
function mapIssue(row, extra = {}) {
  if (!row) return null;
  let unitName = row.unit_name;
  return {
    id: row.id,
    key: row.issue_key,
    unitId: row.unit_id,
    unitName,
    inspectDate: row.inspect_date,
    location: row.location,
    category: row.category,
    description: row.description,
    inspector: row.inspector,
    severity: row.severity,
    status: row.status,
    problemImages: safeJsonParse(row.problem_images, []),
    rectifyImages: safeJsonParse(row.rectify_images, []),
    rectifyNote: row.rectify_note,
    rectifyContact: row.rectify_contact,
    rectifiedAt: row.rectified_at,
    createdAt: row.created_at,
    ...extra,
  };
}

function safeJsonParse(s, def) {
  try { return JSON.parse(s); } catch { return def; }
}

/** 简易内存限流器（按 key，windowMs 窗口内最多 max 次） */
function rateLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, 5 * 60 * 1000).unref();
  return function limited(key) {
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now > rec.reset) {
      rec = { count: 0, reset: now + windowMs };
      hits.set(key, rec);
    }
    rec.count++;
    return rec.count <= max;
  };
}

/** 物理删除已落盘但业务未使用的图片（失败不抛错） */
function removeQuiet(absPath) {
  fs.promises.unlink(absPath).catch(() => {});
}

module.exports = {
  safeEqual, genIssueKey, audit, sniffImage, toRelUrl,
  rectifyUrl, qrDataUrl, mapIssue, safeJsonParse, rateLimiter, removeQuiet,
};
