FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/server/data && chown node:node /app/server/data
COPY --chown=node:node server ./server
COPY --chown=node:node api ./api
COPY --chown=node:node trading ./trading
COPY --chown=node:node position ./position
USER node
ENV NODE_ENV=production TRADING_HOST=0.0.0.0 TRADING_PORT=4190 TRADING_DATA_PATH=/app/server/data/trading.sqlite
CMD ["node", "server/main.mjs"]
