import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react.tsx' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['react', 'react/jsx-runtime'],
});
