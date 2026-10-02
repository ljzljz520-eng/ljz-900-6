# 校园食品安全检查拍照整改系统

面向学校食堂的轻量级食安检查闭环工具：**监管老师上传问题照片 → 系统为每张照片生成整改 key 和二维码 → 食堂负责人扫码提交整改照片 → 校领导按日期/单位汇总查看**。

零外部服务依赖（SQLite + 本地文件存储），一台普通服务器或校园网内主机即可运行。

---

## 一、角色与使用流程

```
监管老师                系统                     食堂负责人              校领导
   │                     │                          │                     │
   │ 1.打开 /upload.html  │                          │                     │
   │  填单位/日期/问题     │                          │                     │
   │  拍问题照片(可多张)   │                          │                     │
   │─────────────────────▶│                          │                     │
   │                     │ 2.每张图生成 key+二维码     │                     │
   │◀─────────────────────│                          │                     │
   │ 3.打印二维码贴在问题处 │                          │                     │
   │                     │◀── 4.微信扫码打开整改页 ───│                     │
   │                     │◀── 5.拍整改照+姓名提交 ────│                     │
   │                     │                          │                     │
   │                     │ 6.打开 /admin.html        │                     │
   │                     │   按日期/单位筛选 ◀────────│─────────────────────│
```

| 角色 | 页面 | 访问方式 |
|------|------|----------|
| 监管老师 | `/upload.html` | 直接打开（建议仅校园网内访问） |
| 食堂负责人 | `/rectify.html?key=XXX` | 扫二维码自动带入 key，无需记地址 |
| 校领导 | `/admin.html` | 需输入管理员令牌（`ADMIN_TOKEN`） |

---

## 二、功能清单

- ✅ 一次检查可上传最多 **9 张**问题图，**每张图独立生成整改 key 和二维码**（可打印张贴）
- ✅ 手机端拍照后**自动压缩**（最长边 1600px）再上传，节省流量
- ✅ 食堂负责人凭 key 提交整改照；同一 key 可重复提交，**历史记录全部保留**，最新一条生效
- ✅ 校领导汇总页：按**检查日期区间 + 单位 + 整改状态**筛选，问题图/整改图左右对照，点击放大
- ✅ 统计看板（总数/已整改/待整改）+ **CSV 导出**（带 BOM，Excel 直接打开）
- ✅ 上传安全：文件头魔数校验（防伪装图片）、大小限制、整改接口限流、防目录遍历
- ✅ 图片按 `年-月` 分目录存储，文件名随机不可枚举

## 三、技术栈与目录结构

Node.js (≥18) + Express + better-sqlite3 + multer + qrcode，前端为无构建的原生 HTML/JS。

```
campus-food-safety/
├── server.js            # 入口：中间件、静态资源、错误处理
├── config.js            # 全部配置（环境变量可覆盖）
├── db.js                # SQLite 连接与建表
├── util.js              # key 生成 / 图片魔数校验 / 落盘 / 限流
├── routes/
│   ├── inspections.js   #   老师上传 + 凭 key 查询
│   ├── rectifications.js#   负责人提交整改（限流）
│   └── admin.js         #   校领导汇总/统计/导出（令牌鉴权）
├── public/              # 三个页面 + 公共样式脚本
│   ├── upload.html      #   监管老师：问题上报、生成二维码（可打印）
│   ├── rectify.html     #   食堂负责人：扫码提交整改
│   └── admin.html       #   校领导：筛选汇总、对照查看、导出
├── uploads/             # 图片存储（运行时自动创建，勿提交 git）
│   ├── problems/2026-10/<随机名>.jpg
│   └── rectifications/2026-10/<随机名>.jpg
└── data/foodsafety.db   # SQLite 数据库（运行时自动创建）
```

## 四、数据库表结构

```sql
-- 检查记录：一行 = 一张问题图 = 一个整改 key
CREATE TABLE inspections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key      TEXT NOT NULL UNIQUE,        -- 整改 key，如 K7X9-M2PQ-4R8W
  unit_name       TEXT NOT NULL,               -- 被检单位（食堂/档口）
  location        TEXT NOT NULL DEFAULT '',    -- 具体位置
  description     TEXT NOT NULL DEFAULT '',    -- 问题描述
  inspector_name  TEXT NOT NULL DEFAULT '',    -- 检查人
  inspection_date TEXT NOT NULL,               -- 检查日期 YYYY-MM-DD
  problem_image   TEXT NOT NULL,               -- 问题图相对路径
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','rectified')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 整改记录：一条检查可多次提交，取最新一条为当前状态
CREATE TABLE rectifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id   INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  image           TEXT NOT NULL,               -- 整改图相对路径
  submitter_name  TEXT NOT NULL DEFAULT '',
  submitter_phone TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 索引：按日期/单位/状态筛选、按检查记录查整改
CREATE INDEX idx_inspections_date   ON inspections(inspection_date);
CREATE INDEX idx_inspections_unit   ON inspections(unit_name);
CREATE INDEX idx_inspections_status ON inspections(status);
CREATE INDEX idx_rect_inspection    ON rectifications(inspection_id);
```

## 五、图片存储方案

- **位置**：`uploads/problems/YYYY-MM/` 与 `uploads/rectifications/YYYY-MM/`，按月分目录便于归档和备份
- **文件名**：`crypto.randomBytes(16)` 生成的 32 位十六进制随机名，**不可枚举、不可猜测**，与整改 key 无关联
- **访问**：通过 `/uploads/**` 静态路由提供，禁列目录，7 天浏览器缓存
- **校验**：写入前检查文件头魔数（JPEG `FFD8FF` / PNG `89504E47` / WebP `RIFF..WEBP`），伪装扩展名的文件直接拒绝
- **数据库只存相对路径**（如 `problems/2026-10/ab12….jpg`），迁移目录时无需改库

## 六、上传限制

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| 单张图片大小 | **8 MB** | 环境变量 `MAX_FILE_SIZE` 可调 |
| 单次检查图片数 | **9 张** | `config.upload.maxFilesPerInspection` |
| 允许格式 | JPG / PNG / WebP | 服务端魔数 + 前端 MIME 双重校验 |
| 整改提交限流 | 每 IP 10 分钟 30 次 | 防暴力枚举 key |
| 前端压缩 | 最长边 1600px，JPEG 85% | 手机原图通常 3-12MB，压缩后约 200-500KB |

## 七、API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/inspections` | 无* | 老师提交检查（multipart，字段 `photos` 多图），返回 key+二维码 |
| GET | `/api/inspections/:key` | key 即凭证 | 扫码后查询问题详情与当前整改状态 |
| POST | `/api/rectifications/:key` | key 即凭证+限流 | 提交整改照片（multipart，字段 `photo`） |
| GET | `/api/admin/summary` | Bearer 令牌 | 汇总列表，参数 `date_from/date_to/unit/status/page/page_size` |
| GET | `/api/admin/stats` | Bearer 令牌 | 统计数字（同筛选参数） |
| GET | `/api/admin/units` | Bearer 令牌 | 单位下拉列表 |
| GET | `/api/admin/export` | Bearer 令牌 | 导出 CSV |

\* 老师上传页建议通过网络层（防火墙/反向代理 IP 白名单）限制为校园网可访问。

## 八、部署说明

### 1. 环境要求

- Node.js **≥ 18**（推荐 20 LTS）；Linux/Windows/macOS 均可
- 磁盘：按每张图约 300KB 估算，1 万张约 3GB

### 2. 安装与启动

```bash
git clone <仓库地址> && cd campus-food-safety
npm install --omit=dev

# 必改的环境变量
export BASE_URL="https://spaq.school.edu.cn"   # 对外访问地址，用于生成二维码
export ADMIN_TOKEN="请改成强随机令牌"            # 校领导汇总页令牌
export PORT=3000

npm start
```

> ⚠️ `BASE_URL` 必须是**手机扫码后能访问到的地址**（域名或内网 IP），
> 否则二维码会指向 localhost 无法打开。改地址不影响已入库数据，但**已打印的二维码需重新生成**。

### 3. 开机自启（systemd）

```ini
# /etc/systemd/system/foodsafety.service
[Unit]
Description=Campus Food Safety Inspection
After=network.target

[Service]
WorkingDirectory=/opt/campus-food-safety
Environment=PORT=3000
Environment=BASE_URL=https://spaq.school.edu.cn
Environment=ADMIN_TOKEN=请改成强随机令牌
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now foodsafety
```

### 4. Nginx 反向代理 + HTTPS（推荐）

```nginx
server {
    listen 443 ssl;
    server_name spaq.school.edu.cn;
    ssl_certificate     /etc/nginx/ssl/spaq.crt;
    ssl_certificate_key /etc/nginx/ssl/spaq.key;

    client_max_body_size 90m;   # 9 张 × 8MB + 表单开销

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- 证书可向学校信息化部门申请，或使用 Let's Encrypt（`certbot --nginx`）
- 仅内网使用时可省略 HTTPS，`BASE_URL` 填 `http://内网IP:3000`

### 5. 数据备份

SQLite 开了 WAL，推荐停机或使用在线备份命令：

```bash
# 每天凌晨备份数据库和图片（cron 示例）
0 2 * * * sqlite3 /opt/campus-food-safety/data/foodsafety.db ".backup '/backup/fs-$(date +\%F).db'" \
  && tar czf /backup/uploads-$(date +\%F).tar.gz -C /opt/campus-food-safety uploads
```

恢复：停止服务 → 替换 `data/foodsafety.db` 与 `uploads/` → 启动。

### 6. 安全 checklist

- [ ] `ADMIN_TOKEN` 已改为强随机值（`openssl rand -hex 24`）
- [ ] `BASE_URL` 已改为实际对外地址
- [ ] 已启用 HTTPS（手机扫码提交涉及照片与姓名电话）
- [ ] `/upload.html` 已通过防火墙或 nginx `allow/deny` 限制为校园网段
- [ ] 已配置定时备份

## 九、常见问题

**Q：二维码打印后换了域名怎么办？**
A：key 本身不变，重新打印即可；或在 nginx 把旧域名 301 到新域名。

**Q：负责人提交错了照片？**
A：用同一二维码再次提交即可覆盖当前状态，旧照片仍在数据库中留痕。

**Q：想换 MySQL？**
A：业务 SQL 集中在 `db.js` 与 `routes/` 的 prepare 语句中，均为标准 SQL，替换驱动并调整占位符即可。
