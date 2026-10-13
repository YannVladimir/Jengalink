import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'web/index': 'src/web/index.tsx',
    'native/index': 'src/native/index.tsx',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'react/jsx-runtime',
    'react-native',
    'react-native-svg',
    'lucide-react',
    'lucide-react-native',
  ],
});
