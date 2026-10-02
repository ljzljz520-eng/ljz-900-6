FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000 NODE_ENV=production TZ=Asia/Shanghai
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000
CMD ["node", "server.js"]
