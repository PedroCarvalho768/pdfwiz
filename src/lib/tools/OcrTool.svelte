<script lang="ts">
	/**
	 * OCR a scanned document into a searchable PDF.
	 *
	 * Each page is rendered to an image, handed to Tesseract, and returned as
	 * a one-page PDF carrying an invisible text layer over that image; the
	 * pages are then merged back together. The output is therefore
	 * image-based — any vector text in the original is rasterised — which is
	 * the right trade for a scan and the wrong one for a born-digital file.
	 *
	 * Code is self-hosted. tesseract.js defaults to loading its worker and its
	 * WASM core from cdn.jsdelivr.net, which would execute third-party code
	 * with no integrity check. Both are bundled from node_modules here; only
	 * the language model (data, not code) comes from the CDN.
	 */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import { release } from './release';
	import type { ToolProps } from './types';
	import workerPath from 'tesseract.js/dist/worker.min.js?url';
	import coreSimd from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
	import corePlain from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

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

	/** The one network request this tool makes. Keep the copy below in sync. */
	const MODEL_HOST = 'cdn.jsdelivr.net';
	const modelUrl = (lang: string) =>
		`https://${MODEL_HOST}/npm/@tesseract.js-data/${lang}/4.0.0_best_int`;

	// wasm-feature-detect's SIMD probe (the same bytes tesseract.js uses).
	const hasSimd = () =>
		WebAssembly.validate(
			new Uint8Array([
				0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
				253, 15, 253, 98, 11
			])
		);

	let language = $state('por');
	let dpi = $state(200);
	let status = $state('');

	const languageLabel = $derived(LANGUAGES.find(([code]) => code === language)?.[1] ?? language);

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
			status = `Preparando o modelo de ${languageLabel}…`;
			const worker = await createWorker(language, undefined, {
				workerPath,
				// Loaded as a same-origin URL, not wrapped in a blob.
				workerBlobURL: false,
				corePath: hasSimd() ? coreSimd : corePlain,
				langPath: modelUrl(language)
			});

			const handles: string[] = [];
			try {
				for (const [index, image] of images.entries()) {
					status = `Lendo a página ${index + 1} de ${images.length}…`;
					const result = await worker.recognize(
						new Blob([image.bytes as BlobPart], { type: 'image/png' }),
						{},
						{ pdf: true }
					);
					const pdf = result.data.pdf;
					if (!pdf) throw new Error(`O OCR não gerou um PDF para a página ${index + 1}`);
					const opened = await runJob('open', {
						bytes: new Uint8Array(pdf),
						magic: 'application/pdf'
					});
					handles.push(opened.handle);
				}

				status = 'Montando o documento…';
				const stem = baseName(doc.filename);
				const file =
					handles.length === 1
						? await runJob('save', { handle: handles[0], filename: `${stem}-ocr.pdf` })
						: await runJob('merge', { handles, filename: `${stem}-ocr.pdf` });

				const merged = await runJob('open', { bytes: file.bytes, magic: 'application/pdf' });
				handles.push(merged.handle);
				const text = await runJob('extractText', { handle: merged.handle });

				const words = text.trim().split(/\s+/).filter(Boolean).length;
				return {
					files: [file],
					summary: `${words} ${words === 1 ? 'palavra reconhecida' : 'palavras reconhecidas'} em ${images.length} página${images.length === 1 ? '' : 's'}.`,
					preview: text
				};
			} finally {
				release(...handles);
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
		has to be stated plainly rather than buried. It must name exactly what
		is fetched and from where; see MODEL_HOST and modelUrl above.
	-->
	<p class="rounded-[var(--radius-control)] bg-accent-soft p-3 text-xs text-ink">
		<strong>Uma requisição de rede.</strong> Na primeira vez que você usa um idioma, o modelo de
		reconhecimento dele (o arquivo <code>{language}.traineddata.gz</code>) é baixado de
		<code>{MODEL_HOST}</code>, uma CDN pública, e fica guardado neste navegador. É só isso que vem
		de fora: o programa de OCR vem deste site, e o seu documento é lido aqui, no seu dispositivo, e
		nunca é enviado.
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
