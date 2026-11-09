import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    target: 'node18',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'cli.js',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
