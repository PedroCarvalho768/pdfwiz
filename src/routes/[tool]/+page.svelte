<script lang="ts">
	/**
	 * Every tool URL renders here. The body lives in ToolPage, keyed by tool
	 * id: navigating from one tool to another (same route, new params) would
	 * otherwise keep the previous tool's files, result and errors alive.
	 */
	import ToolPage from '$lib/ui/ToolPage.svelte';
	import { SITE_URL } from '$lib/ui/site';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const tool = $derived(data.tool);
	const title = $derived(`${tool.title} de graça, no seu navegador | Aegis`);
	const url = $derived(`${SITE_URL}/${tool.id}`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={tool.blurb} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={tool.blurb} />
	<meta property="og:url" content={url} />
</svelte:head>

{#key tool.id}
	<ToolPage {tool} />
{/key}
