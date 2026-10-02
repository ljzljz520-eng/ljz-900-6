'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

// 确保数据目录存在
fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');      // 读写并发更好
db.pragma('foreign_keys = ON');

/**
 * 数据库表结构
 *
 * inspections   检查记录（一行 = 一张问题图 = 一个整改 key）
 * rectifications 整改记录（一条检查记录可多次提交，取最新一条为当前状态）
 */
db.exec(`
CREATE TABLE IF NOT EXISTS inspections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key      TEXT NOT NULL UNIQUE,              -- 每张问题图唯一的整改 key（二维码内容）
  unit_name       TEXT NOT NULL,                     -- 被检单位（食堂/档口）
  location        TEXT NOT NULL DEFAULT '',          -- 具体位置（楼层/区域）
  description     TEXT NOT NULL DEFAULT '',          -- 问题描述
  inspector_name  TEXT NOT NULL DEFAULT '',          -- 检查人（监管老师）
  inspection_date TEXT NOT NULL,                     -- 检查日期 YYYY-MM-DD
  problem_image   TEXT NOT NULL,                     -- 问题图相对路径（相对 uploads/）
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','rectified')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rectifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  image          TEXT NOT NULL,                      -- 整改图相对路径
  submitter_name TEXT NOT NULL DEFAULT '',           -- 提交人姓名
  submitter_phone TEXT NOT NULL DEFAULT '',          -- 提交人电话
  note           TEXT NOT NULL DEFAULT '',           -- 整改说明
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_inspections_date   ON inspections(inspection_date);
CREATE INDEX IF NOT EXISTS idx_inspections_unit   ON inspections(unit_name);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_rect_inspection    ON rectifications(inspection_id);
`);

module.exports = db;
