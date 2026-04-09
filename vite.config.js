import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

function swCacheBuster() {
  return {
    name: 'sw-cache-buster',
    apply: 'build',
    closeBundle() {
      const outDir = 'www';
      const swPath = join(outDir, 'service-worker.js');
      const htmlPath = join(outDir, 'index.html');

      const sw = readFileSync(swPath, 'utf8');
      const html = readFileSync(htmlPath, 'utf8');
      const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
      const nextCacheName = `meditation-timer-${hash}`;
      const updated = sw.replace(
        /const CACHE_NAME = 'meditation-timer-[^']+';/,
        `const CACHE_NAME = '${nextCacheName}';`
      );

      writeFileSync(swPath, updated, 'utf8');
    },
  };
}

export default defineConfig({
  root: '.',
  build: {
    outDir: 'www',
    emptyOutDir: true,
  },
  plugins: [swCacheBuster()],
  server: {
    port: 8080,
  },
});
