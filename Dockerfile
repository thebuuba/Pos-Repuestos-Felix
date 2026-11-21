FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js hosting.js schema.sql state.js app.js pwa.js sw.js index.html styles.css manifest.webmanifest ./
COPY icons/ ./icons/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
