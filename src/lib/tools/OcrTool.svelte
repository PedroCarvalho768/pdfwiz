<script lang="ts">
	/**
	 * OCR a scanned document into a searchable PDF.
	 *
	 * Each page is rendered to an image, handed to Tesseract, and returned as
	 * a one-page PDF carrying an invisible text layer over that image; the
	 * pages are then merged back together. The output is therefore
	 * image-based — any vector text in the original is rasterised — which is
	 * the right trade for a scan and the wrong one for a born-digital file.
	 */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	const LANGUAGES = [
		['eng', 'Inglês'],
		['por', 'Português'],
		['spa', 'Espanhol'],
		['fra', 'Francês'],
		['deu', 'Alemão'],
		['ita', 'Italiano'],
		['nld', 'Holandês'],
		['rus', 'Russo'],
		['chi_sim', 'Chinês (simplificado)'],
		['jpn', 'Japonês'],
		['kor', 'Coreano'],
		['ara', 'Árabe']
	];

	let language = $state('eng');
	let dpi = $state(200);
	let status = $state('');

	const start = () =>
		run(async () => {
			status = 'Renderizando as páginas…';
			const images = await runJob('toImages', {
				handle: doc.handle,
				format: 'png',
				dpi,
				stem: 'ocr'
			});

			const { createWorker } = await import('tesseract.js');
			status = `Baixando o modelo de ${language}…`;
			const worker = await createWorker(language);

			try {
				const handles: string[] = [];
				for (const [index, image] of images.entries()) {
					status = `Lendo a página ${index + 1} de ${images.length}…`;
					const result = await worker.recognize(
						new Blob([image.bytes as BlobPart], { type: 'image/png' }),
						{},
						{ pdf: true }
					);
					const pdf = result.data.pdf;
					if (!pdf) throw new Error('Tesseract returned no PDF for this page');
					const opened = await runJob('open', {
						bytes: new Uint8Array(pdf),
						magic: 'application/pdf'
					});
					handles.push(opened.handle);
				}

				status = 'Montando o documento…';
				const stem = baseName(doc.title || 'document');
				const file =
					handles.length === 1
						? await runJob('save', { handle: handles[0], filename: `${stem}-ocr.pdf` })
						: await runJob('merge', { handles, filename: `${stem}-ocr.pdf` });

				const text = await runJob('extractText', {
					handle: (await runJob('open', { bytes: file.bytes, magic: 'application/pdf' })).handle
				});

				return {
					files: [file],
					summary: `${text.trim().split(/\s+/).filter(Boolean).length} palavras reconhecidas em ${images.length} página${images.length === 1 ? '' : 's'}.`,
					preview: text
				};
			} finally {
				await worker.terminate();
				status = '';
			}
		});
</script>

<div class="space-y-4">
	<label class="block">
		<span class="text-sm font-medium text-ink">Idioma</span>
		<select
			class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
			bind:value={language}
		>
			{#each LANGUAGES as [code, label] (code)}
				<option value={code}>{label}</option>
			{/each}
		</select>
	</label>

	<label class="block">
		<span class="text-sm font-medium text-ink">Resolução (dpi)</span>
		<input
			type="number"
			min="100"
			max="400"
			class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
			bind:value={dpi}
		/>
		<span class="mt-1 block text-xs text-muted">
			Mais alto é mais preciso e mais lento. 200 serve para a maioria dos documentos.
		</span>
	</label>

	<!--
		The privacy claim on every other page is absolute, so the one exception
		has to be stated plainly rather than buried.
	-->
	<p class="rounded-[var(--radius-control)] bg-accent-soft p-3 text-xs text-ink">
		<strong>Uma requisição de rede.</strong> The language model is downloaded from a public CDN the first
		time you use it. Your document is still processed entirely on this device and is never uploaded.
	</p>

	<button
		type="button"
		class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
		disabled={busy}
		onclick={start}
	>
		{busy ? 'Processando…' : 'Rodar OCR'}
	</button>

	{#if status}
		<p class="text-sm text-muted" aria-live="polite">{status}</p>
	{/if}
</div>
