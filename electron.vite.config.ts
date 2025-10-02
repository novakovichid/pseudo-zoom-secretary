import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    entry: 'src/main/index.ts',
    vite: {
      build: {
        outDir: resolve(__dirname, 'dist', 'main'),
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
          },
        },
      },
    },
  },
  preload: {
    input: {
      index: resolve(__dirname, 'src/preload/index.ts'),
    },
    vite: {
      build: {
        outDir: resolve(__dirname, 'dist', 'preload'),
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
          },
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist', 'renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  },
});
