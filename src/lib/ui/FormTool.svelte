<script lang="ts">
	/**
	 * Renders any field-driven tool. This component is the reason the catalog
	 * can grow to dozens of tools without growing the UI: a tool declares its
	 * inputs and an `execute`, and everything below happens here.
	 */
	import { parsePageRange } from '$lib/engine/pages';
	import { baseName } from '$lib/download';
	import type { OutputFile } from '$lib/engine/contract';
	import { defaultValues, type FieldValues, type Tool, type ToolResult } from '$lib/tools/types';
	import type { DocInfo } from '$lib/engine/contract';

	let {
		tool,
		docs,
		sources,
		busy,
		run
	}: {
		tool: Tool;
		docs: DocInfo[];
		sources: File[];
		busy: boolean;
		run: (task: () => Promise<ToolResult | OutputFile[]>) => void;
	} = $props();

	// Populated by the effect below, which also runs on mount — so the form
	// resets whenever a different tool is shown.
	let values = $state<FieldValues>({});
	let picked = $state<Record<string, File>>({});

	$effect(() => {
		values = defaultValues(tool.fields);
		picked = {};
	});

	const pageCount = $derived(docs[0]?.pageCount ?? 0);

	/**
	 * Validate every page field as the user types. This is why `pages.ts` is
	 * kept free of any engine import — it runs on each keystroke, and pulling
	 * in MuPDF to parse "1-3" would load a 10 MB WASM binary.
	 */
	const pageErrors = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const field of tool.fields ?? []) {
			if (field.kind !== 'pages') continue;
			const raw = String(values[field.key] ?? '').trim();
			if (!raw) continue;
			try {
				parsePageRange(raw, pageCount);
			} catch (err) {
				out[field.key] = (err as Error).message;
			}
		}
		return out;
	});

	const missingFiles = $derived(
		(tool.fields ?? []).filter((f) => f.kind === 'file' && !picked[f.key]).map((f) => f.label)
	);

	const blocked = $derived(busy || Object.keys(pageErrors).length > 0 || missingFiles.length > 0);

	function submit() {
		run(async () => {
			if (!tool.execute) throw new Error(`${tool.title} não tem ação definida`);
			return tool.execute({
				docs,
				sources,
				values,
				files: picked,
				stem: baseName(docs[0]?.title || sources[0]?.name || 'document'),
				pages: (key) => {
					const raw = String(values[key] ?? '').trim();
					return raw ? parsePageRange(raw, pageCount) : undefined;
				}
			});
		});
	}

	const inputClass =
		'mt-1 w-full rounded-[var(--radius-control)] border-line text-sm shadow-sm focus:border-accent focus:ring-accent';
</script>

<form
	class="space-y-4"
	onsubmit={(e) => {
		e.preventDefault();
		if (!blocked) submit();
	}}
>
	{#each tool.fields ?? [] as field (field.key)}
		<div>
			{#if field.kind === 'checkbox'}
				<label class="flex items-start gap-3">
					<input
						type="checkbox"
						class="mt-0.5 rounded border-line text-accent focus:ring-accent"
						checked={Boolean(values[field.key])}
						onchange={(e) => (values[field.key] = e.currentTarget.checked)}
					/>
					<span>
						<span class="text-sm font-medium text-ink">{field.label}</span>
						{#if field.help}
							<span class="block text-xs text-muted">{field.help}</span>
						{/if}
					</span>
				</label>
			{:else}
				<label class="block">
					<span class="text-sm font-medium text-ink">{field.label}</span>

					{#if field.kind === 'select'}
						<select
							class={inputClass}
							value={String(values[field.key] ?? '')}
							onchange={(e) => (values[field.key] = e.currentTarget.value)}
						>
							{#each field.options as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					{:else if field.kind === 'number'}
						<input
							type="number"
							class={inputClass}
							min={field.min}
							max={field.max}
							step={field.step ?? 1}
							value={Number(values[field.key] ?? 0)}
							oninput={(e) => (values[field.key] = e.currentTarget.valueAsNumber || 0)}
						/>
					{:else if field.kind === 'color'}
						<input
							type="color"
							class="mt-1 block h-10 w-20 cursor-pointer rounded border border-line"
							value={String(values[field.key] ?? '#000000')}
							oninput={(e) => (values[field.key] = e.currentTarget.value)}
						/>
					{:else if field.kind === 'textarea'}
						<textarea
							class={inputClass}
							rows="4"
							placeholder={field.placeholder}
							value={String(values[field.key] ?? '')}
							oninput={(e) => (values[field.key] = e.currentTarget.value)}></textarea>
					{:else if field.kind === 'file'}
						<input
							type="file"
							class="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-raised file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-raised"
							accept={field.accept.join(',')}
							onchange={(e) => {
								const file = e.currentTarget.files?.[0];
								if (file) picked = { ...picked, [field.key]: file };
							}}
						/>
					{:else}
						<input
							type={field.kind === 'password' ? 'password' : 'text'}
							class={inputClass}
							placeholder={field.kind === 'pages' ? 'e.g. 1-3,7' : field.placeholder}
							value={String(values[field.key] ?? '')}
							oninput={(e) => (values[field.key] = e.currentTarget.value)}
						/>
					{/if}

					{#if field.kind === 'pages' && pageCount}
						<span class="mt-1 block text-xs text-muted">
							{field.help}
							Este documento tem {pageCount}
							{pageCount === 1 ? 'página' : 'páginas'}.
						</span>
					{:else if 'help' in field && field.help}
						<span class="mt-1 block text-xs text-muted">{field.help}</span>
					{/if}

					{#if pageErrors[field.key]}
						<span class="mt-1 block text-xs text-danger" role="alert">
							{pageErrors[field.key]}
						</span>
					{/if}
				</label>
			{/if}
		</div>
	{/each}

	<div class="flex flex-wrap items-center gap-3 pt-2">
		<button
			type="submit"
			class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
			disabled={blocked}
		>
			{busy ? 'Processando…' : tool.title}
		</button>
		{#if missingFiles.length}
			<span class="text-sm text-muted">Escolha {missingFiles.join(' e ')} primeiro.</span>
		{/if}
	</div>
</form>
