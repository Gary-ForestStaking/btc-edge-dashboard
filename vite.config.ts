import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dashboard',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
});
