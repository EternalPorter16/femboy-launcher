// Главная, история версий и инструкция по установке. Без адреса сайта отдаётся пустой список.
export function GET({ site }) {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const urls = site ? ['', 'releases/', 'guides/setup-or-portable/', 'guides/install-modrinth-modpack/'].flatMap(p => [p, 'en/' + p]).map((p) => new URL(base + p, site).href) : [];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
