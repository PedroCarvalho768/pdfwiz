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
			adapter: adapter(),
			// Prerendered pages carry this as a <meta http-equiv> tag, with
			// hashes for SvelteKit's inline bootstrap script. It is what turns
			// "nothing leaves your device" from a claim into a browser-enforced
			// rule: the page cannot connect anywhere but this origin and the
			// OCR language models.
			//
			// A meta policy governs the document only. Workers loaded from a
			// URL (MuPDF, Tesseract) get their policy from their own response
			// headers, so the host should send the same policy as a header to
			// cover them; 'wasm-unsafe-eval' is listed for that case.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'wasm-unsafe-eval'],
					// Svelte renders style="" attributes (the hero fan, rotations).
					'style-src': ['self', 'unsafe-inline'],
					// Thumbnails are blob: URLs; @tailwindcss/forms draws its
					// select chevron and checkmarks as data: SVGs.
					'img-src': ['self', 'blob:', 'data:'],
					// Vite inlines the smallest @fontsource subsets as data: URLs.
					'font-src': ['self', 'data:'],
					// The only third-party request in the app: OCR language
					// models, scoped to their path. See OcrTool.svelte.
					'connect-src': ['self', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/'],
					'worker-src': ['self', 'blob:'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['none']
				}
			}
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
