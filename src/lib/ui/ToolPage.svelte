<script lang="ts">
	/**
	 * The one body that renders every tool.
	 *
	 * It owns everything common: picking files, opening them in the engine,
	 * password prompts, the busy flag, error display and the result panel.
	 * A tool supplies either a field list (rendered by FormTool) or its own
	 * component, and never touches any of the above.
	 *
	 * The route mounts this inside `{#key tool.id}`, so moving between tools
	 * destroys the instance and every piece of state with it. There is no
	 * reset effect to forget a variable in.
	 */
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { magicFor, run as runJob } from '$lib/engine/client';
	import { PASSWORD_REQUIRED, type OutputFile } from '$lib/engine/contract';
	import { formatBytes } from '$lib/download';
	import { release } from '$lib/tools/release';
	import Dropzone from '$lib/ui/Dropzone.svelte';
	import FormTool from '$lib/ui/FormTool.svelte';
	import ResultPanel from '$lib/ui/ResultPanel.svelte';
	import type { Component } from 'svelte';
	import type { LoadedDoc, Tool, ToolProps, ToolResult } from '$lib/tools/types';

	let { tool }: { tool: Tool } = $props();

	/** Past these, warn before the browser runs out of memory. */
	const BIG_FILE_BYTES = 200 * 1024 * 1024;
	const MANY_PAGES = 500;

	let ToolComponent = $state.raw<Component<ToolProps> | null>(null);
	let loadError = $state('');
	// Raw: these come back from the worker and are replaced, never mutated.
	// A deep proxy of them could not be posted back.
	let docs = $state.raw<LoadedDoc[]>([]);
	let sources = $state.raw<File[]>([]);
	let result = $state.raw<ToolResult | null>(null);
	let error = $state('');
	let busy = $state(false);
	let progress = $state('');
	/** Screen-reader announcements. The region exists from mount, empty. */
	let announcement = $state('');
	/** The file waiting for a password, and the files queued behind it. */
	let locked = $state.raw<{ file: File; rest: File[] } | null>(null);
	let password = $state('');
	let errorBox = $state<HTMLElement>();

	$effect(() => {
		if (!tool.component) return;
		tool
			.component()
			.then((module) => (ToolComponent = module.default))
			.catch((err: Error) => {
				loadError = `Não foi possível carregar esta ferramenta (${err.message}).`;
			});
	});

	// An error the user cannot see has not been reported. Move focus to it,
	// which also scrolls it into view.
	$effect(() => {
		if (error && errorBox) errorBox.focus();
	});

	onDestroy(() => release(...docs.map((doc) => doc.handle)));

	async function open(file: File, withPassword?: string): Promise<LoadedDoc> {
		// ponytail: the buffer is structured-cloned into the worker, so the
		// file briefly exists twice. Transferring needs a transfer list in
		// engine/client.ts `run`.
		const bytes = new Uint8Array(await file.arrayBuffer());
		const info = await runJob('open', { bytes, magic: magicFor(file), password: withPassword });
		return { ...info, filename: file.name };
	}

	/** Close every open document and forget the inputs. */
	function clearInputs() {
		release(...docs.map((doc) => doc.handle));
		docs = [];
		sources = [];
		locked = null;
		password = '';
	}

	function reset() {
		clearInputs();
		result = null;
		error = '';
		progress = '';
		announcement = '';
	}

	async function addFiles(files: File[]) {
		error = '';
		// A single-file tool swaps its input; a multi-file tool appends.
		if (tool.input !== 'multiple') clearInputs();
		// Office formats cannot be parsed by the engine; those tools take
		// the raw file and convert it themselves.
		if (tool.raw) {
			sources = [...sources, ...files];
			return;
		}
		await openAll(files);
	}

	/**
	 * Open files in order. A locked file pauses the queue: the documents
	 * already open stay, and the rest resume once the password is given.
	 */
	async function openAll(files: File[], withPassword?: string) {
		busy = true;
		const failures: string[] = [];
		try {
			for (const [index, file] of files.entries()) {
				progress = `Abrindo ${file.name}…`;
				announcement = progress;
				try {
					const doc = await open(file, index === 0 ? withPassword : undefined);
					docs = [...docs, doc];
					sources = [...sources, file];
					if (locked?.file === file) {
						locked = null;
						password = '';
					}
				} catch (err) {
					const failure = err as { message: string; code?: string };
					if (failure.code === PASSWORD_REQUIRED) {
						locked = { file, rest: files.slice(index + 1) };
						// Only a password that was actually tried can be wrong.
						if (index === 0 && withPassword) failures.push(failure.message);
						return;
					}
					failures.push(`${file.name}: ${failure.message}`);
				}
			}
		} finally {
			busy = false;
			progress = '';
			error = failures.join(' ');
			announcement = locked ? `${locked.file.name} está protegido por senha.` : '';
		}
	}

	function unlock() {
		if (locked) void openAll([locked.file, ...locked.rest], password);
	}

	function remove(handle: string) {
		const index = docs.findIndex((doc) => doc.handle === handle);
		if (index < 0) return;
		release(handle);
		docs = docs.filter((_, i) => i !== index);
		sources = sources.filter((_, i) => i !== index);
	}

	function removeSource(index: number) {
		if (!tool.raw) return remove(docs[index].handle);
		sources = sources.filter((_, i) => i !== index);
	}

	/** Shared run wrapper: every tool gets identical busy and error handling. */
	async function run(task: () => Promise<ToolResult | OutputFile[]>) {
		error = '';
		busy = true;
		announcement = 'Processando…';
		try {
			const outcome = await task();
			result = Array.isArray(outcome) ? { files: outcome } : outcome;
			// Short on purpose: focus lands on the result heading, which reads
			// the details. Repeating the summary here would read it twice.
			announcement = 'Pronto.';
		} catch (err) {
			error = (err as Error).message || String(err);
			announcement = '';
		} finally {
			busy = false;
			progress = '';
		}
	}

	const ready = $derived(tool.raw ? sources.length > 0 : docs.length > 0);

	const warning = $derived.by(() => {
		const big = sources.find((file) => file.size > BIG_FILE_BYTES);
		if (big)
			return `${big.name} tem ${formatBytes(big.size)}. Um arquivo desse tamanho pode deixar o navegador lento ou esgotar a memória do dispositivo.`;
		const pages = docs.reduce((sum, doc) => sum + doc.pageCount, 0);
		if (tool.rasterizes && pages > MANY_PAGES)
			return `São ${pages} páginas, e esta ferramenta desenha cada uma como imagem. Pode demorar bastante e usar muita memória.`;
		return '';
	});

	const buttonClass =
		'rounded-[var(--radius-control)] border border-line bg-bg px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface';
</script>

<article class="mx-auto w-full max-w-3xl px-4 py-12 lg:py-16">
	<nav class="mb-8 text-sm text-muted">
		<a
			class="underline decoration-line underline-offset-4 hover:text-ink hover:decoration-accent"
			href={resolve('/')}
		>
			Todas as ferramentas
		</a>
		<span aria-hidden="true"> / </span>
		<span>{tool.group}</span>
	</nav>

	<header class="mb-8">
		<h1 class="display text-[clamp(2rem,4.5vw,3.25rem)]">{tool.title}</h1>
		<p class="mt-3 max-w-[60ch] text-lg text-muted">{tool.blurb}</p>
	</header>

	{#if tool.note}
		<!-- The honest caveat for this tool. Neutral surface on purpose: it is
		     information, not a warning, and a second alert colour would
		     compete with the one accent. -->
		<p class="mb-8 max-w-[68ch] border-t border-line pt-4 text-sm text-muted">
			{tool.note}
		</p>
	{/if}

	<p class="sr-only" aria-live="polite">{announcement}</p>

	{#if result}
		<ResultPanel {result} onreset={reset} />
	{:else}
		{#if locked}
			<form
				class="rounded-[var(--radius-card)] border border-line bg-bg p-5"
				onsubmit={(e) => {
					e.preventDefault();
					unlock();
				}}
			>
				<h2 class="text-lg font-semibold text-ink">Este PDF está protegido por senha</h2>
				<p class="mt-1 text-sm text-muted">
					Digite a senha para abrir <strong>{locked.file.name}</strong>. Ela é usada aqui, no seu
					navegador, e não é enviada a lugar nenhum.
				</p>
				<label for="pdf-password" class="mt-3 block text-sm font-medium text-ink">
					Senha de {locked.file.name}
				</label>
				<div class="mt-1 flex gap-2">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="pdf-password"
						type="password"
						name="pdf-password"
						autocomplete="current-password"
						spellcheck="false"
						autofocus
						class="flex-1 rounded-[var(--radius-control)] border-line text-sm"
						placeholder="Senha"
						bind:value={password}
					/>
					<button
						type="submit"
						class="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
						disabled={busy || !password}
					>
						Desbloquear
					</button>
				</div>
			</form>
		{:else if !ready}
			<Dropzone
				accept={tool.accept}
				multiple={tool.input === 'multiple'}
				disabled={busy}
				onfiles={addFiles}
			/>
		{/if}

		{#if ready}
			{#if tool.input === 'multiple'}
				{#if !tool.component}
					<ul class="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-bg">
						{#each sources as file, index (index)}
							<li class="flex items-center justify-between gap-3 px-4 py-2 text-sm">
								<span class="min-w-0 truncate text-ink">{file.name}</span>
								<button
									type="button"
									class={buttonClass}
									aria-label="Remover {file.name}"
									disabled={busy}
									onclick={() => removeSource(index)}
								>
									Remover
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-3">
					<Dropzone
						compact
						multiple
						accept={tool.accept}
						disabled={busy || !!locked}
						onfiles={addFiles}
					/>
				</div>
			{:else}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="min-w-0 truncate text-sm text-muted">{sources[0]?.name}</p>
					<Dropzone compact accept={tool.accept} disabled={busy} onfiles={addFiles} />
				</div>
			{/if}

			{#if warning}
				<p class="mt-4 rounded-[var(--radius-control)] bg-raised p-3 text-sm text-ink">
					{warning}
				</p>
			{/if}

			<section class="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-6">
				{#if tool.component}
					{#if ToolComponent}
						<ToolComponent {docs} {busy} {run} {remove} />
					{:else if loadError}
						<div role="alert" class="space-y-3 text-sm text-danger">
							<p>{loadError} Verifique a conexão e recarregue a página.</p>
							<button type="button" class={buttonClass} onclick={() => location.reload()}>
								Recarregar a página
							</button>
						</div>
					{:else}
						<p class="text-sm text-muted">Carregando ferramenta…</p>
					{/if}
				{:else}
					<FormTool {tool} {docs} {sources} {busy} {run} />
				{/if}
			</section>
		{/if}

		<!-- Below the form, next to the button that caused it, and focused. -->
		<div aria-live="assertive">
			{#if error}
				<p
					bind:this={errorBox}
					tabindex="-1"
					class="mt-4 rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger"
					role="alert"
				>
					{error}
				</p>
			{/if}
		</div>

		{#if progress}
			<p class="mt-4 text-sm text-muted">{progress}</p>
		{/if}
	{/if}
</article>
