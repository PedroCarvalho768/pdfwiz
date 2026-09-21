<script module lang="ts">
	/** One entry per output page, pointing back at the source page it came from. */
	export interface GridPage {
		source: number;
		/** Extra clockwise rotation applied on top of the page's own. */
		rotation: number;
	}
</script>

<script lang="ts">
	import { run } from '$lib/engine/client';
	import type { DocHandle, RenderedPage } from '$lib/engine/contract';

	let {
		handle,
		pages = $bindable(),
		selectable = true
	}: { handle: DocHandle; pages: GridPage[]; selectable?: boolean } = $props();

	let thumbs = $state<Record<number, string>>({});
	let rendered = $state(0);
	let total = $state(0);
	let dragFrom = $state<number | null>(null);

	// Render thumbnails once per document, streaming them in as they arrive so
	// page 1 appears immediately on a 400-page file.
	$effect(() => {
		const controller = new AbortController();
		const urls: string[] = [];
		thumbs = {};
		rendered = 0;

		run(
			'render',
			{ handle, width: 180 },
			{
				signal: controller.signal,
				onProgress: (p) => {
					rendered = p.done;
					total = p.total;
				},
				onChunk: (chunk) => {
					const page = chunk as RenderedPage;
					const url = URL.createObjectURL(new Blob([page.png as BlobPart], { type: 'image/png' }));
					urls.push(url);
					thumbs[page.index] = url;
				}
			}
		).catch((err) => {
			if (err?.code !== 'CANCELLED') console.error(err);
		});

		return () => {
			controller.abort();
			urls.forEach(URL.revokeObjectURL);
		};
	});

	function move(from: number, to: number) {
		if (from === to) return;
		const next = [...pages];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item);
		pages = next;
	}

	// Reassign rather than mutate. `pages` is bound to a writable $derived in
	// the caller, and the objects inside it are plain — mutating one in place
	// updates nothing.
	const rotate = (index: number, by: number) => {
		pages = pages.map((page, i) =>
			i === index ? { ...page, rotation: (((page.rotation + by) % 360) + 360) % 360 } : page
		);
	};

	const remove = (index: number) => {
		pages = pages.filter((_, i) => i !== index);
	};
</script>

{#if total && rendered < total}
	<p class="mb-3 text-sm text-muted" aria-live="polite">
		Renderizando página {rendered} de {total}…
	</p>
{/if}

<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
	{#each pages as page, index (`${page.source}-${index}`)}
		<li
			class="group relative rounded-[var(--radius-control)] border border-line bg-bg p-2 shadow-sm
				{dragFrom === index ? 'opacity-40' : ''}"
			draggable={selectable}
			ondragstart={() => (dragFrom = index)}
			ondragend={() => (dragFrom = null)}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				if (dragFrom !== null) move(dragFrom, index);
				dragFrom = null;
			}}
		>
			<div class="flex aspect-[3/4] items-center justify-center overflow-hidden bg-raised">
				{#if thumbs[page.source]}
					<img
						src={thumbs[page.source]}
						alt="Página {page.source + 1}"
						class="max-h-full max-w-full object-contain transition-transform"
						style="transform: rotate({page.rotation}deg)"
					/>
				{:else}
					<span class="text-xs text-muted">…</span>
				{/if}
			</div>

			<div class="mt-2 flex items-center justify-between text-xs text-muted">
				<span>Página {page.source + 1}</span>
				{#if selectable}
					<span class="flex gap-1">
						<button
							type="button"
							class="rounded px-1.5 py-0.5 hover:bg-raised"
							aria-label="Girar à esquerda"
							title="Girar à esquerda"
							onclick={() => rotate(index, -90)}>↺</button
						>
						<button
							type="button"
							class="rounded px-1.5 py-0.5 hover:bg-raised"
							aria-label="Girar à direita"
							title="Girar à direita"
							onclick={() => rotate(index, 90)}>↻</button
						>
						<button
							type="button"
							class="rounded px-1.5 py-0.5 text-danger hover:bg-danger-soft"
							aria-label="Excluir página"
							title="Excluir página"
							onclick={() => remove(index)}>✕</button
						>
					</span>
				{/if}
			</div>
		</li>
	{/each}
</ul>

{#if pages.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		Todas as páginas foram excluídas. Traga uma de volta antes de salvar.
	</p>
{/if}
