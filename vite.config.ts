import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createExplainHandler } from './server/explain';
import { configFromEnv } from './server/providers';

/**
 * Serve /api/explain from the dev server, so `npm run dev` behaves like the Vercel
 * deployment. The key comes from `.env.local` (OPENAI_API_KEY=...), which is
 * git-ignored and never reaches the browser bundle: only VITE_* variables do.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'tuneverdict-dev-api',
    configureServer(server) {
      const handle = createExplainHandler({ config: configFromEnv(env) });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/explain')) return next();

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);

        const abort = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) abort.abort();
        });

        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(name, value);
        }
        if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) {
          headers.set('x-forwarded-for', req.socket.remoteAddress);
        }

        const method = req.method ?? 'GET';
        const response = await handle(
          new Request(`http://localhost${req.url}`, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
            signal: abort.signal,
          }),
        );

        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' prefix: load every variable, including the server-only OPENAI_API_KEY. It
  // is handed to the dev middleware above, not to the client build.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    /**
     * GitHub Pages serves a project page from /<repo>/, so the bundle needs that
     * prefix; the Pages workflow sets BASE_PATH. Vercel serves from the root.
     */
    base: process.env.BASE_PATH ?? '/',
    plugins: [react(), devApi(env)],
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
