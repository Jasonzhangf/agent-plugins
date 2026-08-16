import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts', 'src/projection.ts', 'src/protocol.ts'],
  fixedExtension: false,
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
})
