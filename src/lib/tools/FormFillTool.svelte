<script lang="ts">
	/** Fill the interactive fields MuPDF finds, then optionally lock them. */
	import { resolve } from '$app/paths';
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	// Raw for the same reason as EditTextTool: worker data is replaced, never
	// mutated, and a proxy of it cannot be posted back.
	let fields = $state.raw<Awaited<ReturnType<typeof runJob<'formFields'>>>>([]);
	let values = $state<Record<string, string>>({});
	let flatten = $state(false);
	let loading = $state(true);

	$effect(() => {
		const handle = doc?.handle;
		if (!handle) return;
		loading = true;
		runJob('formFields', { handle })
			.then((found) => {
				fields = found;
				values = Object.fromEntries(found.map((f) => [f.name, f.value]));
			})
			.finally(() => (loading = false));
	});

	const editable = $derived(fields.filter((f) => !f.readOnly && f.name));

	const save = () =>
		run(async () => [
			await runJob('fillForm', {
				handle: doc.handle,
				values,
				flatten,
				filename: `${baseName(doc.title || 'document')}-filled.pdf`
			})
		]);
</script>

{#if loading}
	<p class="text-sm text-muted">Procurando campos de formulário…</p>
{:else if editable.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		This PDF has no fillable fields. Use <a
			class="underline"
			href={resolve('/[tool]', { tool: 'stamp-image-pdf' })}>Stamp an image</a
		>
		or <a class="underline" href={resolve('/[tool]', { tool: 'header-footer-pdf' })}>Add text</a> to write
		on it anyway.
	</p>
{:else}
	<div class="space-y-4">
		{#each editable as field (field.name)}
			<label class="block">
				<span class="text-sm font-medium text-ink">
					{field.label || field.name}
					<span class="ml-1 text-xs font-normal text-muted">page {field.page + 1}</span>
				</span>

				{#if field.type === 'checkbox' || field.type === 'radiobutton'}
					<input
						type="checkbox"
						class="mt-1 block rounded border-line text-accent"
						checked={values[field.name] !== 'Off' && values[field.name] !== ''}
						onchange={(e) => (values[field.name] = e.currentTarget.checked ? 'true' : 'false')}
					/>
				{:else if field.options.length}
					<select
						class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
						value={values[field.name] ?? ''}
						onchange={(e) => (values[field.name] = e.currentTarget.value)}
					>
						{#each field.options as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				{:else}
					<input
						class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
						value={values[field.name] ?? ''}
						oninput={(e) => (values[field.name] = e.currentTarget.value)}
					/>
				{/if}
			</label>
		{/each}

		<label class="flex items-start gap-3">
			<input type="checkbox" class="mt-0.5 rounded border-line" bind:checked={flatten} />
			<span>
				<span class="text-sm font-medium text-ink">Travar os valores</span>
				<span class="block text-xs text-muted">
					Turns the fields into ordinary page content so nobody can change them, and so every reader
					shows the values.
				</span>
			</span>
		</label>

		<button
			type="button"
			class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
			disabled={busy}
			onclick={save}
		>
			Salvar formulário preenchido
		</button>
	</div>
{/if}
