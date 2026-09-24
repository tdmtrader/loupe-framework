// Workspace-wide vitest projects (scaffold-frozen; run via `vitest run --config vitest.workspace.ts`).
// Node projects for the pure packages; browser-mode (playwright/chromium) projects for
// @loupe/catalog and @loupe/renderer render tests.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const nodeProject = (name: string, root: string) => ({
  test: { name, root: at(root), environment: 'node' as const },
});

const browserProject = (name: string, root: string) => ({
  plugins: [react()],
  test: {
    name,
    root: at(root),
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' as const }],
      screenshotFailures: false,
    },
  },
});

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      nodeProject('tokens', 'packages/tokens'),
      nodeProject('protocol', 'packages/protocol'),
      nodeProject('spec', 'packages/spec'),
      nodeProject('client', 'packages/client'),
      nodeProject('serve', 'packages/serve'),
      nodeProject('loupe-mcp', 'apps/loupe-mcp'),
      nodeProject('grill', 'apps/grill'),
      nodeProject('host', 'apps/host'),
      browserProject('catalog', 'packages/catalog'),
      browserProject('renderer', 'packages/renderer'),
    ],
  },
});
