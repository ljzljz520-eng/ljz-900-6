'use strict';
/**
 * SQLite 数据库初始化（better-sqlite3，同步 API，适合本项目量级）。
 * 启动时自动建表、建索引、写入初始食堂单位。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,          -- 食堂/档口/单位名称
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS issues (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key           TEXT    NOT NULL UNIQUE,    -- 印在二维码里的整改 key（8 位）
  unit_id             INTEGER NOT NULL REFERENCES units(id),
  inspect_date        TEXT    NOT NULL,           -- 检查日期 YYYY-MM-DD
  location            TEXT,                       -- 具体位置：如 后厨/面点间/留样柜
  category            TEXT,                       -- 问题类别：环境卫生/食材存储/加工操作/餐具消毒/其他
  description         TEXT,                       -- 问题描述
  inspector           TEXT,                       -- 检查人（监管老师）
  severity            TEXT    NOT NULL DEFAULT '一般'
                          CHECK (severity IN ('一般','较重','严重')),
  status              TEXT    NOT NULL DEFAULT '待整改'
                          CHECK (status IN ('待整改','已整改')),
  problem_images      TEXT    NOT NULL DEFAULT '[]',  -- JSON 数组 [{path,url}]
  rectify_images      TEXT    NOT NULL DEFAULT '[]',  -- JSON 数组 [{path,url}]
  rectify_note        TEXT,                       -- 整改说明
  rectify_contact     TEXT,                       -- 整改提交人/联系方式
  rectified_at        TEXT,                       -- 整改提交时间
  created_at          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_issues_date    ON issues(inspect_date);
CREATE INDEX IF NOT EXISTS idx_issues_unit    ON issues(unit_id);
CREATE INDEX IF NOT EXISTS idx_issues_status  ON issues(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// 初始单位（食堂）。后续监管老师也可在检查页直接新增。
const seedUnits = [
  '第一食堂', '第二食堂', '第三食堂',
  '教工餐厅', '清真食堂', '校园超市餐饮档口',
];
const insertUnit = db.prepare('INSERT OR IGNORE INTO units(name) VALUES (?)');
const seed = db.transaction((names) => names.forEach((n) => insertUnit.run(n)));
seed(seedUnits);

module.exports = db;
