# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY server.js ./
COPY db ./db
COPY package.json ./
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "server.js"]
