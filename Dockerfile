# Сборка мини-приложения
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx vite build

# Сервер: TypeScript исполняется напрямую, сборки нет
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/vdvoyom.db \
    DATA_DIR=/app/server/data \
    WEB_DIST=/app/web/dist \
    NODE_OPTIONS=--dns-result-order=ipv6first
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=web /web/dist /app/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.ts"]
