import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/** The git commit this build came from, shown in Settings so you can check you're on the latest code. */
function buildVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
  resolve: {
    alias: {
      '@six/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173 },
});
