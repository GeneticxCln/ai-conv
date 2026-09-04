FROM node:20-alpine AS build

WORKDIR /app
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
