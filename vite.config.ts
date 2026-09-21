import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// MuPDF ships one ESM build for both Node and the browser. Two consequences
// for bundling, both in `mupdf/dist/mupdf.js`:
//
//  1. It instantiates the WASM module with a top-level await, so the build
//     target must support TLA.
//  2. It does `await import("node:fs")` behind a `process.versions.node`
//     guard. The guard means the browser never evaluates it, but the bundler
//     still tries to resolve it — so mark it external and leave it alone.
const NODE_ONLY = ['node:fs'];

export default defineConfig({
	build: { target: 'esnext', rollupOptions: { external: NODE_ONLY } },
	worker: { format: 'es', rollupOptions: { external: NODE_ONLY } },
	// Pre-bundling a 10 MB WASM payload helps nobody; the worker loads it lazily.
	optimizeDeps: { exclude: ['mupdf'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
