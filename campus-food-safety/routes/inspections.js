'use strict';
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const { genKey, saveImage, removeImage } = require('../util');

const router = express.Router();

// 使用内存存储，校验通过后再自行落盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize,
    files: config.upload.maxFilesPerInspection,
  },
});

const insertInspection = db.prepare(`
  INSERT INTO inspections
    (access_key, unit_name, location, description, inspector_name, inspection_date, problem_image)
  VALUES
    (@access_key, @unit_name, @location, @description, @inspector_name, @inspection_date, @problem_image)
`);

/**
 * POST /api/inspections
 * 监管老师提交一次检查：表单字段 + 多张问题图（字段名 photos）
 * 每张图生成一条记录和一个整改 key，返回 key 与二维码 dataURL
 */
router.post('/', upload.array('photos', config.upload.maxFilesPerInspection), async (req, res, next) => {
  const saved = []; // 已落盘的图片，出错时回滚
  try {
    const { unit_name, location = '', description = '', inspector_name = '', inspection_date } = req.body;

    if (!unit_name || !unit_name.trim()) {
      return res.status(400).json({ error: '请填写被检单位名称' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspection_date || '')) {
      return res.status(400).json({ error: '检查日期格式应为 YYYY-MM-DD' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请至少上传一张问题照片' });
    }

    const items = [];
    const tx = db.transaction(() => {
      for (const file of req.files) {
        const rel = saveImage('problems', file.buffer); // 内含魔数校验
        saved.push(rel);
        const key = genKey();
        insertInspection.run({
          access_key: key,
          unit_name: unit_name.trim(),
          location: String(location).slice(0, 100),
          description: String(description).slice(0, 500),
          inspector_name: String(inspector_name).slice(0, 50),
          inspection_date,
          problem_image: rel,
        });
        items.push({ key, image: `/uploads/${rel}` });
      }
    });
    tx();

    // 为每个 key 生成二维码（内容为整改页 URL）
    for (const item of items) {
      item.rectifyUrl = `${config.baseUrl}/rectify.html?key=${encodeURIComponent(item.key)}`;
      item.qrDataUrl = await QRCode.toDataURL(item.rectifyUrl, { width: 320, margin: 1 });
    }
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    saved.forEach(removeImage); // 回滚已保存文件
    next(err);
  }
});

/**
 * GET /api/inspections/:key
 * 食堂负责人扫码后，凭 key 查询该问题图信息（公开接口，key 即凭证）
 */
router.get('/:key', (req, res) => {
  const row = db.prepare(`
    SELECT i.id, i.unit_name, i.location, i.description, i.inspector_name,
           i.inspection_date, i.problem_image, i.status,
           r.image AS rect_image, r.submitter_name, r.note AS rect_note, r.created_at AS rectified_at
    FROM inspections i
    LEFT JOIN rectifications r ON r.id = (
      SELECT id FROM rectifications WHERE inspection_id = i.id ORDER BY id DESC LIMIT 1
    )
    WHERE i.access_key = ?
  `).get(req.params.key);

  if (!row) return res.status(404).json({ error: 'key 无效或已失效' });

  res.json({
    unit_name: row.unit_name,
    location: row.location,
    description: row.description,
    inspector_name: row.inspector_name,
    inspection_date: row.inspection_date,
    status: row.status,
    problem_image: `/uploads/${row.problem_image}`,
    rectification: row.rect_image ? {
      image: `/uploads/${row.rect_image}`,
      submitter_name: row.submitter_name,
      note: row.rect_note,
      submitted_at: row.rectified_at,
    } : null,
  });
});

module.exports = router;
