#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'frontend', 'dist');
const PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  let rawUrl = (req.url || '/').split('?')[0];
  try {
    rawUrl = decodeURIComponent(rawUrl);
  } catch {
    // malformed URI encoding fallback
  }
  const cleanRelPath = path.normalize(rawUrl).replace(/^(\/|\\)+/, '');
  const distRoot = path.resolve(DIST);
  let targetPath = path.resolve(distRoot, cleanRelPath === '' ? 'index.html' : cleanRelPath);

  // Containment check: target must strictly be inside DIST
  if (!targetPath.startsWith(distRoot + path.sep) && targetPath !== path.join(distRoot, 'index.html')) {
    targetPath = path.join(distRoot, 'index.html');
  }

  // SPA fallback: if file doesn't exist or is a directory, serve index.html
  try {
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(distRoot, 'index.html');
    }
  } catch {
    targetPath = path.join(distRoot, 'index.html');
  }
  const filePath = targetPath;
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend serving on http://localhost:${PORT}`);
});
