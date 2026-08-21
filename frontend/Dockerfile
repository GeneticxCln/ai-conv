# Build stage: compile the Vite production bundle.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Runtime stage: serve the static bundle via nginx.
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback: route unknown paths to index.html; proxy /health to the backend.
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
