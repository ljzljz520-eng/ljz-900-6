'use strict';
const path = require('path');

/**
 * 全局配置 —— 所有项均可通过环境变量覆盖，便于部署
 */
module.exports = {
  // 服务监听端口
  port: parseInt(process.env.PORT || '3000', 10),

  // 对外访问地址（生成二维码用）。部署时必须改为实际域名/IP，
  // 例如: https://spaq.myschool.edu.cn 或 http://192.168.1.10:3000
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  // 校领导汇总页访问令牌（务必在部署时修改！）
  adminToken: process.env.ADMIN_TOKEN || 'change-me-admin-token',

  // 上传限制
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(8 * 1024 * 1024), 10), // 单文件最大 8MB
    maxFilesPerInspection: 9,   // 一次检查最多上传 9 张问题图
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
  },

  // 整改提交限流：同一 IP 在 windowMs 内最多 max 次提交
  rateLimit: {
    windowMs: 10 * 60 * 1000,
    max: 30,
  },

  // 路径
  dbFile: process.env.DB_FILE || path.join(__dirname, 'data', 'foodsafety.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
};
