<script lang="ts">
	import { resolve } from '$app/paths';
	import LocalProof from '$lib/ui/LocalProof.svelte';
	import { groups, inGroup, searchTools, tools } from '$lib/tools/registry';

	let query = $state('');
	const matches = $derived(searchTools(query));
	const filtering = $derived(query.trim().length > 0);
</script>

<svelte:head>
	<title>PDFWiz, {tools.length} ferramentas de PDF que não sobem seu arquivo</title>
	<meta
		name="description"
		content="Junte, divida, edite, converta, comprima, assine, tarje e tire a senha de PDFs de graça. Cada arquivo é processado no seu próprio dispositivo. Nada é enviado."
	/>
</svelte:head>

<!-- Hero. One asymmetric split: the claim on the left, the proof of it on
     the right. The panel is the only place on the page that goes dark. -->
<section
	class="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-14 pb-20 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14 lg:pt-20"
>
	<div>
		<h1 class="display text-[clamp(2.5rem,5.4vw,4.25rem)]">Seu PDF não sai desta aba.</h1>
		<p class="mt-6 max-w-[46ch] text-lg text-muted">
			{tools.length} ferramentas que rodam dentro do seu navegador. Sem upload, sem conta, sem servidor
			que possa guardar uma cópia.
		</p>
		<div class="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
			<a
				href="#tools"
				class="rounded-[var(--radius-control)] bg-accent px-6 py-3 font-medium text-accent-ink transition-transform duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
			>
				Achar uma ferramenta
			</a>
			<a
				href="https://github.com/PedroCarvalho768/pdfwiz"
				class="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
			>
				Ver o código
			</a>
		</div>
	</div>

	<LocalProof />
</section>

<!-- Why it is built this way. Prose, not cards: three equal feature cards is
     the category default and says less than four sentences. -->
<section class="border-y border-line bg-surface">
	<div class="mx-auto w-full max-w-6xl px-4 py-16 lg:py-24">
		<h2 class="display max-w-[20ch] text-[clamp(1.85rem,3.4vw,2.9rem)]">
			Todo outro site de PDF sobe o seu arquivo para poder editá-lo.
		</h2>
		<div class="mt-8 grid gap-x-14 gap-y-4 text-muted md:grid-cols-2">
			<p class="max-w-[62ch]">
				Um contrato, um holerite, a cópia do seu passaporte. Para juntar duas páginas, as
				ferramentas de sempre precisam de uma cópia nos servidores delas, e você fica com a promessa
				de que ela será apagada depois.
			</p>
			<p class="max-w-[62ch]">
				O PDFWiz não tem servidor nenhum para onde mandar. O motor inteiro, um build de
				<span class="font-medium text-ink">3,6 MB</span> do
				<a
					class="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
					href="https://mupdf.com/">MuPDF</a
				>, é baixado uma vez e roda num worker na sua máquina. O site são arquivos estáticos numa
				CDN. É também por isso que ele é gratuito e continua gratuito: ninguém está pagando por
				processamento, então não há nada a recuperar.
			</p>
		</div>
	</div>
</section>

<!-- The index. 52 tools want a dense, scannable list, not 52 identical
     cards: the card grid is what this category does and it makes finding a
     named tool slower, not faster. -->
<section id="tools" class="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 lg:py-24">
	<div class="flex flex-wrap items-end justify-between gap-6">
		<h2 class="display text-[clamp(1.75rem,3vw,2.5rem)]">Todas as {tools.length} ferramentas</h2>

		<label class="w-full max-w-sm">
			<span class="sr-only">Buscar ferramentas</span>
			<input
				type="search"
				name="busca"
				autocomplete="off"
				placeholder="juntar, comprimir, senha, converter"
				class="w-full rounded-[var(--radius-control)] border-line bg-surface px-4 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent"
				bind:value={query}
			/>
		</label>
	</div>

	{#snippet row(tool: (typeof tools)[number])}
		<li>
			<a
				href={resolve('/[tool]', { tool: tool.id })}
				class="group flex items-baseline gap-3 border-b border-line py-2.5 transition-colors hover:border-accent"
			>
				<span class="font-medium text-ink group-hover:text-accent">{tool.title}</span>
				<span class="min-w-0 flex-1 truncate text-sm text-muted">{tool.blurb}</span>
			</a>
		</li>
	{/snippet}

	{#if filtering}
		{#if matches.length === 0}
			<p class="mt-10 text-muted">
				Nada encontrado para “{query}”. Limpe a busca para ver as {tools.length} ferramentas.
			</p>
		{:else}
			<ul class="mt-10 columns-1 gap-x-12 md:columns-2">
				{#each matches as tool (tool.id)}
					{@render row(tool)}
				{/each}
			</ul>
		{/if}
	{:else}
		<!-- Multi-column, not a 2-col grid: the groups are wildly different
		     lengths, and a grid leaves a dead gap under the short ones. Columns
		     balance the flow automatically. -->
		<div class="mt-10 gap-x-12 md:columns-2">
			{#each groups() as group (group)}
				<section class="mb-9 inline-block w-full min-w-0 break-inside-avoid align-top">
					<h3 class="text-sm font-semibold text-accent">{group}</h3>
					<ul class="mt-2">
						{#each inGroup(group) as tool (tool.id)}
							{@render row(tool)}
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</section>
