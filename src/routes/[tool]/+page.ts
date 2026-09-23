import { error } from '@sveltejs/kit';
import { byId, tools } from '$lib/tools/registry';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * Every tool URL is known at build time, so all of them prerender to static
 * HTML. That is what makes organic search — the way this category is actually
 * found — work without a server.
 */
export const entries: EntryGenerator = () => tools.map((tool) => ({ tool: tool.id }));

export const load: PageLoad = ({ params }) => {
	const tool = byId(params.tool);
	if (!tool) error(404, `Não existe ferramenta chamada "${params.tool}"`);
	// Components are loaded lazily by the page; only metadata crosses here.
	return { tool };
};
