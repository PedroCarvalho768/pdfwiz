<script lang="ts">
	/** Read the document information dictionary and write it back. */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);
	const EDITABLE = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];

	let values = $state<Record<string, string>>({});
	let readOnly = $state<Record<string, string>>({});
	let loading = $state(true);

	$effect(() => {
		const handle = doc?.handle;
		if (!handle) return;
		loading = true;
		runJob('metadata', { handle })
			.then((meta) => {
				values = Object.fromEntries(EDITABLE.map((k) => [k, meta[k] ?? '']));
				readOnly = { CreationDate: meta.CreationDate, ModDate: meta.ModDate };
			})
			.finally(() => (loading = false));
	});

	const save = () =>
		run(async () => [
			await runJob('setMetadata', {
				handle: doc.handle,
				values,
				filename: `${baseName(doc.title || 'document')}.pdf`
			})
		]);

	const clear = () => {
		values = Object.fromEntries(EDITABLE.map((k) => [k, '']));
	};
</script>

{#if loading}
	<p class="text-sm text-muted">Lendo os metadados…</p>
{:else}
	<div class="space-y-4">
		{#each EDITABLE as key (key)}
			<label class="block">
				<span class="text-sm font-medium text-ink">{key}</span>
				<input
					class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
					value={values[key] ?? ''}
					oninput={(e) => (values[key] = e.currentTarget.value)}
				/>
			</label>
		{/each}

		{#if readOnly.CreationDate || readOnly.ModDate}
			<p class="text-xs text-muted">
				Criado em {readOnly.CreationDate || 'desconhecido'}. Modificado em {readOnly.ModDate ||
					'desconhecido'}. Esses são definidos pelo programa que gerou o arquivo e não são editados
				aqui.
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
