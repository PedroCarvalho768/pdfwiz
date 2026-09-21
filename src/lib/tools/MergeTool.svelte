<script lang="ts">
	import { run as runJob } from '$lib/engine/client';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	// Merge order is the list order, so the whole tool is "let them reorder it".
	// Writable $derived: it tracks the document list, but reordering can
	// overwrite it until that list changes again.
	let order = $derived(docs.map((_, index) => index));

	function shift(position: number, by: number) {
		const target = position + by;
		if (target < 0 || target >= order.length) return;
		const next = [...order];
		[next[position], next[target]] = [next[target], next[position]];
		order = next;
	}

	const totalPages = $derived(order.reduce((sum, i) => sum + (docs[i]?.pageCount ?? 0), 0));

	const merge = () =>
		run(async () => [
			await runJob('merge', { handles: order.map((i) => docs[i].handle), filename: 'merged.pdf' })
		]);
</script>

<ol class="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-bg">
	{#each order as docIndex, position (docIndex)}
		<li class="flex items-center gap-3 p-3">
			<span class="w-6 text-sm text-muted">{position + 1}</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium text-ink">
					{docs[docIndex].title || `Documento ${docIndex + 1}`}
				</span>
				<span class="text-xs text-muted">{docs[docIndex].pageCount} páginas</span>
			</span>
			<span class="flex gap-1">
				<button
					type="button"
					class="rounded px-2 py-1 text-muted hover:bg-raised disabled:opacity-30"
					disabled={position === 0}
					aria-label="Mover para cima"
					onclick={() => shift(position, -1)}>↑</button
				>
				<button
					type="button"
					class="rounded px-2 py-1 text-muted hover:bg-raised disabled:opacity-30"
					disabled={position === order.length - 1}
					aria-label="Mover para baixo"
					onclick={() => shift(position, 1)}>↓</button
				>
			</span>
		</li>
	{/each}
</ol>

<div class="mt-4 flex items-center gap-4">
	<button
		type="button"
		class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
		disabled={busy || docs.length < 2}
		onclick={merge}
	>
		Juntar {docs.length} arquivos
	</button>
	<span class="text-sm text-muted">{totalPages} páginas no total</span>
</div>

{#if docs.length < 2}
	<p class="mt-3 text-sm text-muted">Adicione pelo menos mais um arquivo para juntar.</p>
{/if}
