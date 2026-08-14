import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';

function copyStatic() {
  return {
    name: 'copy-static',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      mkdirSync(dist, { recursive: true });
      cpSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));
      cpSync(resolve(__dirname, '_locales'), resolve(dist, '_locales'), { recursive: true });
      cpSync(resolve(__dirname, 'icons'), resolve(dist, 'icons'), { recursive: true });
      cpSync(resolve(__dirname, 'src/locales'), resolve(dist, 'locales'), { recursive: true });

      for (const page of ['popup', 'install']) {
        const nested = resolve(dist, `src/${page}/index.html`);
        if (existsSync(nested)) writeFileSync(resolve(dist, `${page}.html`), readFileSync(nested));
      }

      rmSync(resolve(dist, 'src'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [solid(), copyStatic()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        install: resolve(__dirname, 'src/install/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? '[name].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
