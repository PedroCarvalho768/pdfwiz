<script lang="ts">
	import { run as runJob } from '$lib/engine/client';
	import type { ToolProps } from './types';

	let { docs, busy, run, remove }: ToolProps = $props();

	// Merge order is the list order, so the whole tool is "let them reorder it".
	// The manual order is kept by handle: adding or removing a file keeps the
	// arrangement of the others, and new files join at the end.
	let manual = $state.raw<string[]>([]);
	const order = $derived.by(() => {
		const present = new Set(docs.map((doc) => doc.handle));
		const kept = manual.filter((handle) => present.has(handle));
		return [...kept, ...docs.map((doc) => doc.handle).filter((h) => !kept.includes(h))];
	});
	const byHandle = $derived(new Map(docs.map((doc) => [doc.handle, doc])));

	function shift(position: number, by: number) {
		const target = position + by;
		if (target < 0 || target >= order.length) return;
		const next = [...order];
		[next[position], next[target]] = [next[target], next[position]];
		manual = next;
	}

	const totalPages = $derived(docs.reduce((sum, doc) => sum + doc.pageCount, 0));
	const pagesLabel = (n: number) => `${n} ${n === 1 ? 'página' : 'páginas'}`;

	const merge = () =>
		run(async () => [await runJob('merge', { handles: order, filename: 'merged.pdf' })]);

	const buttonClass =
		'inline-flex size-9 items-center justify-center rounded text-muted hover:bg-raised disabled:opacity-30';
</script>

<ol class="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-bg">
	{#each order as handle, position (handle)}
		{@const doc = byHandle.get(handle)!}
		<li class="flex items-center gap-3 p-3">
			<span class="w-6 text-sm text-muted">{position + 1}</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium text-ink">{doc.filename}</span>
				<span class="text-xs text-muted">{pagesLabel(doc.pageCount)}</span>
			</span>
			<span class="flex gap-1">
				<button
					type="button"
					class={buttonClass}
					disabled={position === 0}
					aria-label="Mover {doc.filename} para cima"
					onclick={() => shift(position, -1)}>↑</button
				>
				<button
					type="button"
					class={buttonClass}
					disabled={position === order.length - 1}
					aria-label="Mover {doc.filename} para baixo"
					onclick={() => shift(position, 1)}>↓</button
				>
				<button
					type="button"
					class="{buttonClass} ml-2 text-danger hover:bg-danger-soft"
					disabled={busy}
					aria-label="Remover {doc.filename}"
					onclick={() => remove(handle)}>✕</button
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
		Juntar {docs.length}
		{docs.length === 1 ? 'arquivo' : 'arquivos'}
	</button>
	<span class="text-sm text-muted">{pagesLabel(totalPages)} no total</span>
</div>

{#if docs.length < 2}
	<p class="mt-3 text-sm text-muted">Adicione pelo menos mais um arquivo para juntar.</p>
{/if}
