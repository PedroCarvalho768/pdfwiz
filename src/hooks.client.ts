import type { HandleClientError } from '@sveltejs/kit';

/**
 * Replaces SvelteKit's bare "Internal Error" with something a reader can act
 * on. A stale chunk after a redeploy never gets here: SvelteKit checks
 * version.json and falls back to a full page load on its own. What remains is
 * mostly a chunk that cannot be fetched at all, i.e. the connection is gone.
 */
const isChunkLoadError = (error: unknown) =>
	error instanceof Error &&
	/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(
		error.message
	);

export const handleError: HandleClientError = ({ error }) => {
	if (isChunkLoadError(error))
		return {
			message: 'Não foi possível carregar esta página. Verifique a conexão e recarregue.'
		};
	console.error(error);
	return { message: 'Ocorreu um erro inesperado nesta página. Recarregue para tentar de novo.' };
};
