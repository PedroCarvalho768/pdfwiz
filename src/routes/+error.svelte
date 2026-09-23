<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Página não encontrada' : 'Algo deu errado'} | PDFWiz</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<article class="mx-auto w-full max-w-3xl px-4 py-16">
	<h1 class="display text-[clamp(2rem,4.5vw,3.25rem)]">
		{page.status === 404 ? 'Página não encontrada' : 'Algo deu errado'}
	</h1>
	<p class="mt-4 max-w-[60ch] text-lg text-muted">
		{page.status === 404
			? 'Este endereço não corresponde a nenhuma ferramenta.'
			: (page.error?.message ?? 'Erro inesperado.')}
	</p>
	<p class="mt-8">
		<a
			class="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-medium text-accent-ink hover:brightness-110"
			href={resolve('/')}
		>
			Ver todas as ferramentas
		</a>
	</p>
</article>
