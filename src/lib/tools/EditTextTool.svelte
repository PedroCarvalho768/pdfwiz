<script lang="ts">
	/**
	 * Text editing: list the lines MuPDF found, let them be rewritten, then
	 * redact the originals and draw the replacements.
	 *
	 * Only changed lines are submitted — touching a line at all costs it its
	 * original font, so leaving one alone is strictly better than rewriting
	 * it identically.
	 */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { TextLine } from '$lib/engine/jobs/index';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	let page = $state(0);
	// $state.raw, not $state: a deep proxy cannot be structured-cloned, so
	// posting these rects back to the worker would throw DataCloneError. The
	// list is replaced wholesale rather than mutated, so raw is also cheaper.
	let lines = $state.raw<TextLine[]>([]);
	let edited = $state<Record<number, string>>({});
	let loading = $state(false);

	// Reload whenever the document or the chosen page changes.
	$effect(() => {
		const handle = doc?.handle;
		const index = page;
		if (!handle) return;

		loading = true;
		edited = {};
		runJob('textLines', { handle, page: index })
			.then((result) => {
				lines = result;
			})
			.finally(() => {
				loading = false;
			});
	});

	const changes = $derived(
		Object.entries(edited)
			.map(([key, text]) => ({ line: lines[Number(key)], text }))
			.filter(({ line, text }) => line && text !== line.text)
	);

	const apply = () =>
		run(async () => {
			const file = await runJob('replaceText', {
				handle: doc.handle,
				edits: changes.map(({ line, text }) => ({
					page: line.page,
					rect: line.rect,
					baseline: line.baseline,
					text,
					size: line.size
				})),
				filename: `${baseName(doc.title || 'document')}-edited.pdf`
			});
			return {
				files: [file],
				summary: `${changes.length} linha${changes.length === 1 ? '' : 's'} reescrita${changes.length === 1 ? '' : 's'}.`
			};
		});
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<label class="flex items-center gap-2 text-sm text-ink">
		Página
		<select
			class="rounded-[var(--radius-control)] border-line text-sm"
			value={page}
			onchange={(e) => (page = Number(e.currentTarget.value))}
		>
			{#each doc?.pages ?? [] as info (info.index)}
				<option value={info.index}>{info.index + 1}</option>
			{/each}
		</select>
		de {doc?.pageCount ?? 0}
	</label>

	<button
		type="button"
		class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
		disabled={busy || changes.length === 0}
		onclick={apply}
	>
		{changes.length
			? `Salvar ${changes.length} alteraç${changes.length === 1 ? 'ão' : 'ões'}`
			: 'Salvar'}
	</button>
</div>

{#if loading}
	<p class="text-sm text-muted">Lendo o texto…</p>
{:else if lines.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		No text was found on this page. If the document is a scan, run OCR first to give it a text
		layer.
	</p>
{:else}
	<ul class="space-y-2">
		{#each lines as line, index (index)}
			{@const changed = edited[index] !== undefined && edited[index] !== line.text}
			<li class="flex items-center gap-3">
				<span class="w-10 shrink-0 text-right text-xs text-muted">{index + 1}</span>
				<input
					class="flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm
						{changed ? 'border-accent bg-accent-soft' : 'border-line'}"
					value={edited[index] ?? line.text}
					aria-label="Linha {index + 1}"
					oninput={(e) => (edited = { ...edited, [index]: e.currentTarget.value })}
				/>
				{#if changed}
					<button
						type="button"
						class="text-xs text-muted underline hover:text-ink"
						onclick={() => {
							const next = { ...edited };
							delete next[index];
							edited = next;
						}}
					>
						Desfazer
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
