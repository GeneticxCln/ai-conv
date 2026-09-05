FROM node:26-alpine AS build

WORKDIR /app
# disturl pinned to the official release host — some node:20-alpine layers
# resolved headers via unofficial-builds.nodejs.org, which has flaked.
# Node 26 also matches CI/dev; undici@8 (backend dep) requires >= 22.19.
ENV npm_config_disturl=https://nodejs.org/download/release
RUN apk add --no-cache sqlite-libs python3 make g++

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --legacy-peer-deps --omit=optional --no-audit --no-fund

COPY packages/types ./packages/types
RUN npm run build --workspace=@ai-conv/types

COPY backend ./backend
RUN npm run build --workspace=backend

EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
