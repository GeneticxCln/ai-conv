# Build stage: install the root workspace and compile the Vite bundle.
FROM node:26-alpine AS build
WORKDIR /app

# Match CI/dev Node (undici@8 needs >= 22.19) and pin node-gyp headers to
# the official dist host — unofficial-builds has flaked with ECONNRESET.
ENV npm_config_disturl=https://nodejs.org/download/release

# The root workspace installs better-sqlite3 even for the frontend build,
# so provide the native module toolchain before npm ci.
RUN apk add --no-cache sqlite-libs python3 make g++

ARG VITE_WS_URL=http://localhost:3001
ARG VITE_API_URL=http://localhost:3001
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY packages/types ./packages/types
RUN npm run build --workspace=@ai-conv/types
COPY frontend ./frontend
RUN npm run build --workspace=frontend

# Development target: the source mounts are supplied by docker-compose.dev.yml.
FROM build AS dev
WORKDIR /app
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=frontend", "--", "--host", "0.0.0.0"]

# Runtime stage: serve the static bundle via nginx.
FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html

RUN printf '%s\n' \
    'server {' \
    '  listen 5173;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '  location = /health { proxy_pass http://backend:3001; }' \
    '  location / { try_files $uri $uri/ /index.html; }' \
    '}' > /etc/nginx/conf.d/default.conf

EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
