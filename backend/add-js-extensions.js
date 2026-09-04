import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

function processDir(dir) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      processDir(fullPath);
    } else if (extname(file) === '.js') {
      let content = readFileSync(fullPath, 'utf8');
      // Add .js to relative imports that don't already have it
      content = content.replace(/from '(\.\.?\/[^']+?)(\.js)?'/g, "from '$1.js'");
      content = content.replace(/from "(\.\.?\/[^']+?)(\.js)?"/g, 'from "$1.js"');
      writeFileSync(fullPath, content);
    }
  }
}

processDir('dist');
console.log('Added .js extensions to all relative imports');
