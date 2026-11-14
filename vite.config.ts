import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tile pyramids only exist where source data exist. Without this, a request for a tile outside the
 * coverage would hit Vite's SPA fallback (index.html, HTTP 200) and fail image decoding.
 * Missing tiles are answered with 204 No Content, which MapLibre treats as an empty tile.
 */
function missingTiles(): Plugin {
  const handler = (root: string): Connect.NextHandleFunction => (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (url.startsWith('/data/tiles/') && !fs.existsSync(path.join(root, url))) {
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'geomars-missing-tiles',
    configureServer(server) {
      server.middlewares.use(handler(path.resolve('public')));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(path.resolve('dist')));
    },
  };
}

export default defineConfig({
  plugins: [react(), missingTiles()],
  server: { port: 5180, strictPort: true, host: 'localhost' },
  preview: { port: 4173, host: 'localhost' },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500, target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
