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
 *
 * Jobs run one at a time, in arrival order. A job yields between pages so
 * that `cancel` messages are seen, but a second job must not start in that
 * gap: two jobs interleaving on one document (render while merge, save while
 * stamp) would see each other's half-finished edits.
 * ponytail: single worker. Add a render-only pool if thumbnail latency on
 * 400+ page documents is actually felt.
 */
import type * as mupdf from 'mupdf';
import {
	CANCELLED_MESSAGE,
	UNKNOWN_HANDLE,
	type DocHandle,
	type WorkerIn,
	type WorkerOut
} from './contract';
import type { JobContext, JobName } from './jobs/index';

const post = (message: WorkerOut) => self.postMessage(message);

// Attached synchronously, before the engine import suspends anything.
const inbox: WorkerIn[] = [];
let deliver = (message: WorkerIn) => void inbox.push(message);
self.onmessage = (event: MessageEvent<WorkerIn>) => deliver(event.data);

const docs = new Map<DocHandle, mupdf.PDFDocument>();
const sizes = new Map<DocHandle, number>();
const cancelled = new Set<string>();
let nextHandle = 0;

/** Let queued messages (notably `cancel`) run before the next page. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function boot() {
	const { EngineError, handlers } = await import('./jobs/index');

	const contextFor = (id: string): JobContext => ({
		store(doc, byteLength) {
			const handle = `doc-${nextHandle++}`;
			docs.set(handle, doc);
			sizes.set(handle, byteLength);
			return handle;
		},
		get(handle) {
			const doc = docs.get(handle);
			if (!doc) throw new EngineError(UNKNOWN_HANDLE);
			return doc;
		},
		byteLength(handle) {
			this.get(handle);
			return sizes.get(handle) ?? 0;
		},
		drop(handle) {
			docs.get(handle)?.destroy();
			docs.delete(handle);
			sizes.delete(handle);
		},
		emit: (chunk) => post({ kind: 'chunk', id, chunk }),
		report: (progress) => post({ kind: 'progress', id, progress }),
		yield: breathe,
		checkCancelled() {
			if (cancelled.has(id)) throw new EngineError(CANCELLED_MESSAGE, 'CANCELLED');
		}
	});

	async function run(message: Extract<WorkerIn, { kind: 'job' }>) {
		const { id, name, params } = message;
		const context = contextFor(id);
		try {
			// Cancelled while it waited in the queue.
			context.checkCancelled();
			const job = handlers[name as JobName] as
				((ctx: JobContext, params: unknown) => unknown) | undefined;
			if (!job) {
				console.error(`Unknown engine job "${name}"`);
				throw new EngineError(
					'Esta operação não existe nesta versão do site. Recarregue a página.'
				);
			}

			const result = await job(context, params);
			// ponytail: results are structured-cloned rather than transferred. A
			// memcpy of a thumbnail is free; revisit if huge outputs show up in
			// a profile.
			post({ kind: 'done', id, result });
		} catch (err) {
			if (err instanceof EngineError) {
				post({ kind: 'error', id, message: err.message, code: err.code });
			} else {
				// A raw MuPDF or runtime error: English, and meant for us. Log
				// it whole, and still tell the user what happened.
				console.error(`Engine job "${name}" failed`, err);
				const detail = (err as Error)?.message ?? String(err);
				post({
					kind: 'error',
					id,
					message: `Não foi possível concluir a operação. Detalhe técnico: ${detail}`,
					code: 'ENGINE_INTERNAL'
				});
			}
		} finally {
			cancelled.delete(id);
		}
	}

	// Cancels act at once; jobs wait their turn. `run` never rejects, so one
	// failing job cannot stall the queue.
	let queue = Promise.resolve();
	deliver = (message) => {
		if (message.kind === 'cancel') cancelled.add(message.id);
		else queue = queue.then(() => run(message));
	};
	for (const queued of inbox.splice(0)) deliver(queued);
}

boot().catch((err) => {
	// The engine never came up, so no job can ever succeed. Say so loudly
	// rather than leaving every caller hanging on a promise that cannot settle.
	console.error('The PDF engine failed to start', err);
	const message = 'Não foi possível iniciar o processamento de PDF. Recarregue a página.';
	deliver = (queued) => {
		if (queued.kind === 'job') post({ kind: 'error', id: queued.id, message, code: 'ENGINE_BOOT' });
	};
	for (const queued of inbox.splice(0)) deliver(queued);
});
