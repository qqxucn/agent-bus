import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/panel/',
  server: {
    port: 4324,
    proxy: {
      '/api': 'http://localhost:4322',
      '/health': 'http://localhost:4322',
    },
  },
})
