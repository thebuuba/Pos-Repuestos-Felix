FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src/ ./src/
COPY public/ ./public/
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
