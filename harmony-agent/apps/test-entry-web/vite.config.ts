import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  envDir: resolve(__dirname, '../..'),
  envPrefix: ['VITE_', 'PUBLIC_'],
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
        productPool: resolve(__dirname, 'product-pool.html'),
        catalog: resolve(__dirname, 'catalog.html'),
        runtime: resolve(__dirname, 'runtime.html'),
      },
    },
  },
});
