'use strict';
/**
 * 配置加载：读取项目根目录 .env（极简实现，无第三方依赖）
 * 读取不到的变量使用默认值，保证开箱即用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

function int(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const config = {
  ROOT,
  PORT: int('PORT', 3000),
  // 对外基础地址，空串表示按请求动态推断
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  INSPECTOR_PASSWORD: process.env.INSPECTOR_PASSWORD || 'inspect123',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  MAX_FILE_MB: int('MAX_FILE_MB', 8),
  MAX_ISSUE_IMAGES: int('MAX_ISSUE_IMAGES', 10),
  MAX_RECTIFY_IMAGES: int('MAX_RECTIFY_IMAGES', 4),
  DB_PATH: path.resolve(ROOT, process.env.DB_PATH || './data/food_safety.db'),
  UPLOAD_DIR: path.resolve(ROOT, process.env.UPLOAD_DIR || './uploads'),
  COOKIE_MAX_AGE_MS: 12 * 60 * 60 * 1000, // 登录态 12 小时
};

module.exports = config;
