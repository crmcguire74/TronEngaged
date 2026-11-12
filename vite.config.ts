import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 npm run dev  -> self-signed HTTPS so a headset on the LAN can enter WebXR.
export default defineConfig({
  base: './',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: { port: 5188 },
  preview: { port: 5189 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
} as any);
