<script lang="ts">
	/**
	 * The homepage hero, and the one thing this page is remembered by.
	 *
	 * Every competitor in this category claims privacy in a paragraph. This
	 * demonstrates it: drop a document and it renders your actual pages in
	 * the hero, beside numbers that were measured rather than written, one of
	 * which is the count of network requests made while processing. It stays
	 * at zero because there is no server. A site that uploads your file
	 * cannot copy this component, which is exactly why it is the signature.
	 *
	 * The engine is not touched until a file arrives. Until then the panel
	 * shows three pages rendered by the same engine at build time
	 * (scripts/make-sample.mjs), so the hero carries a real document rather
	 * than an illustration of one.
	 */
	import { onDestroy } from 'svelte';
	import { magicFor, run } from '$lib/engine/client';
	import { formatBytes } from '$lib/download';
	import { release } from '$lib/tools/release';
	import type { RenderedPage } from '$lib/engine/contract';

	const SAMPLE = ['/sample/page-1.png', '/sample/page-2.png', '/sample/page-3.png'];

	interface Measured {
		name: string;
		bytes: number;
		pages: number;
		ms: number;
		requests: number;
		/** Bytes over the network (transferSize) during processing. */
		transferred: number;
	}

	let thumbs = $state.raw<string[]>([]);
	let measured = $state.raw<Measured | null>(null);
	let busy = $state(false);
	let error = $state('');
	let input: HTMLInputElement;
	/** Object URLs behind the current thumbnails; revoked when replaced. */
	let urls: string[] = [];

	function revokeThumbs() {
		urls.forEach(URL.revokeObjectURL);
		urls = [];
		thumbs = [];
	}

	onDestroy(revokeThumbs);

	const shown = $derived(thumbs.length ? thumbs : SAMPLE);

	async function handle(file: File) {
		error = '';
		busy = true;
		revokeThumbs();
		let handle: string | undefined;
		// An observer, not a before/after count of getEntriesByType: the
		// resource timing buffer holds 250 entries by default, and once it is
		// full the count stops moving and would report a false zero.
		const seen: PerformanceEntry[] = [];
		const observer = new PerformanceObserver((list) => seen.push(...list.getEntries()));

		try {
			// Warm the engine first, so the measurement below reports the cost
			// of processing rather than the one-off cost of fetching the WASM.
			const bytes = new Uint8Array(await file.arrayBuffer());
			const info = await run(
				'open',
				{ bytes, magic: magicFor(file) },
				{ transfer: [bytes.buffer] }
			);
			handle = info.handle;

			observer.observe({ type: 'resource' });
			const start = performance.now();

			await run(
				'render',
				{ handle: info.handle, width: 300, pages: info.pages.slice(0, 6).map((p) => p.index) },
				{
					onChunk: (chunk) => {
						const page = chunk as RenderedPage;
						urls.push(URL.createObjectURL(new Blob([page.png as BlobPart], { type: 'image/png' })));
						thumbs = [...urls];
					}
				}
			);

			const ms = Math.round(performance.now() - start);
			seen.push(...observer.takeRecords());
			const transferred = seen.reduce(
				(sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize ?? 0),
				0
			);

			measured = {
				name: file.name,
				bytes: file.size,
				pages: info.pageCount,
				ms,
				requests: seen.length,
				transferred
			};
		} catch (err) {
			error = (err as Error).message;
			revokeThumbs();
			measured = null;
		} finally {
			observer.disconnect();
			if (handle) release(handle);
			busy = false;
		}
	}

	function reset() {
		revokeThumbs();
		measured = null;
		error = '';
	}
</script>

<div
	class="relative overflow-hidden rounded-[var(--radius-card)] bg-panel text-panel-ink"
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (file && !busy) handle(file);
	}}
	role="region"
	aria-label="Teste aqui"
>
	<!-- Real renders in a plain row, numbered like a listing. Until a file
	     arrives, the sample was drawn by the same engine at build time. -->
	<div class="flex gap-3 overflow-hidden px-4 pt-5 sm:px-5">
		{#each shown.slice(0, 6) as src, index (src)}
			<figure class="min-w-0 shrink-0 basis-[calc((100%-1.5rem)/3)] sm:basis-[calc((100%-3rem)/5)]">
				<img
					{src}
					alt=""
					width="840"
					height="1190"
					loading={index === 0 ? 'eager' : 'lazy'}
					fetchpriority={index === 0 ? 'high' : 'auto'}
					decoding="async"
					class="aspect-[1/1.414] w-full rounded-[2px] bg-white object-cover object-top"
				/>
				<figcaption class="tabular mt-1.5 text-xs text-panel-muted">p. {index + 1}</figcaption>
			</figure>
		{/each}
	</div>

	<div class="mt-4 border-t border-panel-ink/12 px-4 py-4 font-mono text-sm sm:px-5">
		{#if measured}
			<!-- Measured, not claimed. Every number here came from the run that
			     just happened. -->
			<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
				<dt class="text-panel-muted">arquivo</dt>
				<dd class="truncate">
					{measured.name} ({measured.pages}
					{measured.pages === 1 ? 'página' : 'páginas'}, {formatBytes(measured.bytes)})
				</dd>
				<dt class="text-panel-muted">desenhado em</dt>
				<dd class="tabular">{measured.ms} ms</dd>
				<dt class="text-panel-muted">rede</dt>
				<dd class="tabular text-panel-accent">
					{measured.requests}
					{measured.requests === 1 ? 'requisição' : 'requisições'}, {formatBytes(
						measured.transferred
					)}
				</dd>
			</dl>
			<button
				type="button"
				class="mt-3 min-h-6 text-panel-ink underline underline-offset-4 hover:text-panel-accent"
				onclick={reset}
			>
				limpar
			</button>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
				<p class="text-panel-muted">
					{busy ? 'lendo no seu dispositivo…' : 'solte um PDF aqui, ou'}
				</p>
				<button
					type="button"
					class="rounded-[var(--radius-control)] border border-panel-ink/25 px-4 py-2 text-panel-ink hover:border-panel-accent hover:text-panel-accent disabled:opacity-60"
					disabled={busy}
					onclick={() => input.click()}
				>
					{busy ? 'processando' : 'escolher arquivo'}
				</button>
			</div>
		{/if}

		{#if error}
			<p class="mt-3 text-sm text-panel-accent" role="alert">{error}</p>
		{/if}
	</div>

	<input
		bind:this={input}
		type="file"
		class="sr-only"
		accept=".pdf,.md,.txt,.html,.epub,.cbz,.png,.jpg,.jpeg,.webp"
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) handle(file);
			input.value = '';
		}}
	/>
</div>
