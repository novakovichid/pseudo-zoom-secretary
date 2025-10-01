import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    entry: 'src/main/main.ts',
    vite: {
      build: {
        outDir: resolve(__dirname, 'dist', 'main'),
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: '[name].js'
          }
        }
      }
    }
  },
  preload: {
    input: {
      preload: resolve(__dirname, 'src/preload/preload.ts')
    },
    vite: {
      build: {
        outDir: resolve(__dirname, 'dist', 'preload'),
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: '[name].js'
          }
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'dist', 'renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name][extname]'
        }
      }
    }
  }
});
