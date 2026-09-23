/**
 * The single seam between the UI and the PDF engine.
 *
 * Nothing outside `src/lib/engine` may import `mupdf`. The UI speaks only in
 * the types below, which is what keeps every job handler unit-testable in
 * plain Node and the engine itself replaceable.
 */

/** Opaque reference to a document parsed and cached inside the worker. */
export type DocHandle = string;

export interface PageInfo {
	index: number;
	/** Page box in PDF points, already accounting for /Rotate. */
	width: number;
	height: number;
	/** Clockwise degrees: 0, 90, 180 or 270. */
	rotation: number;
}

export interface DocInfo {
	handle: DocHandle;
	pageCount: number;
	pages: PageInfo[];
	title: string;
	author: string;
	/** True when the file was encrypted, even if we successfully authenticated. */
	encrypted: boolean;
	byteLength: number;
}

export interface OutputFile {
	filename: string;
	mime: string;
	bytes: Uint8Array;
}

export interface Progress {
	done: number;
	total: number;
	label?: string;
}

/** A single rendered page, streamed as it finishes rather than batched. */
export interface RenderedPage {
	index: number;
	png: Uint8Array;
	width: number;
	height: number;
}

/** Thrown by the engine when a document needs a password we do not have. */
export const PASSWORD_REQUIRED = 'PASSWORD_REQUIRED';

/** User-visible messages shared by the worker, the client and the test harness. */
export const CANCELLED_MESSAGE = 'Operação cancelada';
export const UNKNOWN_HANDLE = 'Documento não encontrado. Abra o arquivo novamente.';

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export type WorkerIn =
	{ kind: 'job'; id: string; name: string; params: unknown } | { kind: 'cancel'; id: string };

export type WorkerOut =
	| { kind: 'progress'; id: string; progress: Progress }
	| { kind: 'chunk'; id: string; chunk: unknown }
	| { kind: 'done'; id: string; result: unknown }
	| { kind: 'error'; id: string; message: string; code?: string };

/** Any failure originating inside the engine, carrying a machine-readable code. */
export class EngineError extends Error {
	constructor(
		message: string,
		readonly code?: string
	) {
		super(message);
		this.name = 'EngineError';
	}
}
