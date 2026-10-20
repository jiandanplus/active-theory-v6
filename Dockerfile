FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown -R node:node /app/data
# Includes immutable SQL migrations (including 003), engine contracts and CAS.
# Authorized runtime inputs are registered after deployment, never baked in.
COPY admin-server ./admin-server
COPY admin-ui ./admin-ui
COPY shared ./shared
COPY scripts ./scripts
COPY cms ./cms
COPY examples ./examples
COPY server.js index.html ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SITE_DATA_DIR=/app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
