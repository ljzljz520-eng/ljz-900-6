'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

/** 校领导接口鉴权：Authorization: Bearer <ADMIN_TOKEN> */
router.use((req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== config.adminToken) {
    return res.status(401).json({ error: '未授权，请填写正确的访问令牌' });
  }
  next();
});

/** 汇总查询的公共 WHERE 构造 */
function buildWhere(query) {
  const conds = [];
  const params = {};
  if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    conds.push('i.inspection_date = @date');
    params.date = query.date;
  }
  if (query.date_from && /^\d{4}-\d{2}-\d{2}$/.test(query.date_from)) {
    conds.push('i.inspection_date >= @date_from');
    params.date_from = query.date_from;
  }
  if (query.date_to && /^\d{4}-\d{2}-\d{2}$/.test(query.date_to)) {
    conds.push('i.inspection_date <= @date_to');
    params.date_to = query.date_to;
  }
  if (query.unit && query.unit.trim()) {
    conds.push('i.unit_name = @unit');
    params.unit = query.unit.trim();
  }
  if (query.status && ['pending', 'rectified'].includes(query.status)) {
    conds.push('i.status = @status');
    params.status = query.status;
  }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

const LIST_SQL = `
  SELECT i.id, i.access_key, i.unit_name, i.location, i.description,
         i.inspector_name, i.inspection_date, i.problem_image, i.status, i.created_at,
         r.image AS rect_image, r.submitter_name, r.submitter_phone,
         r.note AS rect_note, r.created_at AS rectified_at
  FROM inspections i
  LEFT JOIN rectifications r ON r.id = (
    SELECT id FROM rectifications WHERE inspection_id = i.id ORDER BY id DESC LIMIT 1
  )
`;

/**
 * GET /api/admin/summary?date=&date_from=&date_to=&unit=&status=&page=&page_size=
 * 校领导汇总列表（按检查日期/单位/状态筛选）
 */
router.get('/summary', (req, res) => {
  const { where, params } = buildWhere(req.query);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size || '20', 10)));

  const total = db.prepare(`SELECT COUNT(*) AS c FROM inspections i ${where}`).get(params).c;
  const rows = db.prepare(`
    ${LIST_SQL} ${where}
    ORDER BY i.inspection_date DESC, i.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

  res.json({
    total, page, page_size: pageSize,
    items: rows.map((r) => ({
      id: r.id,
      key: r.access_key,
      unit_name: r.unit_name,
      location: r.location,
      description: r.description,
      inspector_name: r.inspector_name,
      inspection_date: r.inspection_date,
      status: r.status,
      problem_image: `/uploads/${r.problem_image}`,
      rectification: r.rect_image ? {
        image: `/uploads/${r.rect_image}`,
        submitter_name: r.submitter_name,
        submitter_phone: r.submitter_phone,
        note: r.rect_note,
        submitted_at: r.rectified_at,
      } : null,
    })),
  });
});

/** GET /api/admin/units —— 单位下拉列表 */
router.get('/units', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT unit_name FROM inspections ORDER BY unit_name').all();
  res.json({ units: rows.map((r) => r.unit_name) });
});

/** GET /api/admin/stats —— 顶部统计数字 */
router.get('/stats', (req, res) => {
  const { where, params } = buildWhere(req.query);
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'rectified' THEN 1 ELSE 0 END) AS rectified,
           SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending
    FROM inspections i ${where}
  `).get(params);
  res.json({ total: row.total || 0, rectified: row.rectified || 0, pending: row.pending || 0 });
});

/** GET /api/admin/export —— 导出 CSV（带 BOM，Excel 可直接打开） */
router.get('/export', (req, res) => {
  const { where, params } = buildWhere(req.query);
  const rows = db.prepare(`${LIST_SQL} ${where} ORDER BY i.inspection_date DESC, i.id DESC`).all(params);

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['检查日期', '单位', '位置', '问题描述', '检查人', '状态', '整改key', '整改提交人', '整改电话', '整改说明', '整改时间'];
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    lines.push([
      r.inspection_date, r.unit_name, r.location, r.description, r.inspector_name,
      r.status === 'rectified' ? '已整改' : '待整改',
      r.access_key, r.submitter_name || '', r.submitter_phone || '', r.rect_note || '', r.rectified_at || '',
    ].map(esc).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="food-safety-${Date.now()}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

module.exports = router;
