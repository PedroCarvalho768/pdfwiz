<script lang="ts">
	/**
	 * Fill the interactive fields MuPDF finds, then optionally lock them.
	 *
	 * Only fields the user actually changed are submitted, diffed against the
	 * values the document arrived with.
	 */
	import { resolve } from '$app/paths';
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	type Widget = Awaited<ReturnType<typeof runJob<'formFields'>>>[number];

	// Raw for the same reason as EditTextTool: worker data is replaced, never
	// mutated, and a proxy of it cannot be posted back.
	let widgets = $state.raw<Widget[]>([]);
	let initial = $state.raw<Record<string, string>>({});
	let values = $state<Record<string, string>>({});
	let flatten = $state(false);
	let loading = $state(true);
	let loadError = $state('');

	$effect(() => {
		const handle = doc?.handle;
		if (!handle) return;
		loading = true;
		loadError = '';
		runJob('formFields', { handle })
			.then((found) => {
				widgets = found;
				const first: Record<string, string> = {};
				for (const widget of found) if (!(widget.name in first)) first[widget.name] = widget.value;
				initial = first;
				values = { ...first };
			})
			.catch((err: Error) => (loadError = `Não foi possível ler o formulário: ${err.message}`))
			.finally(() => (loading = false));
	});

	/**
	 * One entry per field name. Radio widgets share a name and become one
	 * group; a button's value is the export value of the widget that is on,
	 * or 'Off', which is exactly what fillForm takes.
	 */
	const fields = $derived.by(() => {
		const groups: Widget[][] = [];
		const at: Record<string, number> = {};
		for (const widget of widgets) {
			if (widget.readOnly || !widget.name) continue;
			if (!(widget.name in at)) at[widget.name] = groups.push([]) - 1;
			groups[at[widget.name]].push(widget);
		}
		return groups;
	});

	// A plain object, never the proxy: $state cannot be structured-cloned
	// into the worker (DataCloneError).
	const changed = $derived(
		Object.fromEntries(
			Object.entries($state.snapshot(values)).filter(([name, value]) => value !== initial[name])
		)
	);
	const changeCount = $derived(Object.keys(changed).length);

	const save = () =>
		run(async () => [
			await runJob('fillForm', {
				handle: doc.handle,
				values: changed,
				flatten,
				filename: `${baseName(doc.filename)}-preenchido.pdf`
			})
		]);
</script>

{#if loading}
	<p class="text-sm text-muted">Procurando campos de formulário…</p>
{:else if loadError}
	<p class="rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger" role="alert">
		{loadError}
	</p>
{:else if fields.length === 0}
	<p class="rounded-[var(--radius-control)] bg-raised p-4 text-sm text-ink">
		Este PDF não tem campos preenchíveis. Use
		<a class="underline" href={resolve('/[tool]', { tool: 'stamp-image-pdf' })}
			>Carimbo ou assinatura</a
		>
		ou
		<a class="underline" href={resolve('/[tool]', { tool: 'header-footer-pdf' })}
			>Cabeçalho ou rodapé</a
		> para escrever nele mesmo assim.
	</p>
{:else}
	<div class="space-y-4">
		{#each fields as group, index (group[0].name)}
			{@const field = group[0]}
			{@const id = `campo-${index}`}
			{@const label = field.label || field.name}
			{#if field.type === 'radiobutton'}
				<fieldset>
					<legend class="text-sm font-medium text-ink">
						{label}
						<span class="ml-1 text-xs font-normal text-muted">página {field.page + 1}</span>
					</legend>
					<div class="mt-1 flex flex-wrap gap-x-5 gap-y-2">
						{#each [...new Set( [...group.map((w) => w.exportValue ?? ''), 'Off'] )] as option (option)}
							<label class="flex items-center gap-2 text-sm text-ink">
								<input
									type="radio"
									name={id}
									class="border-line text-accent focus:ring-accent"
									checked={(values[field.name] || 'Off') === option}
									onchange={() => (values[field.name] = option)}
								/>
								{option === 'Off' ? 'Nenhuma' : option}
							</label>
						{/each}
					</div>
				</fieldset>
			{:else if field.type === 'checkbox'}
				<label class="flex items-center gap-3">
					<input
						type="checkbox"
						class="rounded border-line text-accent focus:ring-accent"
						checked={(values[field.name] || 'Off') !== 'Off'}
						onchange={(e) =>
							(values[field.name] = e.currentTarget.checked ? (field.exportValue ?? 'Yes') : 'Off')}
					/>
					<span class="text-sm font-medium text-ink">
						{label}
						<span class="ml-1 text-xs font-normal text-muted">página {field.page + 1}</span>
					</span>
				</label>
			{:else}
				<div>
					<label for={id} class="text-sm font-medium text-ink">
						{label}
						<span class="ml-1 text-xs font-normal text-muted">página {field.page + 1}</span>
					</label>
					{#if field.options.length}
						<select
							{id}
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
							{id}
							class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
							value={values[field.name] ?? ''}
							oninput={(e) => (values[field.name] = e.currentTarget.value)}
						/>
					{/if}
				</div>
			{/if}
		{/each}

		<label class="flex items-start gap-3">
			<input type="checkbox" class="mt-0.5 rounded border-line" bind:checked={flatten} />
			<span>
				<span class="text-sm font-medium text-ink">Travar os valores</span>
				<span class="block text-xs text-muted">
					Transforma os campos em conteúdo comum da página, para que ninguém possa alterá-los e para
					que todo leitor de PDF mostre os valores.
				</span>
			</span>
		</label>

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
				disabled={busy || (changeCount === 0 && !flatten)}
				onclick={save}
			>
				Salvar formulário preenchido
			</button>
			{#if changeCount === 0 && !flatten}
				<span class="text-sm text-muted">Altere algum campo primeiro.</span>
			{/if}
		</div>
	</div>
{/if}
