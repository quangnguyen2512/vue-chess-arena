import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const wsTarget = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
      },
      '/health': {
        target: wsTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
})
