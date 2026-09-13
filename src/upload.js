'use strict';
/**
 * 图片上传（multer）：
 *  - 存盘到 UPLOAD_DIR/YYYY/MM/，文件名 = 时间戳_随机串.<扩展名>
 *  - 单张大小限制 config.MAX_FILE_MB
 *  - 仅接收 image/* 的 MIME（扩展名白名单 + 落盘后魔数复核，业务层再做）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const { sniffImage, removeQuiet } = require('./util');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const now = new Date();
    const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(config.UPLOAD_DIR, ym);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = EXT_BY_MIME[file.mimetype] || 'img';
    const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.MAX_FILE_MB * 1024 * 1024,
    files: Math.max(config.MAX_ISSUE_IMAGES, config.MAX_RECTIFY_IMAGES),
  },
  fileFilter(req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('仅支持 JPG / PNG / GIF / WEBP 格式图片'));
  },
});

/**
 * 落盘后做魔数复核；任一文件不合法则全部删除并抛错。
 * 返回 [{originalname, path(绝对), size}]
 */
async function verifyUploaded(files) {
  const out = [];
  try {
    for (const f of files) {
      const fd = await fs.promises.open(f.path, 'r');
      const head = Buffer.alloc(16);
      await fd.read(head, 0, 16, 0);
      await fd.close();
      const realExt = sniffImage(head);
      if (!realExt) throw new Error(`文件 ${f.originalname} 不是有效图片（魔数校验失败）`);
      out.push({ originalname: f.originalname, absPath: f.path, size: f.size });
    }
    return out;
  } catch (e) {
    files.forEach((f) => removeQuiet(f.path));
    throw e;
  }
}

module.exports = { upload, verifyUploaded };
