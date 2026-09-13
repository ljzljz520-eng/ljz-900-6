'use strict';
/**
 * 极简无状态登录：HMAC-SHA256 签名 token 存 HttpOnly Cookie。
 * 三类角色：inspector（监管老师）、admin（校领导）；整改页对食堂负责人公开（凭 key）。
 */
const crypto = require('crypto');
const config = require('./config');

function sign(payloadB64) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(payloadB64).digest('base64url');
}

function createToken(role) {
  const payload = Buffer.from(JSON.stringify({
    role,
    exp: Date.now() + config.COOKIE_MAX_AGE_MS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  let expectSig;
  try { expectSig = sign(payloadB64); } catch { return null; }
  const sigOk = sig.length === expectSig.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectSig));
  if (!sigOk) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** 解析当前登录用户，挂到 req.user（未登录为 null） */
function currentUser(req, _res, next) {
  const token = parseCookies(req).fs_token;
  req.user = verifyToken(token);
  next();
}

/** 要求登录（任意角色） */
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: '请先登录' });
}

/** 要求指定角色之一 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: '无权限执行此操作' });
  };
}

function setAuthCookie(req, res, token) {
  // 经 nginx https 反代时 req.protocol 由 trust proxy 保证为 https
  const secure = req.protocol === 'https';
  res.cookie('fs_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: config.COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie('fs_token', { path: '/' });
}

module.exports = {
  createToken, verifyToken, currentUser, requireAuth, requireRole,
  setAuthCookie, clearAuthCookie, parseCookies,
};
