# 校园食安检查拍照系统 —— 生产镜像
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# better-sqlite3 使用预编译二进制，无需编译工具链
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000
USER node
CMD ["node", "server.js"]
