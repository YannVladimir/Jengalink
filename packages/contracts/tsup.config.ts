import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', demo: 'src/demo.ts', client: 'src/client.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
});
