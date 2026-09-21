<script lang="ts">
	/**
	 * The one page that renders every tool.
	 *
	 * It owns everything common: picking files, opening them in the engine,
	 * password prompts, the busy flag, error display and the result panel.
	 * A tool supplies either a field list (rendered by FormTool) or its own
	 * component, and never touches any of the above.
	 */
	import { resolve } from '$app/paths';
	import { magicFor, run as runJob } from '$lib/engine/client';
	import { PASSWORD_REQUIRED, type DocInfo, type OutputFile } from '$lib/engine/contract';
	import Dropzone from '$lib/ui/Dropzone.svelte';
	import FormTool from '$lib/ui/FormTool.svelte';
	import ResultPanel from '$lib/ui/ResultPanel.svelte';
	import type { Component } from 'svelte';
	import type { ToolProps, ToolResult } from '$lib/tools/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const tool = $derived(data.tool);

	let ToolComponent = $state<Component<ToolProps> | null>(null);
	let docs = $state<DocInfo[]>([]);
	let sources = $state<File[]>([]);
	let result = $state<ToolResult | null>(null);
	let error = $state('');
	let busy = $state(false);
	let progress = $state('');
	/** Set when a file needs a password; holds the file awaiting one. */
	let locked = $state<File | null>(null);
	let password = $state('');

	// Swap the custom component (and reset state) whenever the tool changes.
	$effect(() => {
		const id = tool.id;
		reset();
		ToolComponent = null;
		if (!tool.component) return;
		tool.component().then((module) => {
			if (tool.id === id) ToolComponent = module.default;
		});
	});

	function reset() {
		docs = [];
		sources = [];
		result = null;
		error = '';
		progress = '';
		locked = null;
		password = '';
	}

	async function open(file: File, withPassword?: string): Promise<DocInfo> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const info = await runJob('open', {
			bytes,
			magic: magicFor(file),
			password: withPassword
		});
		// DocInfo has no room for the original name, but every tool wants it
		// for sensible output filenames.
		return { ...info, title: info.title || file.name };
	}

	async function addFiles(files: File[]) {
		error = '';
		busy = true;
		try {
			sources = tool.input === 'multiple' ? [...sources, ...files] : files;

			// Office formats cannot be parsed by the engine; those tools take
			// the raw file and convert it themselves.
			if (tool.raw) return;

			const opened: DocInfo[] = [];
			for (const file of files) {
				progress = `Abrindo ${file.name}…`;
				opened.push(await open(file));
			}
			docs = tool.input === 'multiple' ? [...docs, ...opened] : opened;
		} catch (err) {
			const failure = err as { message: string; code?: string };
			if (failure.code === PASSWORD_REQUIRED) {
				locked = files[0];
				sources = [];
				error = '';
			} else {
				sources = [];
				error = failure.message;
			}
		} finally {
			busy = false;
			progress = '';
		}
	}

	async function unlock() {
		if (!locked) return;
		busy = true;
		error = '';
		try {
			const info = await open(locked, password);
			docs = [info];
			sources = [locked];
			locked = null;
			password = '';
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	/** Shared run wrapper: every tool gets identical busy and error handling. */
	async function run(task: () => Promise<ToolResult | OutputFile[]>) {
		error = '';
		busy = true;
		try {
			const outcome = await task();
			result = Array.isArray(outcome) ? { files: outcome } : outcome;
		} catch (err) {
			error = (err as Error).message || String(err);
		} finally {
			busy = false;
			progress = '';
		}
	}

	const ready = $derived(tool.raw ? sources.length > 0 : docs.length > 0);
	const showDropzone = $derived(!ready || tool.input === 'multiple');
</script>

<svelte:head>
	<title>{tool.title} de graça, no seu navegador | PDFWiz</title>
	<meta name="description" content={tool.blurb} />
</svelte:head>

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
					Enter the password to open <strong>{locked.name}</strong>. It is used here in your browser
					and never sent anywhere.
				</p>
				<div class="mt-3 flex gap-2">
					<!-- svelte-ignore a11y_autofocus -->
					<input
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
		{:else if showDropzone}
			<Dropzone
				accept={tool.accept}
				multiple={tool.input === 'multiple'}
				disabled={busy}
				onfiles={addFiles}
			/>
		{/if}

		{#if error}
			<p
				class="mt-4 rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger"
				role="alert"
			>
				{error}
			</p>
		{/if}

		{#if progress}
			<p class="mt-4 text-sm text-muted" aria-live="polite">{progress}</p>
		{/if}

		{#if ready}
			{#if sources.length}
				<p class="mt-4 text-sm text-muted">
					{sources.map((f) => f.name).join(', ')}
				</p>
			{/if}

			<section class="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-6">
				{#if tool.component}
					{#if ToolComponent}
						<ToolComponent {docs} {busy} {run} />
					{:else}
						<p class="text-sm text-muted">Carregando ferramenta…</p>
					{/if}
				{:else}
					<FormTool {tool} {docs} {sources} {busy} {run} />
				{/if}
			</section>
		{/if}
	{/if}
</article>
