/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read .env from project root (parent directory)
  envDir: '..',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-codemirror': [
            '@codemirror/autocomplete',
            '@codemirror/commands',
            '@codemirror/lang-markdown',
            '@codemirror/language',
            '@codemirror/search',
            '@codemirror/state',
            '@codemirror/view',
            '@uiw/react-codemirror',
          ],
          'vendor-milkdown': [
            '@milkdown/kit',
            '@milkdown/react',
            '@milkdown/theme-nord',
            '@milkdown/plugin-listener',
          ],
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
