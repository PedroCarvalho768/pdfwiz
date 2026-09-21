/**
 * Message shim around `jobs.ts`. This file holds no PDF logic on purpose —
 * everything worth testing lives in the handlers, which run fine in Node.
 *
 * `jobs.ts` is imported *dynamically*, and that is load-bearing. MuPDF
 * instantiates its WASM with a top-level await, so a static import would
 * suspend this module's evaluation until the ~10 MB binary finished loading
 * — and `self.onmessage` would only be assigned after that. Any job posted in
 * the meantime fires with no listener attached and is silently lost, leaving
 * the caller's promise pending forever. So: attach the listener
 * synchronously, queue what arrives, then drain once the engine is up.
 *
 * One worker, not a pool: MuPDF is synchronous C, but jobs yield between
 * pages and stream partial results, so the UI never waits on a whole
 * document. OCR runs in its own worker, so nothing long-running shares this
 * thread.
 * ponytail: single worker. Add a render-only pool if thumbnail latency on
 * 400+ page documents is actually felt.
 */
import type * as mupdf from 'mupdf';
import type { DocHandle, WorkerIn, WorkerOut } from './contract';
import type { JobContext, JobName } from './jobs/index';

const post = (message: WorkerOut) => self.postMessage(message);

// Attached synchronously, before the engine import suspends anything.
const inbox: WorkerIn[] = [];
let deliver = (message: WorkerIn) => void inbox.push(message);
self.onmessage = (event: MessageEvent<WorkerIn>) => deliver(event.data);

const docs = new Map<DocHandle, mupdf.PDFDocument>();
const cancelled = new Set<string>();
let nextHandle = 0;

/** Let queued messages (notably `cancel`) run before the next page. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function boot() {
	const { EngineError, handlers } = await import('./jobs/index');

	const contextFor = (id: string): JobContext => ({
		store(doc) {
			const handle = `doc-${nextHandle++}`;
			docs.set(handle, doc);
			return handle;
		},
		get(handle) {
			const doc = docs.get(handle);
			if (!doc) throw new EngineError(`Unknown document handle ${handle}`);
			return doc;
		},
		drop(handle) {
			docs.get(handle)?.destroy();
			docs.delete(handle);
		},
		emit: (chunk) => post({ kind: 'chunk', id, chunk }),
		report: (progress) => post({ kind: 'progress', id, progress }),
		yield: breathe,
		checkCancelled() {
			if (cancelled.has(id)) throw new EngineError('Cancelled', 'CANCELLED');
		}
	});

	async function handle(message: WorkerIn) {
		if (message.kind === 'cancel') {
			cancelled.add(message.id);
			return;
		}

		const { id, name, params } = message;
		try {
			const job = handlers[name as JobName] as
				((ctx: JobContext, params: unknown) => unknown) | undefined;
			if (!job) throw new EngineError(`Unknown job "${name}"`);

			const result = await job(contextFor(id), params);
			// ponytail: results are structured-cloned rather than transferred. A
			// memcpy of a thumbnail is free; revisit if huge outputs show up in
			// a profile.
			post({ kind: 'done', id, result });
		} catch (err) {
			const error = err as { message?: string; code?: string };
			post({ kind: 'error', id, message: error.message ?? String(err), code: error.code });
		} finally {
			cancelled.delete(id);
		}
	}

	deliver = (message) => void handle(message);
	for (const queued of inbox.splice(0)) deliver(queued);
}

boot().catch((err) => {
	// The engine never came up, so no job can ever succeed. Say so loudly
	// rather than leaving every caller hanging on a promise that cannot settle.
	const message = `The PDF engine failed to start: ${(err as Error).message ?? err}`;
	deliver = (queued) => {
		if (queued.kind === 'job') post({ kind: 'error', id: queued.id, message, code: 'ENGINE_BOOT' });
	};
	for (const queued of inbox.splice(0)) deliver(queued);
});
