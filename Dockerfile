FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && node -e "new (require('better-sqlite3'))(':memory:')"
COPY . .
ENV DATA_DIR=/app/data PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
