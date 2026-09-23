<script lang="ts">
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import PageGrid, { type GridPage } from '$lib/ui/PageGrid.svelte';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	// Writable $derived: resets itself whenever a different document is
	// loaded, but the grid and the Reset button can assign to it freely.
	let pages = $derived<GridPage[]>(
		doc ? doc.pages.map((page) => ({ source: page.index, rotation: 0 })) : []
	);

	const changed = $derived(
		doc &&
			(pages.length !== doc.pageCount ||
				pages.some((page, index) => page.source !== index || page.rotation !== 0))
	);

	const apply = () =>
		run(async () => [
			await runJob('organize', {
				handle: doc.handle,
				order: pages.map((page) => page.source),
				rotations: pages.map((page) => page.rotation),
				filename: `${baseName(doc.filename)}-organized.pdf`
			})
		]);
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<p class="text-sm text-muted">
		Arraste as páginas ou use as setas para reordenar. Também dá para girar e excluir. {pages.length}
		de {doc?.pageCount ?? 0} páginas mantidas.
	</p>
	<div class="flex gap-2">
		<button
			type="button"
			class="rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50"
			disabled={busy || !changed}
			onclick={() => (pages = doc.pages.map((p) => ({ source: p.index, rotation: 0 })))}
		>
			Restaurar
		</button>
		<button
			type="button"
			class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
			disabled={busy || pages.length === 0}
			onclick={apply}
		>
			Salvar PDF
		</button>
	</div>
</div>

{#if doc}
	<PageGrid handle={doc.handle} bind:pages />
{/if}
