/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev-only: forward API traffic to the nodejs container (compose service
  // DNS on the shared network) so the app can use origin-relative URLs.
  // Prod has no vite — Caddy plays this role for the static build.
  server: {
    host: true,
    proxy: {
      '/api':     { target: 'http://nodejs:3000', changeOrigin: true },
      '/graphql': { target: 'http://nodejs:3000', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  }
})
