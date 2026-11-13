import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.TATTLEJAY_API ?? 'http://127.0.0.1:7440';

export default defineConfig({
  root: 'web',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: { '/api': { target: server, changeOrigin: true } },
  },
});
