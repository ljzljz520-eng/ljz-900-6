'use strict';

/**
 * 校园食品安全检查拍照整改系统
 * ----------------------------------------------------------
 * 角色与流程：
 *   监管老师   -> /inspect.html  上传问题照片，系统为每张图生成唯一 key + 二维码
 *   食堂负责人 -> 扫码打开 /r/<key>，提交整改照片
 *   校领导     -> /admin.html    按检查日期 + 单位筛选汇总
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('./db');

/* ---------------- 配置（均可用环境变量覆盖） ---------------- */
const PORT            = parseInt(process.env.PORT || '3000', 10);
const BASE_URL        = (process.env.BASE_URL || '').replace(/\/$/, ''); // 二维码使用的对外地址，如 https://food.school.edu.cn
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '5', 10);
const MAX_FILES       = parseInt(process.env.MAX_FILES_PER_UPLOAD || '9', 10);
const MAX_FILE_SIZE   = MAX_FILE_SIZE_MB * 1024 * 1024;
const UPLOAD_ROOT     = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

const ISSUE_DIR = path.join(UPLOAD_ROOT, 'issues');          // 问题照片
const RECT_DIR  = path.join(UPLOAD_ROOT, 'rectifications');  // 整改照片
for (const d of [ISSUE_DIR, RECT_DIR]) fs.mkdirSync(d, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // 仅信任本机反向代理传来的 X-Forwarded-For
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

// 基础安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// 上传类接口限流：每 IP 10 分钟最多 60 次
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作过于频繁，请 10 分钟后再试' },
});

/* ---------------- 工具函数 ---------------- */

// 去掉易混淆字符（0/O、1/I）的整改码字母表，8 位约 1.1 万亿种组合
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genKey(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

// 通过文件魔数判断真实图片类型，防止改后缀伪装
function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// multer：先读进内存做魔数校验，通过后才落盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('仅支持 JPG / PNG / WebP 格式的图片'));
    }
    cb(null, true);
  },
});

// 校验并保存图片，返回相对路径（如 issues/2026-10-02/xxx.jpg）
function saveImage(buffer, dir) {
  const type = sniffImageType(buffer);
  if (!type) throw new Error('文件内容不是有效图片，已拒绝');
  const day = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD，按服务器本地时区
  const dayDir = path.join(dir, day);
  fs.mkdirSync(dayDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID()}.${type}`;
  fs.writeFileSync(path.join(dayDir, filename), buffer);
  return `${path.basename(dir)}/${day}/${filename}`;
}

function baseUrl(req) {
  return BASE_URL || `${req.protocol}://${req.get('host')}`;
}

/* ---------------- API ---------------- */

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 单位列表（汇总页筛选 + 上传页输入联想）
app.get('/api/units', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT unit FROM inspections ORDER BY unit').all();
  res.json(rows.map((r) => r.unit));
});

// ① 监管老师上传问题图（一次最多 MAX_FILES 张），逐张生成 key + 二维码
app.post('/api/issues', uploadLimiter, upload.array('photos', MAX_FILES), async (req, res, next) => {
  const savedFiles = [];
  try {
    const unit        = String(req.body.unit || '').trim();
    const inspectDate = String(req.body.inspect_date || '').trim();
    const inspector   = String(req.body.inspector || '').trim();
    let descriptions  = req.body.descriptions ?? [];
    if (!Array.isArray(descriptions)) descriptions = [descriptions];

    if (!unit || unit.length > 50) return res.status(400).json({ error: '请填写有效的单位名称（50 字以内）' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectDate)) return res.status(400).json({ error: '检查日期格式应为 YYYY-MM-DD' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请至少选择一张问题图片' });

    // 同一单位同一检查日期归为同一次检查
    const inspection = db.prepare(`
      INSERT INTO inspections (unit, inspect_date, inspector) VALUES (?, ?, ?)
      ON CONFLICT(unit, inspect_date) DO UPDATE SET inspector = excluded.inspector
      RETURNING id
    `).get(unit, inspectDate, inspector);

    // 1) 全部图片先做魔数校验并落盘
    const photos = req.files.map((f, i) => {
      const relPath = saveImage(f.buffer, ISSUE_DIR);
      savedFiles.push(relPath);
      return { relPath, description: String(descriptions[i] || '').trim().slice(0, 200) };
    });

    // 2) 事务写入数据库并分配 key
    const insertIssue = db.prepare('INSERT INTO issues (inspection_id, issue_key, description, photo_path) VALUES (?, ?, ?, ?)');
    const keyExists   = db.prepare('SELECT 1 FROM issues WHERE issue_key = ?');
    const keys = [];
    db.transaction(() => {
      for (const p of photos) {
        let key;
        do { key = genKey(); } while (keyExists.get(key));
        insertIssue.run(inspection.id, key, p.description, p.relPath);
        keys.push(key);
      }
    })();

    // 3) 为每张图生成二维码（内容为整改短链 /r/<key>）
    const items = [];
    for (let i = 0; i < photos.length; i++) {
      const url = `${baseUrl(req)}/r/${keys[i]}`;
      items.push({
        key: keys[i],
        url,
        description: photos[i].description,
        qr: await QRCode.toDataURL(url, { width: 360, margin: 1 }),
      });
    }

    res.json({ unit, inspect_date: inspectDate, count: items.length, items });
  } catch (err) {
    // 失败时清理本次已落盘的文件，避免垃圾数据
    for (const rel of savedFiles) fs.promises.unlink(path.join(UPLOAD_ROOT, rel)).catch(() => {});
    next(err);
  }
});

// ② 食堂负责人扫码后查看问题详情
app.get('/api/issues/:key', (req, res) => {
  if (!/^[A-Z2-9]{8}$/.test(req.params.key)) return res.status(400).json({ error: '整改码格式不正确' });
  const issue = db.prepare(`
    SELECT i.id, i.issue_key, i.description, i.photo_path, i.status,
           p.unit, p.inspect_date, p.inspector
    FROM issues i JOIN inspections p ON p.id = i.inspection_id
    WHERE i.issue_key = ?
  `).get(req.params.key);
  if (!issue) return res.status(404).json({ error: '整改码不存在或已失效' });

  const rect = db.prepare(`
    SELECT photo_path, note, submitted_by, created_at
    FROM rectifications WHERE issue_id = ? ORDER BY id DESC LIMIT 1
  `).get(issue.id);

  res.json({
    key: issue.issue_key,
    unit: issue.unit,
    inspect_date: issue.inspect_date,
    inspector: issue.inspector,
    description: issue.description,
    status: issue.status,
    photo_url: '/uploads/' + issue.photo_path,
    rectification: rect
      ? { photo_url: '/uploads/' + rect.photo_path, note: rect.note, submitted_by: rect.submitted_by, created_at: rect.created_at }
      : null,
  });
});

// ③ 食堂负责人提交整改照片
app.post('/api/rectify/:key', uploadLimiter, upload.single('photo'), (req, res, next) => {
  let relPath = null;
  try {
    if (!/^[A-Z2-9]{8}$/.test(req.params.key)) return res.status(400).json({ error: '整改码格式不正确' });
    const issue = db.prepare('SELECT id FROM issues WHERE issue_key = ?').get(req.params.key);
    if (!issue) return res.status(404).json({ error: '整改码不存在或已失效' });
    if (!req.file) return res.status(400).json({ error: '请上传整改后的照片' });

    const note        = String(req.body.note || '').trim().slice(0, 200);
    const submittedBy = String(req.body.submitted_by || '').trim().slice(0, 50);
    if (!submittedBy) return res.status(400).json({ error: '请填写提交人姓名' });

    relPath = saveImage(req.file.buffer, RECT_DIR);
    db.transaction(() => {
      db.prepare('INSERT INTO rectifications (issue_id, photo_path, note, submitted_by) VALUES (?, ?, ?, ?)')
        .run(issue.id, relPath, note, submittedBy);
      db.prepare("UPDATE issues SET status = 'rectified' WHERE id = ?").run(issue.id);
    })();

    res.json({ ok: true });
  } catch (err) {
    if (relPath) fs.promises.unlink(path.join(UPLOAD_ROOT, relPath)).catch(() => {});
    next(err);
  }
});

// ④ 校领导汇总：按检查日期 + 单位 + 状态筛选
app.get('/api/summary', (req, res) => {
  const conds = [];
  const params = {};
  const { date, unit, status } = req.query;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
    conds.push('p.inspect_date = @date');
    params.date = date;
  }
  if (unit) { conds.push('p.unit = @unit'); params.unit = String(unit); }
  if (status === 'pending' || status === 'rectified') { conds.push('i.status = @status'); params.status = status; }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT i.id, i.issue_key, i.description, i.photo_path, i.status, i.created_at,
           p.unit, p.inspect_date, p.inspector,
           (SELECT r.photo_path   FROM rectifications r WHERE r.issue_id = i.id ORDER BY r.id DESC LIMIT 1) AS rect_photo,
           (SELECT r.note         FROM rectifications r WHERE r.issue_id = i.id ORDER BY r.id DESC LIMIT 1) AS rect_note,
           (SELECT r.submitted_by FROM rectifications r WHERE r.issue_id = i.id ORDER BY r.id DESC LIMIT 1) AS rect_by,
           (SELECT r.created_at   FROM rectifications r WHERE r.issue_id = i.id ORDER BY r.id DESC LIMIT 1) AS rect_at
    FROM issues i
    JOIN inspections p ON p.id = i.inspection_id
    ${where}
    ORDER BY p.inspect_date DESC, p.unit ASC, i.id DESC
    LIMIT 500
  `).all(params);

  const items = rows.map((r) => ({
    key: r.issue_key,
    unit: r.unit,
    inspect_date: r.inspect_date,
    inspector: r.inspector,
    description: r.description,
    status: r.status,
    created_at: r.created_at,
    photo_url: '/uploads/' + r.photo_path,
    rectification: r.rect_photo
      ? { photo_url: '/uploads/' + r.rect_photo, note: r.rect_note, submitted_by: r.rect_by, created_at: r.rect_at }
      : null,
  }));

  res.json({
    stats: {
      total: items.length,
      pending: items.filter((x) => x.status === 'pending').length,
      rectified: items.filter((x) => x.status === 'rectified').length,
    },
    items,
  });
});

/* ---------------- 静态资源与页面 ---------------- */

app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

// 二维码短链：/r/<key> -> 整改提交页
app.get('/r/:key', (req, res) => {
  res.redirect(`/rectify.html?key=${encodeURIComponent(req.params.key)}`);
});

app.get('/', (req, res) => res.redirect('/inspect.html'));

// 统一错误处理（含 multer 限制报错）
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: `单张图片不能超过 ${MAX_FILE_SIZE_MB}MB`,
      LIMIT_FILE_COUNT: `一次最多上传 ${MAX_FILES} 张图片`,
      LIMIT_UNEXPECTED_FILE: `一次最多上传 ${MAX_FILES} 张图片`,
    };
    return res.status(400).json({ error: map[err.code] || '上传失败：' + err.message });
  }
  console.error(err);
  res.status(400).json({ error: err.message || '请求处理失败' });
});

app.listen(PORT, () => {
  console.log(`校园食安检查系统已启动: http://localhost:${PORT}`);
  console.log('  监管老师入口: /inspect.html');
  console.log('  校领导汇总页: /admin.html');
});
