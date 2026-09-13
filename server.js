'use strict';
/**
 * 校园食安检查拍照系统 —— 服务入口
 *
 * 角色：
 *   inspector 监管老师：登录 → 检查页批量传问题图 → 每问题生成 key + 二维码
 *   食堂负责人：无需登录，扫码（凭 key）打开整改页 → 上传整改图提交
 *   admin 校领导：登录 → 汇总页按检查日期 / 单位筛选，查看整改闭环并导出 CSV
 */
const path = require('path');
const express = require('express');
const db = require('./src/db');
const config = require('./src/config');
const {
  currentUser, requireAuth, requireRole,
  createToken, setAuthCookie, clearAuthCookie,
} = require('./src/auth');
const { upload, verifyUploaded } = require('./src/upload');
const {
  safeEqual, genIssueKey, audit, toRelUrl, rectifyUrl,
  qrDataUrl, mapIssue, rateLimiter, removeQuiet,
} = require('./src/util');

const app = express();
app.set('trust proxy', 1); // nginx 反代后取真实协议/IP
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(currentUser);

// 静态资源：前端页面 / 已上传图片（图片名不可猜测，不强鉴权，便于扫码端直接展示）
app.use(express.static(path.join(config.ROOT, 'public')));
app.use('/uploads', express.static(config.UPLOAD_DIR, {
  maxAge: '7d',
  fallthrough: true,
}));
app.use('/uploads', (req, res) => res.status(404).json({ error: '图片不存在' }));

/* ================= 认证 ================= */

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? { role: req.user.role } : null });
});

app.post('/api/login', (req, res) => {
  const role = String(req.body.role || '');
  const password = String(req.body.password || '');
  const ip = req.ip;
  let ok = false;
  if (role === 'inspector') ok = safeEqual(password, config.INSPECTOR_PASSWORD);
  else if (role === 'admin') ok = safeEqual(password, config.ADMIN_PASSWORD);
  if (!ok) {
    audit(role || 'unknown', 'login_fail', '', ip);
    return res.status(401).json({ error: '角色或密码错误' });
  }
  const token = createToken(role);
  setAuthCookie(req, res, token);
  audit(role, 'login_ok', '', ip);
  res.json({ ok: true, role });
});

app.post('/api/logout', (req, res) => {
  audit(req.user && req.user.role, 'logout', '', req.ip);
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* ================= 基础数据：单位（食堂） ================= */

app.get('/api/units', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM units ORDER BY id').all();
  res.json({ units: rows });
});

app.post('/api/units', requireRole('inspector'), (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: '单位名称不能为空' });
  try {
    const info = db.prepare('INSERT INTO units(name) VALUES (?)').run(name);
    audit(req.user.role, 'unit_create', name, req.ip);
    res.json({ id: info.lastInsertRowid, name });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const row = db.prepare('SELECT id, name FROM units WHERE name = ?').get(name);
      return res.json({ id: row.id, name: row.name, existed: true });
    }
    throw e;
  }
});

/* ================= 监管老师：提交检查（批量问题图） ================= */

/**
 * multipart/form-data
 *  files: 字段名 photos，可多张
 *  meta: JSON 字符串
 *    { unitName|unitId, inspectDate, inspector,
 *      items: [{filename, location, category, description, severity}] }
 * items 与文件按原始文件名一一对应；每条问题生成一个独立 key。
 */
app.post('/api/inspector/issues',
  requireRole('inspector'),
  upload.array('photos', config.MAX_ISSUE_IMAGES),
  async (req, res, next) => {
    let meta;
    try {
      meta = JSON.parse(req.body.meta || '{}');
    } catch {
      (req.files || []).forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: 'meta 不是合法 JSON' });
    }

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: '请至少上传 1 张问题图' });
    if (files.length > config.MAX_ISSUE_IMAGES) {
      files.forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: `最多上传 ${config.MAX_ISSUE_IMAGES} 张` });
    }

    const unitName = String(meta.unitName || '').trim();
    const unitIdRaw = Number(meta.unitId);
    const inspectDate = String(meta.inspectDate || '').trim();
    const inspector = String(meta.inspector || '').trim().slice(0, 50);
    const items = Array.isArray(meta.items) ? meta.items : [];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectDate) || Number.isNaN(Date.parse(inspectDate))) {
      files.forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: '检查日期格式应为 YYYY-MM-DD' });
    }
    if (!unitName && !(unitIdRaw > 0)) {
      files.forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: '请选择或输入受检单位' });
    }
    if (items.length !== files.length) {
      files.forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: '问题条目数与图片数不一致' });
    }

    // 落盘图片魔数复核
    let verified;
    try {
      verified = await verifyUploaded(files);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // 解析单位：优先 id；给名称则找不到自动新建
    let unit;
    if (unitIdRaw > 0) {
      unit = db.prepare('SELECT id, name FROM units WHERE id = ?').get(unitIdRaw);
      if (!unit) {
        verified.forEach((v) => removeQuiet(v.absPath));
        return res.status(400).json({ error: '受检单位不存在' });
      }
    } else {
      unit = db.prepare('SELECT id, name FROM units WHERE name = ?').get(unitName);
      if (!unit) {
        const info = db.prepare('INSERT INTO units(name) VALUES (?)').run(unitName);
        unit = { id: info.lastInsertRowid, name: unitName };
      }
    }

    const ALLOWED_CAT = ['环境卫生', '食材存储', '加工操作', '餐具消毒', '人员管理', '设施设备', '其他'];
    const ALLOWED_SEV = ['一般', '较重', '严重'];

    const insert = db.prepare(`
      INSERT INTO issues(issue_key, unit_id, inspect_date, location, category,
                         description, inspector, severity, problem_images)
      VALUES (@issue_key, @unit_id, @inspect_date, @location, @category,
              @description, @inspector, @severity, @problem_images)`);

    const created = [];
    const tx = db.transaction(() => {
      for (const v of verified) {
        const it = items.find((x) => x && x.filename === v.originalname) || {};
        const category = ALLOWED_CAT.includes(it.category) ? it.category : '其他';
        const severity = ALLOWED_SEV.includes(it.severity) ? it.severity : '一般';
        const rec = {
          issue_key: genIssueKey(),
          unit_id: unit.id,
          inspect_date: inspectDate,
          location: String(it.location || '').trim().slice(0, 100) || null,
          category,
          description: String(it.description || '').trim().slice(0, 2000) || null,
          inspector: inspector || null,
          severity,
          problem_images: JSON.stringify([{ url: toRelUrl(v.absPath), size: v.size }]),
        };
        const info = insert.run(rec);
        created.push({ id: info.lastInsertRowid, key: rec.issue_key, filename: v.originalname });
      }
    });

    try {
      tx();
    } catch (e) {
      verified.forEach((v) => removeQuiet(v.absPath));
      return next(e);
    }

    audit(req.user.role, 'issue_create',
      `单位:${unit.name} 日期:${inspectDate} 数量:${created.length}`, req.ip);

    // 附加每张图的整改链接与二维码
    for (const c of created) {
      c.rectifyUrl = rectifyUrl(req, c.key);
      c.qr = await qrDataUrl(c.rectifyUrl);
    }
    res.json({ ok: true, unit: unit.name, inspectDate, created });
  });

/** 监管老师：查看自己提交过的问题（近 200 条，含整改状态与二维码） */
app.get('/api/inspector/issues', requireRole('inspector'), async (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, u.name AS unit_name FROM issues i
    JOIN units u ON u.id = i.unit_id
    ORDER BY i.inspect_date DESC, i.id DESC LIMIT 200`).all();
  const out = [];
  for (const r of rows) {
    const item = mapIssue(r);
    item.rectifyUrl = rectifyUrl(req, item.key);
    item.qr = await qrDataUrl(item.rectifyUrl);
    out.push(item);
  }
  res.json({ issues: out });
});

/* ================= 食堂负责人：扫码整改（公开，凭 key） ================= */

const rectifyGetLimit = rateLimiter(30, 60 * 1000);
const rectifyPostLimit = rateLimiter(10, 60 * 1000);

function findIssueByKey(key) {
  return db.prepare(`
    SELECT i.*, u.name AS unit_name FROM issues i
    JOIN units u ON u.id = i.unit_id
    WHERE i.issue_key = ?`).get(String(key || '').trim().toUpperCase());
}

app.get('/api/rectify/:key', async (req, res) => {
  if (!rectifyGetLimit(req.ip)) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
  const row = findIssueByKey(req.params.key);
  if (!row) return res.status(404).json({ error: 'key 无效，请核对二维码或联系监管老师' });
  // 公开接口只返回整改所需字段，不暴露其它检查记录
  res.json({
    issue: mapIssue(row, {
      rectifyUrl: rectifyUrl(req, row.issue_key),
    }),
  });
});

app.post('/api/rectify/:key',
  upload.array('photos', config.MAX_RECTIFY_IMAGES),
  async (req, res) => {
    if (!rectifyPostLimit(req.ip)) {
      (req.files || []).forEach((f) => removeQuiet(f.path));
      return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
    }
    const key = String(req.params.key || '').trim().toUpperCase();
    const row = findIssueByKey(key);
    if (!row) {
      (req.files || []).forEach((f) => removeQuiet(f.path));
      return res.status(404).json({ error: 'key 无效' });
    }
    if (row.status === '已整改') {
      (req.files || []).forEach((f) => removeQuiet(f.path));
      return res.status(409).json({ error: '该问题已提交整改，无需重复提交' });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: '请至少上传 1 张整改后照片' });
    }
    const contact = String(req.body.contact || '').trim().slice(0, 100);
    const note = String(req.body.note || '').trim().slice(0, 1000);
    if (!contact) {
      files.forEach((f) => removeQuiet(f.path));
      return res.status(400).json({ error: '请填写整改负责人姓名/联系方式' });
    }

    let verified;
    try {
      verified = await verifyUploaded(files);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const images = verified.map((v) => ({ url: toRelUrl(v.absPath), size: v.size }));
    try {
      db.prepare(`
        UPDATE issues SET status='已整改', rectify_images=?, rectify_note=?,
                          rectify_contact=?,
                          rectified_at=datetime('now','localtime')
        WHERE id=? AND status='待整改'`)
        .run(JSON.stringify(images), note || null, contact, row.id);
    } catch (e) {
      verified.forEach((v) => removeQuiet(v.absPath));
      return next(e);
    }
    audit('canteen', 'rectify_submit', `key:${key} 单位:${row.unit_name} 图:${images.length}`, req.ip);
    res.json({ ok: true, message: '整改材料已提交，感谢配合！' });
  });

/* ================= 校领导：汇总页 ================= */

function querySummary(query) {
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  const unitId = Number(query.unitId);
  const status = String(query.status || '').trim();

  const where = [];
  const params = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('i.inspect_date >= @from'); params.from = from; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('i.inspect_date <= @to'); params.to = to; }
  if (unitId > 0) { where.push('i.unit_id = @unitId'); params.unitId = unitId; }
  if (status === '待整改' || status === '已整改') { where.push('i.status = @status'); params.status = status; }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status='已整改' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN status='待整改' THEN 1 ELSE 0 END) AS pending
    FROM issues i ${clause}`).get(params);

  const byUnit = db.prepare(`
    SELECT u.id AS unitId, u.name AS unitName,
           COUNT(*) AS total,
           SUM(CASE WHEN i.status='已整改' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN i.status='待整改' THEN 1 ELSE 0 END) AS pending
    FROM issues i JOIN units u ON u.id = i.unit_id
    ${clause}
    GROUP BY u.id, u.name ORDER BY total DESC`).all(params);

  const byCategory = db.prepare(`
    SELECT COALESCE(i.category,'未分类') AS category, COUNT(*) AS n
    FROM issues i ${clause}
    GROUP BY i.category ORDER BY n DESC`).all(params);

  const rows = db.prepare(`
    SELECT i.*, u.name AS unit_name FROM issues i
    JOIN units u ON u.id = i.unit_id
    ${clause}
    ORDER BY i.inspect_date DESC, u.id, i.id DESC`).all(params);

  return {
    stats: {
      total: stats.total || 0,
      done: stats.done || 0,
      pending: stats.pending || 0,
      rate: stats.total ? Math.round((stats.done / stats.total) * 1000) / 10 : 0,
    },
    byUnit, byCategory,
    issues: rows.map((r) => mapIssue(r)),
  };
}

app.get('/api/admin/summary', requireRole('admin'), (req, res) => {
  res.json(querySummary(req.query));
});

/** 按当前筛选条件导出 CSV（带 BOM，Excel 直接打开不乱码） */
app.get('/api/admin/export.csv', requireRole('admin'), (req, res) => {
  const payload = querySummary(req.query);
  const cols = ['检查日期', '单位', '位置', '类别', '问题描述', '严重程度', '检查人',
    '状态', '问题图', '整改图', '整改说明', '整改负责人', '整改时间'];
  const esc = (v) => {
    const s2 = v == null ? '' : String(v);
    return /[",\n\r]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2;
  };
  const lines = [cols.join(',')];
  const host = req.protocol + '://' + req.get('host');
  for (const i of payload.issues) {
    lines.push([
      i.inspectDate, i.unitName, i.location, i.category, i.description,
      i.severity, i.inspector, i.status,
      i.problemImages.map((p) => host + p.url).join(' '),
      i.rectifyImages.map((p) => host + p.url).join(' '),
      i.rectifyNote, i.rectifyContact, i.rectifiedAt,
    ].map(esc).join(','));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="food-safety-issues.csv"');
  res.send(csv);
});

/* ================= 健康检查 & 错误处理 ================= */

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 兜底：非 /api 路径返回首页，方便直接刷新前端页面
app.get('*', (_req, res) => res.sendFile(path.join(config.ROOT, 'public', 'index.html')));

// multer / 全局错误
app.use((err, req, res, _next) => {
  if (err && err.name === 'MulterError') {
    let msg = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') msg = `单张图片不能超过 ${config.MAX_FILE_MB}MB`;
    if (err.code === 'LIMIT_FILE_COUNT') msg = `上传图片数量超限`;
    return res.status(400).json({ error: msg });
  }
  // multer fileFilter 拒绝（格式不符）：上传阶段错误统一按 400
  if (err && (req.is('multipart/form-data') || /格式|图片/.test(err.message || ''))) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[server error]', err);
    return res.status(status).json({ error: status >= 500 ? '服务器内部错误' : (err.message || '请求错误') });
  }
  res.status(404).send('Not found');
});

app.listen(config.PORT, () => {
  console.log(`校园食安检查拍照系统已启动: http://localhost:${config.PORT}`);
  console.log(`图片目录: ${config.UPLOAD_DIR}`);
  console.log(`数据库:   ${config.DB_PATH}`);
});
