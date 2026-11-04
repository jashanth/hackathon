import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${loadEnv(mode, '.', 'PORT').PORT || 3001}`,
    },
  },
}))
