FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data /app/assets && chown -R node:node /app/data
# Includes SQL migrations and the engine-assets.json installation manifest.
COPY admin-server ./admin-server
COPY admin-ui ./admin-ui
COPY scripts ./scripts
COPY cms ./cms
COPY server.js index.html ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SITE_DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
