import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'

/**
 * One id per build, baked into every page and published as /build.json beside them. The PC pages
 * stay open all day while fixes keep being deployed; comparing the two is how a page notices it is
 * running a stale script (src/build-watch.ts). Render and Vercel both expose the commit, and the
 * time keeps two builds of the same commit apart.
 */
const BUILD_ID = `${process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'}-${Date.now()}`

function publishBuildId(): Plugin {
  return {
    name: 'auramaxx-build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ id: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [publishBuildId()],
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
