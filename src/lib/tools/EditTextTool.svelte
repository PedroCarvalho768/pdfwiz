<script lang="ts">
	/**
	 * Text editing: list the lines MuPDF found, let them be rewritten, then
	 * redact the originals and draw the replacements.
	 *
	 * Only changed lines are submitted — touching a line at all costs it its
	 * original font, so leaving one alone is strictly better than rewriting
	 * it identically. Edits are kept per page, so moving to another page and
	 * back loses nothing, and one save applies every page's edits.
	 */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { TextLine } from '$lib/engine/jobs/index';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	let page = $state(0);
	// $state.raw, not $state: a deep proxy cannot be structured-cloned, so
	// posting these rects back to the worker would throw DataCloneError. Each
	// page's list is replaced wholesale rather than mutated.
	let linesByPage = $state.raw<Record<number, TextLine[]>>({});
	/** page -> line index -> replacement text */
	let edited = $state<Record<number, Record<number, string>>>({});
	let loadError = $state('');

	const lines = $derived(linesByPage[page]);
	const pageEdits = $derived(edited[page] ?? {});

	// Load each page once, the first time it is shown. A slow response for a
	// page the user already left is still cached, but only a response for
	// the current request may clear the error state.
	let request = 0;
	$effect(() => {
		const handle = doc?.handle;
		const index = page;
		if (!handle || linesByPage[index]) return;
		const id = ++request;
		loadError = '';
		runJob('textLines', { handle, page: index })
			.then((result) => (linesByPage = { ...linesByPage, [index]: result }))
			.catch((err: Error) => {
				if (id === request) loadError = `Não foi possível ler o texto desta página: ${err.message}`;
			});
	});

	const changes = $derived(
		Object.entries(edited).flatMap(([p, byLine]) =>
			Object.entries(byLine)
				.map(([key, text]) => ({ line: linesByPage[Number(p)]?.[Number(key)], text }))
				.filter(({ line, text }) => line && text !== line.text)
				.map(({ line, text }) => ({ line: line!, text }))
		)
	);

	const setLine = (index: number, text: string) => {
		edited = { ...edited, [page]: { ...pageEdits, [index]: text } };
	};

	const undoLine = (index: number) => {
		const next = { ...pageEdits };
		delete next[index];
		edited = { ...edited, [page]: next };
	};

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
				filename: `${baseName(doc.filename)}-editado.pdf`
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

{#if loadError}
	<p class="rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger" role="alert">
		{loadError}
	</p>
{:else if !lines}
	<p class="text-sm text-muted">Lendo o texto…</p>
{:else if lines.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		Nenhum texto foi encontrado nesta página. Se o documento for digitalizado, rode o OCR antes para
		criar uma camada de texto.
	</p>
{:else}
	<ul class="space-y-2">
		{#each lines as line, index (index)}
			{@const changed = pageEdits[index] !== undefined && pageEdits[index] !== line.text}
			<li class="flex items-center gap-3">
				<span class="w-10 shrink-0 text-right text-xs text-muted">{index + 1}</span>
				<input
					class="flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm
						{changed ? 'border-accent bg-accent-soft' : 'border-line'}"
					value={pageEdits[index] ?? line.text}
					aria-label="Linha {index + 1}"
					oninput={(e) => setLine(index, e.currentTarget.value)}
				/>
				{#if changed}
					<button
						type="button"
						class="text-xs text-muted underline hover:text-ink"
						onclick={() => undoLine(index)}
					>
						Desfazer
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
