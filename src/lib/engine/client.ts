/**
 * Main-thread handle on the engine worker.
 *
 * The worker — and the ~3.6 MB brotli-compressed MuPDF WASM behind it — is
 * created on first use, never at import time. Nothing should touch the engine
 * until the user actually hands us a file.
 */
import {
	CANCELLED_MESSAGE,
	type DocInfo,
	type Progress,
	type WorkerIn,
	type WorkerOut
} from './contract';
import type { JobName, JobParams, JobResult } from './jobs/index';

export interface RunOptions<Chunk> {
	onChunk?: (chunk: Chunk) => void;
	onProgress?: (progress: Progress) => void;
	signal?: AbortSignal;
	/**
	 * Buffers to move into the worker instead of copying. They are detached
	 * here afterwards, so pass only bytes the caller no longer reads.
	 */
	transfer?: Transferable[];
}

export class EngineFailure extends Error {
	constructor(
		message: string,
		readonly code?: string
	) {
		super(message);
		this.name = 'EngineFailure';
	}
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onChunk?: (chunk: never) => void;
	onProgress?: (progress: Progress) => void;
}

let worker: Worker | undefined;
const pending = new Map<string, Pending>();
let nextId = 0;

function ensureWorker(): Worker {
	if (worker) return worker;

	worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

	worker.onmessage = (event: MessageEvent<WorkerOut>) => {
		const message = event.data;
		const entry = pending.get(message.id);
		if (!entry) return;

		switch (message.kind) {
			case 'progress':
				entry.onProgress?.(message.progress);
				break;
			case 'chunk':
				entry.onChunk?.(message.chunk as never);
				break;
			case 'done':
				pending.delete(message.id);
				entry.resolve(message.result);
				break;
			case 'error':
				pending.delete(message.id);
				entry.reject(new EngineFailure(message.message, message.code));
				break;
		}
	};

	// A worker-level error leaves every in-flight job unresolvable, so fail
	// them loudly rather than hanging the UI forever, and drop the dead
	// worker so the next run() starts a fresh one.
	const self = worker;
	self.onerror = (event) => {
		console.error('PDF engine worker error', event.message, event);
		if (worker === self) worker = undefined;
		self.terminate();
		const failure = new EngineFailure(
			'O processamento de PDF parou inesperadamente. Tente de novo.',
			'ENGINE_CRASHED'
		);
		for (const [id, entry] of pending) {
			pending.delete(id);
			entry.reject(failure);
		}
	};

	return worker;
}

/** Run a job in the engine worker. Types flow from the handler definitions. */
export function run<N extends JobName>(
	name: N,
	params: JobParams<N>,
	options: RunOptions<unknown> = {}
): Promise<JobResult<N>> {
	const target = ensureWorker();
	const id = `job-${nextId++}`;

	return new Promise<JobResult<N>>((resolve, reject) => {
		const { signal } = options;
		if (signal?.aborted) {
			reject(new EngineFailure(CANCELLED_MESSAGE, 'CANCELLED'));
			return;
		}

		const onAbort = () => target.postMessage({ kind: 'cancel', id } satisfies WorkerIn);
		// Settling removes the listener, so a long-lived signal does not
		// accumulate one per job or send cancels for jobs long finished.
		const settle =
			<A extends unknown[]>(fn: (...args: A) => void) =>
			(...args: A) => {
				signal?.removeEventListener('abort', onAbort);
				fn(...args);
			};

		pending.set(id, {
			resolve: settle(resolve as (value: unknown) => void),
			reject: settle(reject),
			onChunk: options.onChunk as ((chunk: never) => void) | undefined,
			onProgress: options.onProgress
		});
		signal?.addEventListener('abort', onAbort, { once: true });

		try {
			target.postMessage(
				{ kind: 'job', id, name, params } satisfies WorkerIn,
				options.transfer ?? []
			);
		} catch (err) {
			// Almost always a Svelte $state proxy: reactive objects cannot be
			// structured-cloned. Hold worker results in $state.raw and pass
			// plain values here. The detail is for developers; users get a
			// message they can act on.
			console.error(
				`Could not send "${name}" to the engine: its parameters are not cloneable. ` +
					'Use $state.raw for values that come back from the worker.',
				err
			);
			pending
				.get(id)
				?.reject(
					new EngineFailure(
						'Não foi possível enviar os dados para o processamento. Recarregue a página e tente de novo.',
						'NOT_CLONEABLE'
					)
				);
			pending.delete(id);
		}
	});
}

/**
 * Tear the worker down, freeing its WASM heap and every cached document.
 * This is also the cancel path of last resort for a job stuck in sync C code.
 */
export function shutdown(): void {
	worker?.terminate();
	worker = undefined;
	const failure = new EngineFailure('O processamento foi interrompido', 'CANCELLED');
	for (const [id, entry] of pending) {
		pending.delete(id);
		entry.reject(failure);
	}
}

/** Map a browser File to the MIME type MuPDF should parse it as. */
export function magicFor(file: File): string {
	const extension = file.name.toLowerCase().split('.').pop() ?? '';
	const byExtension: Record<string, string> = {
		pdf: 'application/pdf',
		md: 'text/markdown',
		markdown: 'text/markdown',
		txt: 'text/plain',
		html: 'text/html',
		htm: 'text/html',
		xhtml: 'application/xhtml+xml',
		epub: 'application/epub+zip',
		mobi: 'application/x-mobipocket-ebook',
		fb2: 'application/x-fictionbook',
		cbz: 'application/vnd.comicbook+zip',
		xps: 'application/vnd.ms-xpsdocument',
		svg: 'image/svg+xml',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		bmp: 'image/bmp',
		webp: 'image/webp',
		tif: 'image/tiff',
		tiff: 'image/tiff'
	};
	// `||`, not `??`: an unknown type is the empty string, not undefined.
	return byExtension[extension] || file.type || 'application/pdf';
}

/** Read a File and open it in the engine. */
export async function openFile(file: File, password?: string): Promise<DocInfo> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	// A large scan would otherwise exist twice in memory, once on each side.
	return run('open', { bytes, magic: magicFor(file), password }, { transfer: [bytes.buffer] });
}
