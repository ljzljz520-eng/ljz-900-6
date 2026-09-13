-- =====================================================================
-- 校园食安检查拍照系统 —— MySQL 8.0 建表脚本（可选）
-- 应用默认使用 SQLite（零配置开箱即用）。
-- 如需切换 MySQL，请按 README 说明更换数据访问层后使用本脚本。
-- =====================================================================
CREATE DATABASE IF NOT EXISTS food_safety
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE food_safety;

CREATE TABLE IF NOT EXISTS units (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL UNIQUE COMMENT '食堂/档口名称',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='受检单位（食堂）';

CREATE TABLE IF NOT EXISTS issues (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  issue_key        CHAR(8)     NOT NULL UNIQUE COMMENT '整改 key（二维码内容）',
  unit_id          BIGINT UNSIGNED NOT NULL,
  inspect_date     DATE        NOT NULL COMMENT '检查日期',
  location         VARCHAR(100) COMMENT '具体位置',
  category         VARCHAR(30)  COMMENT '问题类别',
  description      TEXT         COMMENT '问题描述',
  inspector        VARCHAR(50)  COMMENT '检查人',
  severity         ENUM('一般','较重','严重') NOT NULL DEFAULT '一般',
  status           ENUM('待整改','已整改')   NOT NULL DEFAULT '待整改',
  problem_images   JSON        NOT NULL COMMENT '问题图 [{path,url}]',
  rectify_images   JSON        NOT NULL COMMENT '整改图 [{path,url}]',
  rectify_note     TEXT         COMMENT '整改说明',
  rectify_contact  VARCHAR(100) COMMENT '整改提交人/联系方式',
  rectified_at     DATETIME     COMMENT '整改时间',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_issues_date (inspect_date),
  INDEX idx_issues_unit (unit_id),
  INDEX idx_issues_status (status),
  CONSTRAINT fk_issues_unit FOREIGN KEY (unit_id) REFERENCES units(id)
) ENGINE=InnoDB COMMENT='检查问题单（一问题一记录，一 key 一二维码）';

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  role        VARCHAR(20),
  action      VARCHAR(50) NOT NULL,
  detail      TEXT,
  ip          VARCHAR(45),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_created (created_at)
) ENGINE=InnoDB COMMENT='操作审计日志';
