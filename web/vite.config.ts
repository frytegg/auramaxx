import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        calibrate: resolve(__dirname, 'calibrate.html'),
        screen: resolve(__dirname, 'screen.html'),
        regie: resolve(__dirname, 'regie.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': 'http://localhost:8080',
      '/op': 'http://localhost:8080',
    },
  },
})
