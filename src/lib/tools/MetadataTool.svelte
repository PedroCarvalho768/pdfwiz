<script lang="ts">
	/** Read the document information dictionary and write it back. */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import { METADATA_LABELS, type ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);
	const EDITABLE = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];

	let values = $state<Record<string, string>>({});
	let readOnly = $state<Record<string, string>>({});
	let loading = $state(true);
	let loadError = $state('');

	$effect(() => {
		const handle = doc?.handle;
		if (!handle) return;
		loading = true;
		loadError = '';
		runJob('metadata', { handle })
			.then((meta) => {
				values = Object.fromEntries(EDITABLE.map((k) => [k, meta[k] ?? '']));
				readOnly = { CreationDate: meta.CreationDate, ModDate: meta.ModDate };
			})
			.catch((err: Error) => (loadError = `Não foi possível ler os metadados: ${err.message}`))
			.finally(() => (loading = false));
	});

	const save = () =>
		run(async () => [
			await runJob('setMetadata', {
				handle: doc.handle,
				// A $state proxy cannot be structured-cloned into the worker.
				values: $state.snapshot(values),
				filename: `${baseName(doc.filename)}.pdf`
			})
		]);

	const clear = () => {
		values = Object.fromEntries(EDITABLE.map((k) => [k, '']));
	};
</script>

{#if loading}
	<p class="text-sm text-muted">Lendo os metadados…</p>
{:else if loadError}
	<p class="rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger" role="alert">
		{loadError}
	</p>
{:else}
	<div class="space-y-4">
		{#each EDITABLE as key (key)}
			<label class="block">
				<span class="text-sm font-medium text-ink">{METADATA_LABELS[key]}</span>
				<input
					class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
					value={values[key] ?? ''}
					oninput={(e) => (values[key] = e.currentTarget.value)}
				/>
			</label>
		{/each}

		{#if readOnly.CreationDate || readOnly.ModDate}
			<p class="text-xs text-muted">
				Criado em {readOnly.CreationDate || 'data desconhecida'}. Modificado em {readOnly.ModDate ||
					'data desconhecida'}. Essas datas são definidas pelo programa que gerou o arquivo e não
				são editadas aqui.
			</p>
		{/if}

		<div class="flex gap-2">
			<button
				type="button"
				class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
				disabled={busy}
				onclick={save}
			>
				Salvar metadados
			</button>
			<button
				type="button"
				class="rounded-[var(--radius-control)] border border-line bg-bg px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface"
				onclick={clear}
			>
				Limpar tudo
			</button>
		</div>
	</div>
{/if}
