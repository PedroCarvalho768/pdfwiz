<script lang="ts">
	import { resolve } from '$app/paths';
	import LocalProof from '$lib/ui/LocalProof.svelte';
	import { groups, inGroup, searchTools, tools } from '$lib/tools/registry';
	import { SITE_URL, SOURCE_URL } from '$lib/ui/site';
	import { version } from '../../package.json';

	const title = `Kyme PDF: ${tools.length} ferramentas que rodam no seu navegador`;
	const description =
		'Software livre (AGPL) para juntar, dividir, editar, converter, comprimir, tarjar e proteger PDFs. O MuPDF roda compilado para WebAssembly na sua aba; nenhum arquivo é enviado.';

	let query = $state('');
	const matches = $derived(searchTools(query));
	const filtering = $derived(query.trim().length > 0);

	/** Stated plainly, the same ceilings the README lists. */
	const LIMITS = [
		'Editar texto não reflui o parágrafo: a linha é redesenhada numa fonte padrão no mesmo lugar.',
		'Word e Excel passam por HTML: a estrutura sobrevive, o layout exato não.',
		'PDF para Word reconstrói parágrafos a partir do texto; tabelas, colunas e imagens não voltam.',
		'Assinar põe uma imagem na página. Não é assinatura criptográfica.',
		'Tons de cinza e achatar em imagens rasterizam a página e apagam a camada de texto.',
		'O OCR baixa o modelo do idioma do cdn.jsdelivr.net no primeiro uso. O documento continua aqui.'
	];

	const heading = 'font-mono text-sm font-semibold text-ink';
	const indent = 'mt-3 pl-4 sm:pl-8';
	const link = 'text-ink underline decoration-line underline-offset-4 hover:decoration-accent';
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href="{SITE_URL}/" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content="{SITE_URL}/" />
</svelte:head>

<!-- Laid out as a man page: the project describes itself the way a tool
     does, section by section, instead of pitching. The one live element is
     the drop panel under SINOPSE, because the claim is only worth making if
     the page can demonstrate it. -->
<div class="mx-auto w-full max-w-4xl px-4 pt-10 pb-20 lg:pt-14">
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<p
		class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-3 font-mono text-sm text-muted"
	>
		<span class="text-ink">kyme(1)</span>
		<span>
			v{version} · AGPL-3.0 ·
			<a class={link} href={SOURCE_URL}>código-fonte</a>
		</span>
	</p>

	<section class="mt-10" aria-labelledby="nome">
		<h2 id="nome" class={heading}>NOME</h2>
		<h1 class="{indent} text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold text-ink">
			kyme <span class="text-muted">·</span>
			{tools.length} ferramentas de PDF que rodam na sua aba
		</h1>
	</section>

	<section class="mt-10" aria-labelledby="sinopse">
		<h2 id="sinopse" class={heading}>SINOPSE</h2>
		<p class="{indent} font-mono text-sm text-muted">
			<span class="text-ink">seu arquivo</span> → MuPDF (WebAssembly, num worker) →
			<span class="text-ink">resultado para baixar</span>
		</p>
		<p class="{indent} max-w-[62ch] text-muted">
			Não existe servidor para receber o arquivo, então nada é enviado. Solte um PDF abaixo: as
			páginas são desenhadas aqui mesmo e os números vêm dessa execução, inclusive o tráfego de
			rede.
		</p>
		<div class="{indent} max-w-3xl">
			<LocalProof />
		</div>
	</section>

	<section class="mt-12" aria-labelledby="descricao">
		<h2 id="descricao" class={heading}>DESCRIÇÃO</h2>
		<div class="{indent} max-w-[66ch] space-y-4 text-muted">
			<p>
				Quase todo o trabalho é do <a class={link} href="https://mupdf.com/">MuPDF</a>: juntar,
				desenhar páginas, extrair texto, tarjar de verdade, formulários, criptografia, compressão e
				reparo. O build de <span class="tabular text-ink">3,6 MB</span> é baixado uma vez, na primeira
				vez que você solta um arquivo, e roda num worker na sua máquina.
			</p>
			<p>
				O site é só arquivos estáticos. Não há conta, rastreio nem banco de dados, e a política de
				segurança da página só permite conexões com o próprio site e, no OCR, com o servidor do
				modelo de idioma.
			</p>
		</div>
	</section>

	<section class="mt-12" aria-labelledby="limites">
		<h2 id="limites" class={heading}>LIMITES</h2>
		<ul class="{indent} max-w-[66ch] space-y-2 text-muted">
			{#each LIMITS as limit (limit)}
				<li class="flex gap-3">
					<span class="font-mono text-muted select-none" aria-hidden="true">-</span>
					<span>{limit}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section id="tools" class="mt-12 scroll-mt-20" aria-labelledby="ferramentas">
		<div class="flex flex-wrap items-baseline justify-between gap-4">
			<h2 id="ferramentas" class={heading}>FERRAMENTAS ({tools.length})</h2>
			<label class="w-full max-w-xs">
				<span class="sr-only">Buscar ferramentas</span>
				<input
					type="search"
					name="busca"
					autocomplete="off"
					placeholder="juntar, comprimir, senha…"
					class="w-full rounded-[var(--radius-control)] border-line bg-surface px-3 py-2 font-mono text-sm text-ink placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent"
					bind:value={query}
				/>
			</label>
		</div>

		{#snippet row(tool: (typeof tools)[number])}
			<li>
				<a
					href={resolve('/[tool]', { tool: tool.id })}
					class="group flex items-baseline gap-3 border-b border-line py-2 transition-colors hover:border-accent"
				>
					<span class="font-medium text-ink group-hover:text-accent">{tool.title}</span>
					<span class="min-w-0 flex-1 truncate text-sm text-muted">{tool.blurb}</span>
				</a>
			</li>
		{/snippet}

		<div class={indent}>
			{#if filtering}
				{#if matches.length === 0}
					<p class="text-muted">
						Nada encontrado para “{query}”. Limpe a busca para ver as {tools.length} ferramentas.
					</p>
				{:else}
					<ul class="columns-1 gap-x-12 md:columns-2">
						{#each matches as tool (tool.id)}
							{@render row(tool)}
						{/each}
					</ul>
				{/if}
			{:else}
				<!-- Columns, not a grid: the groups differ wildly in length and
				     columns balance the flow without dead gaps. -->
				<div class="gap-x-12 md:columns-2">
					{#each groups() as group (group)}
						<section class="mb-8 inline-block w-full min-w-0 break-inside-avoid align-top">
							<h3 class="font-mono text-sm text-accent">{group.toLowerCase()}</h3>
							<ul class="mt-1">
								{#each inGroup(group) as tool (tool.id)}
									{@render row(tool)}
								{/each}
							</ul>
						</section>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<section class="mt-12" aria-labelledby="codigo">
		<h2 id="codigo" class={heading}>CÓDIGO</h2>
		<p class="{indent} max-w-[66ch] text-muted">
			Software livre sob a <a class={link} href="https://www.gnu.org/licenses/agpl-3.0.html"
				>GNU AGPL v3 ou posterior</a
			>, porque o MuPDF também é AGPL. O código está em
			<a class={link} href={SOURCE_URL}>{SOURCE_URL.replace('https://', '')}</a>; bugs e ideias vão
			nas <a class={link} href="{SOURCE_URL}/issues">issues</a>.
		</p>
	</section>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
