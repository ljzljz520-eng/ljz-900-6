'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');

// 启动时确保上传目录存在
fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // 位于 nginx 反代之后时取真实 IP

// 基础安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '256kb' }));

// API 路由
app.use('/api/inspections', require('./routes/inspections'));
app.use('/api/rectifications', require('./routes/rectifications'));
app.use('/api/admin', require('./routes/admin'));

// 静态资源：页面 + 上传的图片（图片文件名随机，不可枚举）
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/uploads', express.static(config.uploadDir, {
  index: false,
  maxAge: '7d',
  immutable: true,
}));

// 根路径跳转到老师上传页
app.get('/', (req, res) => res.redirect('/upload.html'));

// multer 错误（文件超限等）友好提示
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `图片超过大小限制（最大 ${(config.upload.maxFileSize / 1024 / 1024).toFixed(0)}MB）`,
    });
  }
  if (err && (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')) {
    return res.status(400).json({ error: `一次最多上传 ${config.upload.maxFilesPerInspection} 张图片` });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[server error]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(config.port, () => {
  console.log(`校园食安检查系统已启动: ${config.baseUrl} (端口 ${config.port})`);
  console.log(`  监管老师上传页: ${config.baseUrl}/upload.html`);
  console.log(`  校领导汇总页:   ${config.baseUrl}/admin.html`);
});
