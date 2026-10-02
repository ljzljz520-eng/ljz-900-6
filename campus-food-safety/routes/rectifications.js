'use strict';
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { saveImage, removeImage, createRateLimiter } = require('../util');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSize, files: 1 },
});

// 整改提交限流（防暴力枚举 key / 刷接口）
const allowRequest = createRateLimiter(config.rateLimit);

/**
 * POST /api/rectifications/:key
 * 食堂负责人凭 key 提交整改照片（字段名 photo）
 * 同一 key 可重复提交，最新一条生效（旧记录保留备查）
 */
router.post('/:key', upload.single('photo'), (req, res, next) => {
  let saved = null;
  try {
    const ip = req.ip || 'unknown';
    if (!allowRequest(ip)) {
      return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
    }

    const inspection = db.prepare('SELECT id FROM inspections WHERE access_key = ?').get(req.params.key);
    if (!inspection) return res.status(404).json({ error: 'key 无效或已失效' });
    if (!req.file) return res.status(400).json({ error: '请上传整改后的照片' });

    const { submitter_name = '', submitter_phone = '', note = '' } = req.body;
    if (!submitter_name.trim()) {
      return res.status(400).json({ error: '请填写提交人姓名' });
    }

    const rel = saveImage('rectifications', req.file.buffer);
    saved = rel;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO rectifications (inspection_id, image, submitter_name, submitter_phone, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        inspection.id, rel,
        String(submitter_name).slice(0, 50),
        String(submitter_phone).slice(0, 20),
        String(note).slice(0, 500),
      );
      db.prepare("UPDATE inspections SET status = 'rectified' WHERE id = ?").run(inspection.id);
    });
    tx();

    res.json({ ok: true, image: `/uploads/${rel}` });
  } catch (err) {
    if (saved) removeImage(saved);
    next(err);
  }
});

module.exports = router;
