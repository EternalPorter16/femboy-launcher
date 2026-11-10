// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

// Адрес сайта: переменная окружения SITE_URL или поле "url" в src/config/site.json.
// Пока адрес пустой, страница собирается без канонической ссылки, og:url и sitemap — ничего не выдумываем.
// BASE_PATH — если сайт будет жить не в корне домена, а в подпапке (например, /launcher/).
const siteConfig = JSON.parse(readFileSync(new URL('./src/config/site.json', import.meta.url), 'utf8'));
const site = (process.env.SITE_URL || siteConfig.url || '').trim() || undefined;
const base = (process.env.BASE_PATH || '/').trim();

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    assets: 'assets',
    inlineStylesheets: 'auto',
  },
  image: {
    // Картинки обрабатываются при сборке, внешние адреса не нужны
    domains: [],
  },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4321 },
});
