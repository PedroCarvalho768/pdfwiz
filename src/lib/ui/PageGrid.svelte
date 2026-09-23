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
	let renderError = $state('');
	let dragFrom = $state<number | null>(null);
	/** Deleted pages, most recent last, with the position they held. */
	let removed = $state.raw<{ page: GridPage; index: number }[]>([]);

	// Render thumbnails once per document, streaming them in as they arrive so
	// page 1 appears immediately on a 400-page file.
	$effect(() => {
		const controller = new AbortController();
		const urls: string[] = [];
		thumbs = {};
		rendered = 0;
		total = 0;
		renderError = '';

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
			if (err?.code !== 'CANCELLED')
				renderError = `Não foi possível gerar as miniaturas: ${err?.message ?? err}`;
		});

		return () => {
			controller.abort();
			urls.forEach(URL.revokeObjectURL);
		};
	});

	function move(from: number, to: number) {
		if (from === to || to < 0 || to >= pages.length) return;
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
		removed = [...removed, { page: pages[index], index }];
		pages = pages.filter((_, i) => i !== index);
	};

	// The caller can reset `pages` (Restaurar), which brings deleted pages
	// back on its own. An undo entry whose source page is present again is
	// stale and is dropped rather than inserted twice.
	const lastRemoved = $derived.by(() => {
		for (let i = removed.length - 1; i >= 0; i--)
			if (!pages.some((p) => p.source === removed[i].page.source)) return removed[i];
		return null;
	});

	function undo() {
		const entry = lastRemoved;
		if (!entry) return;
		removed = removed.filter((r) => r !== entry);
		const next = [...pages];
		next.splice(Math.min(entry.index, next.length), 0, entry.page);
		pages = next;
	}

	const iconButton =
		'inline-flex size-7 items-center justify-center rounded hover:bg-raised disabled:opacity-30';
</script>

{#if renderError}
	<p
		class="mb-3 rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger"
		role="alert"
	>
		{renderError}
	</p>
{:else if total && rendered < total}
	<p class="mb-3 text-sm text-muted">
		Renderizando página {rendered} de {total}…
	</p>
{/if}

{#if lastRemoved}
	<p class="mb-3 flex flex-wrap items-center gap-3 text-sm text-ink" aria-live="polite">
		Página {lastRemoved.page.source + 1} excluída.
		<button
			type="button"
			class="rounded-[var(--radius-control)] border border-line bg-bg px-3 py-1 font-medium hover:bg-surface"
			onclick={undo}
		>
			Desfazer
		</button>
	</p>
{/if}

<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3">
	{#each pages as page, index (`${page.source}-${index}`)}
		{@const n = page.source + 1}
		<li
			class="group relative rounded-[var(--radius-control)] border border-line bg-bg p-2 shadow-sm
				{dragFrom === index ? 'opacity-40' : ''}"
			draggable={selectable}
			ondragstart={(e) => {
				dragFrom = index;
				// Firefox does not start a drag without data on the transfer.
				e.dataTransfer?.setData('text/plain', String(index));
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			}}
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
						alt="Página {n}"
						class="max-h-full max-w-full object-contain transition-transform"
						style="transform: rotate({page.rotation}deg)"
					/>
				{:else}
					<span class="text-xs text-muted">…</span>
				{/if}
			</div>

			<p class="mt-2 text-xs text-muted">Página {n}</p>
			{#if selectable}
				<div class="mt-1 flex flex-wrap items-center justify-between gap-y-1 text-sm text-muted">
					<span class="flex gap-0.5">
						<button
							type="button"
							class={iconButton}
							disabled={index === 0}
							aria-label="Mover página {n} para trás"
							title="Mover para trás"
							onclick={() => move(index, index - 1)}>←</button
						>
						<button
							type="button"
							class={iconButton}
							disabled={index === pages.length - 1}
							aria-label="Mover página {n} para frente"
							title="Mover para frente"
							onclick={() => move(index, index + 1)}>→</button
						>
					</span>
					<span class="flex gap-0.5">
						<button
							type="button"
							class={iconButton}
							aria-label="Girar página {n} à esquerda"
							title="Girar à esquerda"
							onclick={() => rotate(index, -90)}>↺</button
						>
						<button
							type="button"
							class={iconButton}
							aria-label="Girar página {n} à direita"
							title="Girar à direita"
							onclick={() => rotate(index, 90)}>↻</button
						>
						<button
							type="button"
							class="{iconButton} ml-2 text-danger hover:bg-danger-soft"
							aria-label="Excluir página {n}"
							title="Excluir página"
							onclick={() => remove(index)}>✕</button
						>
					</span>
				</div>
			{/if}
		</li>
	{/each}
</ul>

{#if pages.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		Todas as páginas foram excluídas. Use Desfazer para trazer uma de volta antes de salvar.
	</p>
{/if}
