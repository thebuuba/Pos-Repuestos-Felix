FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./frontend/
COPY src/ ./src/
COPY public/assets/brand/repuestos-felix.jpg ./public/assets/brand/repuestos-felix.jpg
COPY scripts/build-operational.mjs ./scripts/
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/dist/operational ./dist/operational
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
