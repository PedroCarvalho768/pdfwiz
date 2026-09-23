<script lang="ts">
	import { run as runJob } from '$lib/engine/client';
	import { chunkPages, describeSelection, parseRangeGroups } from '$lib/engine/pages';
	import { baseName } from '$lib/download';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);
	const stem = $derived(baseName(doc?.filename ?? 'documento'));

	let mode = $state<'ranges' | 'every' | 'single'>('ranges');
	let ranges = $state('1-1');
	let every = $state(1);

	/**
	 * Previewing the selection as the user types is why `pages.ts` is kept free
	 * of any engine import — this runs on every keystroke.
	 */
	const preview = $derived.by((): { groups: number[][]; error: string } => {
		if (!doc) return { groups: [], error: '' };
		try {
			if (mode === 'every') return { groups: chunkPages(doc.pageCount, every), error: '' };
			if (mode === 'single') return { groups: chunkPages(doc.pageCount, 1), error: '' };
			return { groups: parseRangeGroups(ranges, doc.pageCount), error: '' };
		} catch (err) {
			return { groups: [], error: (err as Error).message };
		}
	});

	const split = () =>
		run(async () =>
			runJob('extract', {
				handle: doc.handle,
				selections: preview.groups.map((pages) => ({
					pages,
					filename: `${stem}-${describeSelection(pages)}.pdf`
				}))
			})
		);
</script>

<fieldset class="space-y-3">
	<legend class="mb-2 text-sm font-medium text-ink">Como dividir?</legend>

	<label class="flex items-start gap-3">
		<input type="radio" bind:group={mode} value="ranges" class="mt-1" />
		<span class="flex-1">
			<span class="block text-sm font-medium text-ink">Por intervalo de páginas</span>
			<span class="text-xs text-muted">
				Um arquivo por grupo separado por vírgula. "1-3,4-6" gera dois arquivos.
			</span>
			<input
				type="text"
				bind:value={ranges}
				disabled={mode !== 'ranges'}
				placeholder="1-3,4-6"
				class="mt-2 w-full rounded-[var(--radius-control)] border-line text-sm disabled:bg-surface"
			/>
		</span>
	</label>

	<label class="flex items-start gap-3">
		<input type="radio" bind:group={mode} value="every" class="mt-1" />
		<span class="flex-1">
			<span class="block text-sm font-medium text-ink">A cada N páginas</span>
			<input
				type="number"
				bind:value={every}
				min="1"
				max={doc?.pageCount ?? 1}
				disabled={mode !== 'every'}
				class="mt-2 w-28 rounded-[var(--radius-control)] border-line text-sm disabled:bg-surface"
			/>
		</span>
	</label>

	<label class="flex items-start gap-3">
		<input type="radio" bind:group={mode} value="single" class="mt-1" />
		<span class="flex-1">
			<span class="block text-sm font-medium text-ink">Um arquivo por página</span>
			<span class="text-xs text-muted">{doc?.pageCount ?? 0} arquivos separados.</span>
		</span>
	</label>
</fieldset>

{#if preview.error}
	<p
		class="mt-4 rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger"
		role="alert"
	>
		{preview.error}
	</p>
{:else if preview.groups.length}
	<p class="mt-4 text-sm text-muted">
		Gera <strong>{preview.groups.length}</strong>
		{preview.groups.length === 1 ? 'arquivo' : 'arquivos'}:
		<span class="text-muted">
			{preview.groups
				.slice(0, 6)
				.map((g) => describeSelection(g))
				.join(' · ')}{preview.groups.length > 6 ? ' …' : ''}
		</span>
	</p>
{/if}

<button
	type="button"
	class="mt-4 rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
	disabled={busy || !!preview.error || preview.groups.length === 0}
	onclick={split}
>
	Dividir PDF
</button>
