/**
 * Every page prerenders to static HTML at build time. The tool pages carry
 * real content in their markup — that is how this category gets found in
 * search, and there is no server at runtime to render it later.
 *
 * SSR stays on. Nothing in the app touches the browser at module scope: the
 * engine worker is constructed lazily inside `ensureWorker()`, on the first
 * job, which only ever happens after a user drops a file.
 */
export const prerender = true;
