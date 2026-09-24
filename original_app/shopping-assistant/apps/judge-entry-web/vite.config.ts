import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  envPrefix: ['VITE_', 'PUBLIC_'],
  server: {
    allowedHosts: ['judge.zeabur.app', '.zeabur.app'],
  },
  preview: {
    allowedHosts: ['judge.zeabur.app', '.zeabur.app'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
        productPool: resolve(__dirname, 'product-pool.html'),
        catalog: resolve(__dirname, 'catalog.html'),
      },
    },
  },
});
