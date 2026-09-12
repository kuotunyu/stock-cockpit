# Stock1 對外部署映像（Zeabur 或任何 Docker 平台）。
#
# 用 glibc 的 bookworm-slim 而不是 alpine：fubon-neo 附的是 linux-x64-gnu 原生模組，musl 下載不進來。
# 映像裡沒有 .git，所以 UPDATE_CHECK 預設 off；資料一律寫到掛載的 /data（DATA_DIR），不寫進映像。
# 只能跑單一副本：資料是單一 JSON 檔＋程序內排程，兩個副本同時寫會互相覆蓋。
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Taipei \
    UPDATE_CHECK=off \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# 先裝依賴再複製程式碼：程式碼改了不必重裝 node_modules。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# /data 給平台掛 volume；node 使用者（非 root）要寫得進去。
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

# 探針只打 /api/health（唯讀、免登入、不碰上游）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
