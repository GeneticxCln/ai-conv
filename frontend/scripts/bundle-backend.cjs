#!/usr/bin/env node

/**
 * bundle-backend.js
 * Copies backend/dist and needed node_modules into electron resources
 * so the packaged app can run the backend without external dependencies.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const RESOURCES = path.join(__dirname, '..', 'resources', 'backend');

// Clean
if (fs.existsSync(RESOURCES)) fs.rmSync(RESOURCES, { recursive: true });
fs.mkdirSync(RESOURCES, { recursive: true });

// Copy dist/ (use fs.cpSync to avoid shell quoting issues with paths containing spaces)
console.log('Copying backend/dist...');
fs.cpSync(path.join(BACKEND, 'dist'), path.join(RESOURCES, 'dist'), { recursive: true });

// Also copy migration SQL files (TypeScript doesn't copy non-.ts assets)
const MIGRATIONS_SRC = path.join(BACKEND, 'src', 'storage', 'migrations');
const MIGRATIONS_DST = path.join(RESOURCES, 'dist', 'storage', 'migrations');
if (fs.existsSync(MIGRATIONS_SRC)) {
  fs.mkdirSync(MIGRATIONS_DST, { recursive: true });
  for (const f of fs.readdirSync(MIGRATIONS_SRC)) {
    if (f.endsWith('.sql')) fs.copyFileSync(path.join(MIGRATIONS_SRC, f), path.join(MIGRATIONS_DST, f));
  }
  console.log('Copied migration SQL files');
}

// Copy package.json — strip @ai-conv/types dependency (we copy it directly below)
console.log('Copying backend/package.json...');
const pkgJson = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf-8'));
if (pkgJson.dependencies) delete pkgJson.dependencies['@ai-conv/types'];
// npm 11 requires native build permissions to be declared in the package
// being installed. Preserve the workspace policy for better-sqlite3.
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
if (rootPkg.allowScripts) pkgJson.allowScripts = rootPkg.allowScripts;
fs.writeFileSync(path.join(RESOURCES, 'package.json'), JSON.stringify(pkgJson, null, 2));

// The host npm configuration disallows project-scoped installs. Copy the
// already-installed workspace dependency tree instead; this also preserves
// the native better-sqlite3 binary built during the normal workspace setup.
const workspaceNodeModules = path.join(ROOT, 'node_modules');
const bundledNodeModules = path.join(RESOURCES, 'node_modules');
console.log('Copying workspace runtime dependencies...');
fs.cpSync(workspaceNodeModules, bundledNodeModules, {
  recursive: true,
  dereference: true,
  filter: (sourcePath) => {
    if (sourcePath !== workspaceNodeModules) {
      try {
        if (fs.lstatSync(sourcePath).isSymbolicLink()) return false;
      } catch {
        return false;
      }
      const rel = path.relative(workspaceNodeModules, sourcePath);
      const topPkg = rel.split(path.sep)[0];
      const devPackages = [
        'playwright', '@playwright', 'electron', 'electron-builder', 'typescript',
        'eslint', '@typescript-eslint', 'vitest', 'vite', 'esbuild', '@vitejs',
        'postcss', 'tailwindcss', 'autoprefixer', '@esbuild', '@rollup',
      ];
      if (devPackages.includes(topPkg) || devPackages.some((pkg) => rel.startsWith(pkg + path.sep))) {
        return false;
      }
    }
    return !sourcePath.includes(`${path.sep}.cache${path.sep}`);
  },
});
console.log('Copied workspace runtime dependencies');

// linuxdeploy (AppImage bundling) walks every ELF in the app and aborts the
// whole bundle when it cannot resolve a dependency. better-sqlite3 ships a
// musl prebuild next to the glibc one; the musl binary needs
// libc.musl-x86_64.so.1, which glibc distros do not have, so the AppImage step
// died with "Could not find dependency: libc.musl-x86_64.so.1". Musl artifacts
// are unusable on a glibc host, so drop them from the bundle.
function pruneMuslArtifacts(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (/musl/i.test(entry.name)) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log('  pruned musl artifact:', path.relative(RESOURCES, full));
      continue;
    }
    if (entry.isDirectory()) pruneMuslArtifacts(full);
  }
}

const glibcHost = process.platform === 'linux' && Boolean(
  process.report?.getReport?.().header?.glibcVersionRuntime,
);
if (glibcHost) pruneMuslArtifacts(bundledNodeModules);

// Copy @ai-conv/types directly into node_modules after the dependency copy
// because workspace links are intentionally excluded above.
const TYPES_SRC = path.join(ROOT, 'packages', 'types');
const TYPES_DST = path.join(RESOURCES, 'node_modules', '@ai-conv', 'types');
if (fs.existsSync(TYPES_SRC)) {
  fs.mkdirSync(TYPES_DST, { recursive: true });
  fs.copyFileSync(path.join(TYPES_SRC, 'package.json'), path.join(TYPES_DST, 'package.json'));
  if (fs.existsSync(path.join(TYPES_SRC, 'dist'))) {
    fs.cpSync(path.join(TYPES_SRC, 'dist'), path.join(TYPES_DST, 'dist'), { recursive: true });
  }
  console.log('Copied @ai-conv/types package');
}

console.log('Backend bundled to', RESOURCES);
