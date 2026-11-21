FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server.js hosting.js schema.sql state.js app.js pwa.js sw.js index.html styles.css manifest.webmanifest ./
COPY icons/ ./icons/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
