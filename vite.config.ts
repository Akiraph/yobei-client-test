import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const targetPlatform = process.env.TAURI_ENV_PLATFORM?.toLowerCase();
const isDesktopBuild = !targetPlatform?.includes("android") && !targetPlatform?.includes("ios");
const isTauriDesktopBuild = Boolean(targetPlatform) && isDesktopBuild;

function externalLocaleAssets() {
  const localeDir = resolve(process.cwd(), 'src/locales');
  return {
    name: 'external-locale-assets',
    configureServer(server: { middlewares: { use: (path: string, handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use('/locales', (request, response, next) => {
        const relative = decodeURIComponent(request.url ?? '').replace(/^\/+/, '');
        if (!/^[\w-]+\.json$/.test(relative)) {
          next();
          return;
        }
        try {
          const body = readFileSync(resolve(localeDir, relative), 'utf8');
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      if (isTauriDesktopBuild) return;
      for (const file of readdirSync(localeDir).filter((name) => /^[\w-]+\.json$/.test(name))) {
        this.emitFile({
          type: 'asset',
          fileName: `locales/${file}`,
          source: readFileSync(resolve(localeDir, file)),
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid(), externalLocaleAssets()],
  publicDir: isTauriDesktopBuild ? false : 'public',

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  define: {
    __YOBEI_DESKTOP__: JSON.stringify(isDesktopBuild),
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/.tmp-*/**"],
    },
  },
}));
