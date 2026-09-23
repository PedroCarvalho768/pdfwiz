<script lang="ts">
	import { resolve } from '$app/paths';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { SOURCE_URL } from '$lib/ui/site';

	let { children } = $props();

	/**
	 * A file dropped anywhere outside a drop zone makes the browser navigate
	 * to it, which throws away every open document and result. Swallow those
	 * drops page-wide. Drop zones call preventDefault first (they are deeper
	 * in the tree), so a dragover that reaches here unhandled is outside one
	 * and gets the "not allowed" cursor.
	 */
	function guardDrag(event: DragEvent) {
		if (!event.defaultPrevented && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
		event.preventDefault();
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window ondragover={guardDrag} ondrop={(event) => event.preventDefault()} />

<div class="flex min-h-[100dvh] flex-col">
	<a
		href="#conteudo"
		class="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-[var(--radius-control)] focus-visible:bg-accent focus-visible:px-4 focus-visible:py-2 focus-visible:font-medium focus-visible:text-accent-ink"
	>
		Pular para o conteúdo
	</a>
	<header class="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
		<nav class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
			<a
				href={resolve('/')}
				class="display text-xl text-ink"
				style="font-variation-settings: 'wdth' 118"
			>
				Aegis
			</a>
			<span class="flex items-center gap-2 text-sm text-muted">
				<!-- Not decoration: the dot reports a real state, that processing
				     is happening on this machine rather than on a server. -->
				<span class="inline-block size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
				Roda no seu dispositivo
			</span>
		</nav>
	</header>

	<main id="conteudo" class="flex-1 scroll-mt-20">
		{@render children()}
	</main>

	<footer class="border-t border-line bg-surface">
		<div class="mx-auto w-full max-w-6xl px-4 py-10 text-sm text-muted">
			<p class="max-w-[68ch]">
				O Aegis é software livre sob a
				<a
					class="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
					href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3</a
				>.
				<!--
					AGPL section 13 requires offering the source to anyone who uses
					the software over a network. This link is a licence obligation,
					not decoration. Do not remove it.
				-->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
					href={SOURCE_URL}>Veja o código-fonte</a
				><!-- eslint-enable svelte/no-navigation-without-resolve -->. Renderização de PDF por
				<a
					class="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
					href="https://mupdf.com/">MuPDF</a
				>, também sob AGPL.
			</p>
		</div>
	</footer>
</div>
