# 校园食品安全检查拍照整改系统

## 角色与流程

| 角色 | 入口 | 操作 |
|---|---|---|
| 监管老师 | `/inspect.html` | 填写单位/日期，上传问题照片 → 系统为**每张图生成唯一 key 和二维码**（可打印） |
| 食堂负责人 | 扫码打开 `/r/<key>` | 查看问题照片，提交整改照片与说明 |
| 校领导 | `/admin.html` | 按**检查日期 + 单位 + 状态**筛选，对照查看问题图与整改图 |

技术栈：Node.js 18+ / Express / SQLite（better-sqlite3，免安装数据库服务）/ 原生 HTML+JS（移动端优先，无需构建）。

## 目录结构

```
campus-food-safety/
├── server.js            # Express 服务与全部 API
├── db.js                # SQLite 建表（首次启动自动执行）
├── package.json
├── public/              # 三个前端页面 + 公共 css/js
│   ├── inspect.html     # 监管老师：问题拍照上传
│   ├── rectify.html     # 食堂负责人：扫码整改
│   └── admin.html       # 校领导：汇总筛选
├── data/app.db          # SQLite 数据库（运行时生成）
└── uploads/             # 图片存储（运行时生成）
    ├── issues/YYYY-MM-DD/xxxx.jpg          # 问题照片
    └── rectifications/YYYY-MM-DD/xxxx.jpg  # 整改照片
```

## 数据库表

- **inspections**：检查记录。`unit + inspect_date` 唯一约束，同一单位同一天自动归为同一次检查。
- **issues**：问题照片。`issue_key` 全局唯一（8 位，去掉 0/O、1/I 易混淆字符），`status` 为 `pending/rectified`。
- **rectifications**：整改照片。允许同一问题多次提交（历史留痕），汇总页展示最新一条。

## 图片存储

- 客户端上传前自动压缩（最长边 1600px、JPEG 0.82），省流量省空间；
- 服务端**魔数（文件头）校验**真实格式，防止改后缀伪装；
- 文件名为 `时间戳-UUID`，按日期分目录存放，直接通过 `/uploads/...` 访问。

## 上传限制（可用环境变量调整）

| 限制 | 默认值 | 环境变量 |
|---|---|---|
| 单张图片大小 | 5 MB | `MAX_FILE_SIZE_MB` |
| 每批照片数量 | 9 张 | `MAX_FILES_PER_UPLOAD` |
| 允许格式 | JPG / PNG / WebP（MIME + 魔数双重校验） | — |
| 上传接口限流 | 每 IP 10 分钟 60 次 | — |
| 问题描述 / 整改说明 | ≤ 200 字 | — |
| 单位 / 姓名 | ≤ 50 字 | — |

## 快速开始

```bash
cd campus-food-safety
npm install
npm start
# 打开 http://服务器IP:3000
```

> 页面使用手机浏览器的文件选择器拍照，**不强制要求 HTTPS**，内网 IP 直接可用。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `BASE_URL` | 自动取请求 Host | 二维码中编码的对外地址，**经过反向代理时建议显式设置**，如 `https://food.school.edu.cn` |
| `MAX_FILE_SIZE_MB` | `5` | 单张图片上限 |
| `MAX_FILES_PER_UPLOAD` | `9` | 每批上传张数上限 |
| `DATA_DIR` | `./data` | 数据库目录 |
| `UPLOAD_DIR` | `./uploads` | 图片目录 |
| `TZ` | 系统默认 | 建议设为 `Asia/Shanghai`，保证日期分目录与时间戳正确 |

## 生产部署

### 方式一：systemd（裸机/虚拟机）

`/etc/systemd/system/foodsafety.service`：

```ini
[Unit]
Description=Campus Food Safety Inspection
After=network.target

[Service]
WorkingDirectory=/opt/campus-food-safety
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=BASE_URL=https://food.school.edu.cn
Environment=TZ=Asia/Shanghai

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now foodsafety
```

### 方式二：Docker

```bash
docker compose up -d --build   # 或：docker build -t foodsafety . && docker run -d -p 3000:3000 -v $PWD/data:/app/data -v $PWD/uploads:/app/uploads foodsafety
```

### nginx 反向代理（可选，含汇总页密码保护）

```nginx
server {
    listen 80;
    server_name food.school.edu.cn;
    client_max_body_size 60m;   # 必须 >= 单张上限 × 每批张数

    # 校领导汇总页加 Basic Auth（htpasswd -c /etc/nginx/.htpasswd leader）
    location = /admin.html {
        auth_basic "校领导专用";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3000;
    }
    location /api/summary {
        auth_basic "校领导专用";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

## 备份与恢复

只需定期备份两处：`data/app.db`（数据库）和 `uploads/`（图片）。恢复时放回原目录重启即可。

```bash
tar czf foodsafety-backup-$(date +%F).tar.gz data uploads
```

## 常见问题

- **iPhone 照片是 HEIC？** iOS 通过文件选择器上传时会自动转为 JPEG；若个别机型未转换，服务端会拒绝并提示。
- **二维码扫出的地址不对？** 设置 `BASE_URL` 为对外访问地址后重新生成。
- **时间/日期不对？** 设置环境变量 `TZ=Asia/Shanghai`。
- **数据量大了怎么办？** SQLite 支撑数万条记录无压力；单次汇总查询上限 500 条，按日期筛选即可。
