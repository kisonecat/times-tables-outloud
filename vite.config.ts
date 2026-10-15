/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production CSP. Only the one-time Whisper model download from Hugging Face may leave
 * the device. Added at build time because the dev server relies on inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://*.hf.co",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * Silero VAD's assets, self-hosted under /vad/ at fixed names (vad-web builds their URLs
 * by joining a base path and a file name, so Vite's hashed asset names won't do).
 */
const require = createRequire(import.meta.url);
const vadDist = dirname(require.resolve('@ricky0123/vad-web'));
const ortDist = dirname(require.resolve('onnxruntime-web'));
const VAD_ASSETS: Record<string, string> = {
  'vad.worklet.bundle.min.js': join(vadDist, 'vad.worklet.bundle.min.js'),
  'silero_vad_v5.onnx': join(vadDist, 'silero_vad_v5.onnx'),
  'ort-wasm-simd-threaded.wasm': join(ortDist, 'ort-wasm-simd-threaded.wasm'),
  'ort-wasm-simd-threaded.mjs': join(ortDist, 'ort-wasm-simd-threaded.mjs'),
};
const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  onnx: 'application/octet-stream',
  wasm: 'application/wasm',
};

function vadAssets(): Plugin {
  let base = '/';
  return {
    name: 'vad-assets',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(`${base}vad/`, (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]!;
        const file = VAD_ASSETS[name];
        if (!file) return next();
        res.setHeader(
          'Content-Type',
          CONTENT_TYPES[name.split('.').pop()!] ?? 'application/octet-stream',
        );
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(VAD_ASSETS)) {
        this.emitFile({ type: 'asset', fileName: `vad/${name}`, source: readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), cspMeta(), vadAssets()],
  build: {
    // The audio worklet is loaded by URL; a data: URL would be blocked by the CSP.
    assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined),
  },
  server: { host: 'localhost' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
