import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/**/*.stories.tsx',
        'src/vite-env.d.ts',
        'src/sw/**',
      ],
      thresholds: {
        'src/lib/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/features/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
        'src/ui/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
