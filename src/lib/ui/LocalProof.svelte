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
	<!-- The page stack. Real renders, fanned so the panel reads as documents
	     rather than as a grid of images. -->
	<div
		class="flex min-h-[15rem] items-end justify-center gap-0 px-4 pt-8 sm:min-h-[20rem] sm:px-6 sm:pt-10"
	>
		{#each shown.slice(0, 6) as src, index (src)}
			<img
				{src}
				alt=""
				width="840"
				height="1190"
				loading={index === 0 ? 'eager' : 'lazy'}
				fetchpriority={index === 0 ? 'high' : 'auto'}
				decoding="async"
				class="h-32 w-auto rounded-[3px] bg-white object-cover object-top shadow-[0_20px_44px_-12px_rgba(0,0,0,0.6)] transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] sm:h-48 lg:h-64"
				style="
					transform: rotate({(index - (Math.min(shown.length, 6) - 1) / 2) * 4.5}deg)
						translateY({Math.abs(index - (Math.min(shown.length, 6) - 1) / 2) * 10}px);
					margin-inline: {index === 0 ? 0 : -0.75}rem;
					z-index: {10 - index};
					opacity: {thumbs.length ? 1 : 0.9};
				"
			/>
		{/each}
	</div>

	<div class="border-t border-panel-ink/12 p-5 sm:p-6">
		{#if measured}
			<!-- Measured, not claimed. Every number here came from the run that
			     just happened. -->
			<dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
				<div>
					<dt class="text-xs text-panel-muted">Tráfego de rede</dt>
					<dd class="tabular mt-0.5 text-lg text-panel-accent">
						{formatBytes(measured.transferred)}
					</dd>
				</div>
				<div>
					<dt class="text-xs text-panel-muted">Requisições de rede</dt>
					<dd class="tabular mt-0.5 text-lg text-panel-accent">{measured.requests}</dd>
				</div>
				<div>
					<dt class="text-xs text-panel-muted">Lido neste dispositivo</dt>
					<dd class="tabular mt-0.5 text-lg">{formatBytes(measured.bytes)}</dd>
				</div>
				<div>
					<dt class="text-xs text-panel-muted">Renderizado em</dt>
					<dd class="tabular mt-0.5 text-lg">{measured.ms} ms</dd>
				</div>
			</dl>

			<p class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-panel-muted">
				<span class="truncate"
					>{measured.name}, {measured.pages}
					{measured.pages === 1 ? 'página' : 'páginas'}.</span
				>
				<button
					type="button"
					class="font-medium text-panel-ink underline underline-offset-4 hover:text-panel-accent"
					onclick={reset}
				>
					Limpar
				</button>
			</p>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-4" aria-live="polite">
				<div>
					<p class="font-medium">
						{busy ? 'Lendo no seu dispositivo' : 'Solte um PDF para ver acontecer'}
					</p>
					<p class="mt-1 text-sm text-panel-muted">
						Nada é enviado para lugar nenhum. Confira a aba de rede.
					</p>
				</div>

				<button
					type="button"
					class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink transition-transform duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
					disabled={busy}
					onclick={() => input.click()}
				>
					{busy ? 'Processando' : 'Escolher arquivo'}
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
