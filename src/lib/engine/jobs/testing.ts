/**
 * Test harness for the job suite. Not shipped — only imported by `*.spec.ts`.
 *
 * Fixtures are built with `DocumentWriter` rather than through the handlers,
 * so a broken handler fails its own test instead of every other one.
 */
import * as mupdf from 'mupdf';
import { CANCELLED_MESSAGE, EngineError, UNKNOWN_HANDLE, type DocHandle } from '../contract';
import type { JobContext } from '../shared';
import { handlers } from './index';

const encode = (s: string) => new TextEncoder().encode(s);

export function testContext() {
	const docs = new Map<DocHandle, mupdf.PDFDocument>();
	const chunks: unknown[] = [];
	const progress: { done: number; total: number }[] = [];
	const labels: string[] = [];
	const sizes = new Map<DocHandle, number>();
	let cancelled = false;
	let next = 0;

	const ctx: JobContext = {
		store(doc, byteLength) {
			const handle = `doc-${next++}`;
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
			ctx.get(handle);
			return sizes.get(handle) ?? 0;
		},
		drop(handle) {
			docs.get(handle)?.destroy();
			docs.delete(handle);
			sizes.delete(handle);
		},
		emit: (chunk) => void chunks.push(chunk),
		report: (p) => {
			progress.push({ done: p.done, total: p.total });
			if (p.label) labels.push(p.label);
		},
		yield: async () => {},
		checkCancelled() {
			if (cancelled) throw new EngineError(CANCELLED_MESSAGE, 'CANCELLED');
		}
	};

	return { ctx, chunks, progress, labels, cancel: () => (cancelled = true) };
}

/** A PDF with exactly one page per marker, each carrying findable text. */
export function multiPagePdf(markers: string[]): Uint8Array {
	const buffer = new mupdf.Buffer();
	const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
	for (const marker of markers) {
		// Trailing newline matters: MuPDF's markdown parser drops the last
		// character without it. See normaliseInput() in shared.ts.
		const src = mupdf.Document.openDocument(encode(`# ${marker}\n`), 'text/markdown');
		for (let i = 0; i < src.countPages(); i++) {
			const page = src.loadPage(i);
			const device = writer.beginPage(page.getBounds());
			page.run(device, mupdf.Matrix.identity);
			device.close();
			writer.endPage();
		}
	}
	writer.close();
	return buffer.asUint8Array().slice();
}

export const fixture = (ctx: JobContext, markers: string[]) =>
	handlers.open(ctx, { bytes: multiPagePdf(markers), magic: 'application/pdf' });

export const openBytes = (bytes: Uint8Array) =>
	mupdf.Document.openDocument(bytes, 'application/pdf');

export const textOf = (bytes: Uint8Array, page: number) =>
	openBytes(bytes).loadPage(page).toStructuredText('').asText();

export const pageCountOf = (bytes: Uint8Array) => openBytes(bytes).countPages();
