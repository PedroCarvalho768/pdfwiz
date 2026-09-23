<script lang="ts">
	import { downloadAll, downloadFile, formatBytes } from '$lib/download';
	import type { ToolResult } from '$lib/tools/types';

	let { result, onreset }: { result: ToolResult; onreset: () => void } = $props();

	const files = $derived(result.files);
	const totalBytes = $derived(files.reduce((sum, file) => sum + file.bytes.byteLength, 0));
	const details = $derived(Object.entries(result.details ?? {}).filter(([, v]) => v));

	// The form that produced this is gone; without this, keyboard and
	// screen-reader focus is left on a removed node at the top of the page.
	let heading: HTMLElement;
	$effect(() => heading.focus());
</script>

<section class="rounded-[var(--radius-card)] border border-accent/25 bg-accent-soft p-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 bind:this={heading} tabindex="-1" class="text-lg font-semibold text-ink">
				{#if files.length}
					Pronto, {files.length}
					{files.length === 1 ? 'arquivo' : 'arquivos'} ({formatBytes(totalBytes)})
				{:else}
					Pronto
				{/if}
			</h2>
			{#if result.summary}
				<p class="mt-1 text-sm text-ink">{result.summary}</p>
			{/if}
		</div>
		<div class="flex gap-2">
			{#if files.length}
				<button
					type="button"
					class="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110"
					onclick={() => downloadAll(files)}
				>
					{files.length === 1 ? 'Baixar' : 'Baixar tudo (.zip)'}
				</button>
			{/if}
			<button
				type="button"
				class="rounded-[var(--radius-control)] border border-line bg-bg px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
				onclick={onreset}
			>
				Começar de novo
			</button>
		</div>
	</div>

	{#if details.length}
		<dl class="mt-4 grid gap-x-6 gap-y-1 border-t border-accent/25 pt-4 sm:grid-cols-2">
			{#each details as [key, value] (key)}
				<div class="flex justify-between gap-4 text-sm">
					<dt class="text-muted">{key}</dt>
					<dd class="text-right font-medium break-words text-ink">{value}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if files.length > 1}
		<ul class="mt-4 max-h-72 divide-y divide-line overflow-y-auto border-t border-accent/25">
			{#each files as file, index (index)}
				<li class="flex items-center justify-between py-2 text-sm">
					<span class="truncate text-ink">{file.filename}</span>
					<span class="flex shrink-0 items-center gap-3">
						<span class="text-muted">{formatBytes(file.bytes.byteLength)}</span>
						<button
							type="button"
							class="font-medium text-muted underline hover:text-accent"
							onclick={() => downloadFile(file)}
						>
							Baixar
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if result.preview}
		<details class="mt-4 border-t border-accent/25 pt-3">
			<summary class="cursor-pointer text-sm font-medium text-ink">Prévia</summary>
			<pre
				class="mt-2 max-h-96 overflow-auto rounded-[var(--radius-control)] bg-bg p-3 text-xs whitespace-pre-wrap text-ink">{result.preview}</pre>
		</details>
	{/if}
</section>
