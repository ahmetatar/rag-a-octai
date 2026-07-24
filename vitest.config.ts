import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Applied before any module loads. The ingestion route reads its upload limits from
    // config at import time, so they cannot be set from inside a test file.
    env: {
      MAX_UPLOAD_FILE_SIZE_MB: '1',
      MAX_UPLOAD_FILES: '2',
      // High enough that the route tests never trip the limiter and become flaky.
      RATE_LIMIT_MAX: '100000',
      // In-process queue so tests never need Redis; staged uploads go to a local scratch dir.
      QUEUE_DRIVER: 'memory',
      UPLOAD_DIR: '.vitest-uploads',
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/index.ts', '**/*.test.ts', 'dist/**', 'vitest.config.ts'],
    },
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Mirrors the `paths` block in tsconfig.json; without it the aliased imports used
    // throughout src cannot be resolved when running tests.
    alias: {
      '@app': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@infrastructure': path.resolve(__dirname, 'src/infrastructure'),
      '@routes': path.resolve(__dirname, 'src/routes'),
    },
  },
});
