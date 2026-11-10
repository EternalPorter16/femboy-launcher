import { defineMiddleware } from 'astro:middleware';
import { localizeHtml } from './lib/localize.js';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  if (!context.url.pathname.startsWith(base + 'en/') || !response.headers.get('content-type')?.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Content-Language', 'en');
  return new Response(localizeHtml(await response.text(), base), { status: response.status, headers });
});
