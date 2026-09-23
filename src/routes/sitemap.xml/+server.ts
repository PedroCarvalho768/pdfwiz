import { tools } from '$lib/tools/registry';
import { SITE_URL } from '$lib/ui/site';

// Written once at build time next to the prerendered pages.
export const prerender = true;

export function GET() {
	const urls = ['/', ...tools.map((tool) => `/${tool.id}`)]
		.map((path) => `\t<url><loc>${SITE_URL}${path}</loc></url>`)
		.join('\n');
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		{ headers: { 'content-type': 'application/xml' } }
	);
}
