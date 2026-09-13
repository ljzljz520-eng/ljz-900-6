# 校园食安检查拍照系统

监管老师现场检查、上传问题照片，系统为**每条问题生成唯一 key 和整改二维码**；
食堂负责人扫码（或输 key）查看问题、上传整改照片完成闭环；
校领导在汇总页**按检查日期和单位筛选**，查看整改进度并导出台账。

## 一、角色与使用流程

| 角色 | 入口 | 登录 | 能做什么 |
|---|---|---|---|
| 监管老师 | `/inspect.html` | 需要（`INSPECTOR_PASSWORD`） | 批量传问题图、填写位置/类别/描述/严重程度，生成 key+二维码、打印二维码、看历史整改状态 |
| 食堂负责人 | `/rectify.html?key=XXXXXXXX` | **无需登录，凭 key** | 扫码/输 key → 查看问题图与描述 → 传 1~4 张整改图 + 负责人 + 说明 → 提交 |
| 校领导 | `/dashboard.html` | 需要（`ADMIN_PASSWORD`） | 按日期区间 / 单位 / 状态筛选，总量、完成率、单位排名、类别分布、明细、导出 CSV |

典型闭环：

1. 老师在食堂现场用手机打开检查页 → 拍照（支持多选，最多 10 张/次），逐张填写问题信息 → 提交。
2. 系统为每张图生成独立 8 位 key（如 `RAKA7C3P`）与二维码，内容是
   `https://域名/rectify.html?key=RAKA7C3P`，可直接**打印发给各档口**。
3. 食堂负责人微信/系统相机扫码 → 看到问题照片 → 拍整改照提交，状态实时变「已整改」。
4. 校领导汇总页筛选统计、督办待整改项、一键导出 CSV 台账（Excel 打开不乱码）。

## 二、技术栈

- 后端：Node.js ≥18 + Express 4（仅 4 个依赖：express / multer / qrcode / better-sqlite3）
- 数据库：**SQLite（默认，零配置）**，另附 MySQL 8 建表脚本 `sql/schema.mysql.sql`
- 前端：原生 HTML/CSS/JS，无构建步骤；扫码用浏览器原生 `BarcodeDetector`（不支持时提示手输 key）
- 图片：本地磁盘存储（`uploads/YYYY/MM/时间戳_随机.扩展名`），通过 `/uploads/...` 提供访问

## 三、快速开始

```bash
# 1. 安装依赖（better-sqlite3 走预编译二进制，无需编译环境）
npm install

# 2. 准备配置（首次）
cp .env.example .env
# 生产环境务必修改两个密码与 SESSION_SECRET（openssl rand -hex 32）
# 部署到服务器时把 PUBLIC_BASE_URL 改成 https://你的域名

# 3. 启动
npm start
# → http://localhost:3000  （首次启动自动建库建表并写入 6 个示例食堂）
```

默认密码：监管老师 `inspect123`，校领导 `admin123`（仅用于演示，**生产必须改**）。

健康检查：`GET /healthz`

## 四、目录结构

```
.
├── server.js                # 服务入口：全部 API 路由
├── src/
│   ├── config.js            # .env 加载与配置项
│   ├── db.js                # SQLite 初始化/建表/种子数据
│   ├── auth.js              # HMAC 签名 token + HttpOnly Cookie + 角色中间件
│   ├── upload.js            # multer 存储/限额 + 魔数图片校验
│   └── util.js              # key 生成、审计、二维码、限流等
├── public/                  # 前端（静态直出）
│   ├── index.html           # 首页（三个角色入口）
│   ├── login.html  inspect.html  rectify.html  dashboard.html
│   ├── css/style.css
│   └── js/common.js  inspect.js  rectify.js  dashboard.js
├── sql/schema.mysql.sql     # 可选：MySQL 8 建表脚本
├── uploads/                 # 图片落盘目录（按 年/月 分目录，需持久化）
├── data/                    # SQLite 数据库目录（需持久化）
├── deploy/                  # nginx 与 systemd 模板
├── Dockerfile  docker-compose.yml
└── .env.example
```

## 五、数据库表

默认 SQLite，启动自动创建：

- **units**：受检单位（id、名称唯一、创建时间）。
- **issues**：问题单（**一问题一记录一 key**）
  `id, issue_key(唯一8位), unit_id, inspect_date(检查日期), location(位置),
   category(类别), description(描述), inspector(检查人),
   severity(一般/较重/严重), status(待整改/已整改),
   problem_images(JSON 问题图), rectify_images(JSON 整改图),
   rectify_note, rectify_contact, rectified_at, created_at`；
  在 `inspect_date / unit_id / status` 上建有索引支撑汇总筛选。
- **audit_logs**：登录、建单、整改提交、新建单位等操作审计（角色、动作、IP、时间）。

MySQL 表结构见 `sql/schema.mysql.sql`（字段一一对应，图片列用 JSON 类型）。

## 六、上传限制与图片存储策略

| 项目 | 默认值 | 配置项 |
|---|---|---|
| 单张图片大小 | 8 MB | `MAX_FILE_MB` |
| 一次检查问题图数量 | 10 张 | `MAX_ISSUE_IMAGES` |
| 一次整改图数量 | 4 张 | `MAX_RECTIFY_IMAGES` |
| 允许格式 | JPG / PNG / GIF / WEBP | MIME 白名单 + **文件魔数双重校验** |
| 图片保存位置 | `uploads/YYYY/MM/` | `UPLOAD_DIR` |
| 文件命名 | `毫秒时间戳_12位随机hex.扩展名`（不可猜测） | — |
| 浏览器缓存 | `/uploads` 7 天 | — |

安全措施：MIME 白名单（multer fileFilter，拒绝即返回 400）、落盘后读前 16 字节做
magic bytes 复核（防止改扩展名伪造，校验失败删除全部当批文件）、文件名随机化、
整改接口按 IP 限流（查询 30 次/分、提交 10 次/分）、整改只能提交一次（重复 409）、
`X-Content-Type-Options: nosniff` 等安全响应头、key 去易混字符（无 0/O/1/I/L）。

> 备份：定期备份 `data/` 与 `uploads/` 两个目录即可完整恢复（图片在库里只存相对路径）。

## 七、API 一览

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 公开 | body: `{role: inspector\|admin, password}`，写 HttpOnly Cookie |
| POST | `/api/logout` | 登录 | 退出 |
| GET | `/api/me` | 公开 | 当前登录角色 |
| GET | `/api/units` | 登录 | 单位列表 |
| POST | `/api/units` | 监管老师 | 新增单位（重名自动复用） |
| POST | `/api/inspector/issues` | 监管老师 | multipart：`photos`（多图）+ `meta`(JSON，含每张图的位置/类别/描述/严重程度)，返回每图 key 与二维码 dataURL |
| GET | `/api/inspector/issues` | 监管老师 | 近 200 条问题（含二维码、整改状态） |
| GET | `/api/rectify/:key` | 公开（限流） | 凭 key 查问题详情（只返回该单） |
| POST | `/api/rectify/:key` | 公开（限流） | multipart：整改 `photos` + `contact` + `note` |
| GET | `/api/admin/summary` | 校领导 | `from,to,unitId,status` 筛选统计与明细 |
| GET | `/api/admin/export.csv` | 校领导 | 同筛选条件导出 CSV（带 UTF-8 BOM） |

## 八、部署说明

### 方式 A：裸机 + systemd + nginx（推荐用于校内服务器）

```bash
sudo useradd -r foodservice || true
sudo mkdir -p /opt/food-safety && sudo chown -R foodservice /opt/food-safety
sudo -u foodservice rsync -a --exclude node_modules ./ /opt/food-safety/
cd /opt/food-safety
sudo -u foodservice npm install --omit=dev
sudo cp deploy/food-safety.service /etc/systemd/system/
sudo systemctl enable --now food-safety     # 监听 127.0.0.1:3000（默认全网卡，建议用防火墙限本机）

# nginx + HTTPS（手机网页扫码必须 https）
sudo cp deploy/nginx-food-safety.conf /etc/nginx/conf.d/
# 改 server_name 与证书路径，client_max_body_size 略大于 MAX_FILE_MB
sudo nginx -t && sudo systemctl reload nginx
```

记得在 `.env` 设置 `PUBLIC_BASE_URL=https://safety.example.edu.cn`
（二维码里的链接用它生成；留空则按请求 Host 自动推断）。

### 方式 B：Docker / docker-compose

```bash
# 编辑 docker-compose.yml 中的域名、密码、SESSION_SECRET
docker compose up -d --build
# 数据持久化在宿主机 ./data 与 ./uploads
```

镜像基于 `node:20-bookworm-slim`，better-sqlite3 使用预编译二进制，构建无需 gcc。

### 方式 C：最简内网试运行

`npm start` 后用同一 Wi-Fi 访问 `http://电脑内网IP:3000` 即可（注意：明文 HTTP 下
手机浏览器通常禁止网页端调摄像头，可用微信/系统相机扫打印出的二维码、或手动输入 key）。

### 上线检查清单

- [ ] `.env`：改 `INSPECTOR_PASSWORD`、`ADMIN_PASSWORD`、`SESSION_SECRET`
- [ ] 设置 `PUBLIC_BASE_URL` 为正式 HTTPS 域名
- [ ] 配置 HTTPS 证书（网页摄像头/扫码需要安全上下文）
- [ ] nginx `client_max_body_size` ≥ `MAX_FILE_MB + 余量`
- [ ] 持久化并定期备份 `data/`、`uploads/`
- [ ] 用防火墙限制 3000 端口仅对 nginx 暴露
- [ ] 打印二维码样张，确认食堂手机扫码能打开整改页

## 九、常见问题

- **二维码扫不开**：`PUBLIC_BASE_URL` 必须是手机网络可达的地址；校内系统确认已接入校园网/做外网映射。
- **网页内扫码按钮不可用**：部分浏览器无 `BarcodeDetector`，可直接用微信/相机扫二维码，或手输 8 位 key。
- **导出 CSV 用 Excel 打开乱码**：响应已带 UTF-8 BOM；如仍异常，请用「数据 → 自文本」以 UTF-8 导入。
- **想换成 MySQL**：参照 `sql/schema.mysql.sql` 建库，并把 `src/db.js` 与路由中的
  better-sqlite3 语句替换为 mysql2（JSON 列直接存 JSON 字符串即可）。
