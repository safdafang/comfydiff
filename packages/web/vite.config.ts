import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Build only: the dev server needs a websocket for hot reload.
const csp = (): Plugin => ({
  name: 'comfydiff-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: './',
  plugins: [csp()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0 },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});
