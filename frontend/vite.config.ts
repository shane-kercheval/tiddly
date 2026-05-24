/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { proseContentPlugin } from './plugins/proseContent'
import { dataContentPlugin } from './plugins/dataContent'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), proseContentPlugin(), dataContentPlugin()],
  // Read .env from project root (parent directory)
  envDir: '..',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': [
            'react',
            'react-dom',
            'react-router-dom',
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
