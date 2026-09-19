import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        calibrate: resolve(__dirname, 'calibrate.html'),
      },
    },
  },
  server: { port: 5173 },
})
