FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache sqlite-libs

COPY backend/package*.json ./
RUN npm install --no-audit --no-fund

COPY backend/src ./src
COPY backend/tsconfig.json ./

RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
