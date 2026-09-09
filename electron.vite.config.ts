import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import type { Plugin } from 'vite';

// Dev-only CSP: relaxed enough for Vite HMR (inline bootstrap script + the
// dev-server websocket/http origin). Never shipped in a packaged build.
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self' ws://localhost:* http://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'self'";

// Production CSP. style-src keeps 'unsafe-inline' because React inline styles are used (intentional).
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'";

/** Injects the Content-Security-Policy <meta> tag that used to live in index.html. */
function cspPlugin(): Plugin {
  let isDev = false;
  return {
    name: 'prism-csp',
    config(_config, env) {
      isDev = env.command === 'serve' || env.mode === 'development';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: isDev ? DEV_CSP : PROD_CSP
          },
          injectTo: 'head-prepend'
        }
      ];
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    plugins: [react(), cspPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    }
  }
});
