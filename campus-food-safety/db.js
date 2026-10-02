'use strict';

/**
 * SQLite 数据库初始化（better-sqlite3，WAL 模式）
 * 三张表：inspections（检查记录）/ issues（问题照片，每张一个唯一 key）/ rectifications（整改照片）
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
-- 检查记录：同一单位同一检查日期归为同一次检查
CREATE TABLE IF NOT EXISTS inspections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit         TEXT NOT NULL,                 -- 受检单位（食堂）名称
  inspect_date TEXT NOT NULL,                 -- 检查日期 YYYY-MM-DD
  inspector    TEXT NOT NULL DEFAULT '',      -- 监管老师姓名
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (unit, inspect_date)
);

-- 问题照片：每张图一个全局唯一 key，印在二维码上供食堂负责人扫码整改
CREATE TABLE IF NOT EXISTS issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  issue_key     TEXT NOT NULL UNIQUE,         -- 8 位整改码（无 0/O、1/I 易混淆字符）
  description   TEXT NOT NULL DEFAULT '',     -- 问题描述（<=200 字）
  photo_path    TEXT NOT NULL,                -- 相对 uploads/ 的路径
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rectified')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_issues_inspection ON issues(inspection_id);
CREATE INDEX IF NOT EXISTS idx_issues_status     ON issues(status);

-- 整改照片：允许同一问题多次提交（历史留痕），汇总页展示最新一条
CREATE TABLE IF NOT EXISTS rectifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id     INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  photo_path   TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',      -- 整改说明
  submitted_by TEXT NOT NULL DEFAULT '',      -- 提交人（食堂负责人）
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_rect_issue ON rectifications(issue_id);
`);

module.exports = db;
