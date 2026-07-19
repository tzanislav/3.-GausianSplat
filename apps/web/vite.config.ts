import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const localDevIp = loadEnv(mode, envDir, '').LOCAL_DEV_IP?.trim();

  return {
    envDir,
    plugins: [react()],
    server: {
      // Bind every local interface only when the user has explicitly opted into LAN testing.
      // The Vite proxy continues to keep the API on the loopback interface.
      host: localDevIp ? true : 'localhost',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
