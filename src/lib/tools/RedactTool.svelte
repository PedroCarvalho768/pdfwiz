<script lang="ts">
	/**
	 * Search, review, then redact.
	 *
	 * Redaction destroys text for good, so nothing is removed that the user has
	 * not seen. Matching is tolerant (case, accents, line breaks, punctuation in
	 * digits mode); only whole-word hits start checked. Hits inside longer
	 * words and near misses are listed unchecked, so "Silva" never silently
	 * takes "Silvana" with it.
	 */
	import { run as runJob } from '$lib/engine/client';
	import { baseName } from '$lib/download';
	import type { Match, MatchKind, MatchMode } from '$lib/engine/match';
	import type { ToolProps } from './types';

	let { docs, busy, run }: ToolProps = $props();

	const doc = $derived(docs[0]);

	let query = $state('');
	let mode = $state<MatchMode>('text');
	let blackBoxes = $state(true);
	let removeImages = $state(false);

	// Raw: worker results are replaced wholesale and posted back as plain data.
	let matches = $state.raw<Match[]>([]);
	let selected = $state.raw<Set<number>>(new Set());
	let searching = $state(false);
	let searchError = $state('');
	let searched = $state('');

	const GROUPS: { kind: MatchKind; title: string; help: string }[] = [
		{ kind: 'exact', title: 'Ocorrências exatas', help: 'Marcadas para tarjar.' },
		{
			kind: 'partial',
			title: 'Dentro de outras palavras',
			help: 'Por exemplo, "Silva" dentro de "Silvana". Marque só as que devem sumir.'
		},
		{
			kind: 'similar',
			title: 'Parecidas',
			help: 'Erros de digitação ou de OCR. Confira uma a uma antes de marcar.'
		}
	];

	let request = 0;
	$effect(() => {
		const handle = doc?.handle;
		const q = query.trim();
		const m = mode;
		if (!handle || q.length < 2) {
			matches = [];
			selected = new Set();
			searched = '';
			return;
		}
		const id = ++request;
		const timer = setTimeout(() => {
			searching = true;
			searchError = '';
			runJob('findMatches', { handle, query: q, mode: m })
				.then((found) => {
					if (id !== request) return;
					matches = found;
					selected = new Set(found.flatMap((match, i) => (match.kind === 'exact' ? [i] : [])));
					searched = q;
				})
				.catch((err: Error) => id === request && (searchError = err.message))
				.finally(() => id === request && (searching = false));
		}, 250);
		return () => clearTimeout(timer);
	});

	const toggle = (i: number) => {
		selected = selected.has(i)
			? new Set([...selected].filter((x) => x !== i))
			: new Set([...selected, i]);
	};

	const setGroup = (kind: MatchKind, on: boolean) => {
		const group = matches.flatMap((m, i) => (m.kind === kind ? [i] : []));
		selected = on
			? new Set([...selected, ...group])
			: new Set([...selected].filter((i) => !group.includes(i)));
	};

	const chosen = $derived(matches.filter((_, i) => selected.has(i)));
	const pagesTouched = $derived(new Set(chosen.map((m) => m.page)).size);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	const redact = () =>
		run(async () => {
			const file = await runJob('redact', {
				handle: doc.handle,
				areas: chosen.flatMap((m) => m.rects.map((rect) => ({ page: m.page, rect }))),
				blackBoxes,
				removeImages,
				filename: `${baseName(doc.filename)}-tarjado.pdf`
			});
			return {
				files: [file],
				summary: `${plural(chosen.length, 'ocorrência removida', 'ocorrências removidas')} em ${plural(pagesTouched, 'página', 'páginas')}.`
			};
		});
</script>

<div class="space-y-5">
	<div>
		<label for="redact-query" class="text-sm font-medium text-ink">Texto a remover</label>
		<input
			id="redact-query"
			class="mt-1 w-full rounded-[var(--radius-control)] border-line text-sm"
			placeholder={mode === 'digits' ? 'ex.: 123.456.789-00' : 'um nome, um e-mail, uma conta'}
			autocomplete="off"
			bind:value={query}
		/>
		<fieldset class="mt-3 flex flex-wrap gap-x-5 gap-y-2">
			<legend class="sr-only">Como comparar</legend>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input
					type="radio"
					name="redact-mode"
					value="text"
					class="border-line text-accent focus:ring-accent"
					bind:group={mode}
				/>
				Texto (ignora maiúsculas, acentos e quebras de linha)
			</label>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input
					type="radio"
					name="redact-mode"
					value="digits"
					class="border-line text-accent focus:ring-accent"
					bind:group={mode}
				/>
				Só os números (CPF, CNPJ, telefone, conta)
			</label>
		</fieldset>
	</div>

	<div aria-live="polite" class="text-sm text-muted">
		{#if searching}
			Procurando…
		{:else if searchError}
			<span class="text-danger" role="alert">{searchError}</span>
		{:else if searched && matches.length === 0}
			Nada encontrado para "{searched}".
			{#if mode === 'text' && /\d{3}/.test(searched)}
				<button
					type="button"
					class="min-h-6 text-accent underline"
					onclick={() => (mode = 'digits')}>Procurar só pelos números</button
				>
			{/if}
		{:else if searched}
			{plural(matches.length, 'ocorrência encontrada', 'ocorrências encontradas')}.
		{/if}
	</div>

	{#each GROUPS as group (group.kind)}
		{@const items = matches.flatMap((m, i) => (m.kind === group.kind ? [{ m, i }] : []))}
		{#if items.length}
			<section class="rounded-[var(--radius-card)] border border-line bg-surface p-4">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h3 class="text-sm font-semibold text-ink">{group.title} ({items.length})</h3>
					<div class="flex gap-3 text-xs">
						<button
							type="button"
							class="min-h-6 underline"
							onclick={() => setGroup(group.kind, true)}>Marcar todas</button
						>
						<button
							type="button"
							class="min-h-6 underline"
							onclick={() => setGroup(group.kind, false)}>Desmarcar todas</button
						>
					</div>
				</div>
				<p class="mt-1 text-xs text-muted">{group.help}</p>
				<ul class="mt-3 max-h-80 space-y-1 overflow-y-auto">
					{#each items as { m, i } (i)}
						<li>
							<label
								class="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-raised"
							>
								<input
									type="checkbox"
									class="mt-0.5 rounded border-line text-accent focus:ring-accent"
									checked={selected.has(i)}
									onchange={() => toggle(i)}
								/>
								<span class="min-w-0 text-sm">
									<span class="tabular text-xs text-muted">p. {m.page + 1}</span>
									<span class="text-muted">…{m.before}</span><mark
										class="rounded-sm bg-ink px-0.5 text-bg">{m.text}</mark
									><span class="text-muted">{m.after}…</span>
								</span>
							</label>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}

	<div class="space-y-2">
		<label class="flex items-center gap-3 text-sm text-ink">
			<input type="checkbox" class="rounded border-line" bind:checked={blackBoxes} />
			Desenhar tarjas pretas nos vazios
		</label>
		<label class="flex items-center gap-3 text-sm text-ink">
			<input type="checkbox" class="rounded border-line" bind:checked={removeImages} />
			Remover também as imagens atingidas
		</label>
	</div>

	<button
		type="button"
		class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
		disabled={busy || chosen.length === 0}
		onclick={redact}
	>
		{chosen.length
			? `Tarjar ${plural(chosen.length, 'ocorrência', 'ocorrências')}`
			: 'Marque o que tarjar'}
	</button>
</div>
