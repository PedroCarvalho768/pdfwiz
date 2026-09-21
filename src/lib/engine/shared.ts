/**
 * Internals shared by every job module. Engine-only: this file imports
 * `mupdf`, so nothing outside `src/lib/engine` may import it.
 */
import * as mupdf from 'mupdf';
import {
	EngineError,
	type DocHandle,
	type DocInfo,
	type OutputFile,
	type PageInfo,
	type Progress
} from './contract';

export interface JobContext {
	/** Cache a parsed document under a new handle. */
	store(doc: mupdf.PDFDocument, byteLength: number): DocHandle;
	/** Look up a previously opened document; throws if the handle is unknown. */
	get(handle: DocHandle): mupdf.PDFDocument;
	drop(handle: DocHandle): void;
	/** Stream a partial result to the UI before the job finishes. */
	emit(chunk: unknown): void;
	report(progress: Progress): void;
	/** Hand control back to the event loop so cancel messages are seen. */
	yield(): Promise<void>;
	/** Throws if the job was cancelled; call inside long loops. */
	checkCancelled(): void;
}

/** Normalise MuPDF's /Rotate, which may be absent, negative or over 360. */
export function pageRotation(page: mupdf.PDFPage): number {
	const raw = page.getObject().get('Rotate');
	const deg = raw && !raw.isNull() ? raw.asNumber() : 0;
	return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

export function setPageRotation(doc: mupdf.PDFDocument, page: mupdf.PDFPage, degrees: number) {
	page.getObject().put('Rotate', doc.newInteger(((degrees % 360) + 360) % 360));
}

export function describePage(page: mupdf.PDFPage, index: number): PageInfo {
	const [x0, y0, x1, y1] = page.getBounds();
	return {
		index,
		width: Math.abs(x1 - x0),
		height: Math.abs(y1 - y0),
		rotation: pageRotation(page)
	};
}

export function describe(doc: mupdf.PDFDocument, handle: DocHandle, byteLength: number): DocInfo {
	const pages: PageInfo[] = [];
	for (let i = 0; i < doc.countPages(); i++) pages.push(describePage(doc.loadPage(i), i));
	return {
		handle,
		pageCount: pages.length,
		pages,
		title: doc.getMetaData('info:Title') ?? '',
		author: doc.getMetaData('info:Author') ?? '',
		encrypted: (doc.getMetaData('encryption') ?? 'None') !== 'None',
		byteLength
	};
}

/**
 * Baseline save flags. `garbage=compact` drops orphaned objects and `compress`
 * deflates streams; without both, an edited file grows on every round trip.
 */
export const SAVE_CLEAN = 'garbage=compact,compress';

export function toOutput(
	doc: mupdf.PDFDocument,
	filename: string,
	options = SAVE_CLEAN
): OutputFile {
	return { filename, mime: 'application/pdf', bytes: doc.saveToBuffer(options).asUint8Array() };
}

export const allPages = (doc: mupdf.PDFDocument) =>
	Array.from({ length: doc.countPages() }, (_, i) => i);

/** Resolve an optional page selection to concrete indices, defaulting to all. */
export function pagesOf(doc: mupdf.PDFDocument, pages?: number[]): number[] {
	if (!pages) return allPages(doc);
	const count = doc.countPages();
	const bad = pages.find((i) => !Number.isInteger(i) || i < 0 || i >= count);
	if (bad !== undefined) throw new EngineError(`A página ${bad + 1} está fora do intervalo`);
	return pages;
}

const NEWLINE = 0x0a;

/**
 * MuPDF 1.28's markdown parser drops the final character of the input when
 * the buffer does not end in a newline ("# Three" renders as "Thre"), so
 * normalise it here — the one place every file enters the engine.
 */
export function normaliseInput(bytes: Uint8Array, magic: string): Uint8Array {
	if (!magic.includes('markdown')) return bytes;
	if (bytes.length > 0 && bytes[bytes.length - 1] === NEWLINE) return bytes;
	const padded = new Uint8Array(bytes.length + 1);
	padded.set(bytes);
	padded[bytes.length] = NEWLINE;
	return padded;
}

/** Lay any MuPDF-readable document out into a real PDF object model. */
export function toPdfDocument(input: mupdf.Document): mupdf.PDFDocument {
	const buffer = new mupdf.Buffer();
	const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
	for (let i = 0; i < input.countPages(); i++) {
		const page = input.loadPage(i);
		const device = writer.beginPage(page.getBounds());
		page.run(device, mupdf.Matrix.identity);
		device.close();
		writer.endPage();
	}
	writer.close();
	const pdf = mupdf.Document.openDocument(buffer.asUint8Array(), 'application/pdf').asPDF();
	if (!pdf) throw new EngineError('Não foi possível gerar um PDF a partir deste documento');
	return pdf;
}

/**
 * Rebuild a document through the page-drawing pipeline. Used by every tool
 * that composes pages (n-up, booklet, overlay, rasterise): the callback draws
 * whatever it likes onto each output page.
 *
 * Note this flattens: annotations and form fields do not survive, because the
 * output is freshly drawn content. Tools that must preserve interactivity
 * edit the page object instead — see `draw.ts`.
 */
export function rebuild(
	pageCount: number,
	boundsFor: (index: number) => mupdf.Rect,
	paint: (device: mupdf.Device, index: number) => void
): mupdf.PDFDocument {
	const buffer = new mupdf.Buffer();
	const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
	for (let i = 0; i < pageCount; i++) {
		const device = writer.beginPage(boundsFor(i));
		paint(device, i);
		device.close();
		writer.endPage();
	}
	writer.close();
	const pdf = mupdf.Document.openDocument(buffer.asUint8Array(), 'application/pdf').asPDF();
	if (!pdf) throw new EngineError('Não foi possível reconstruir o documento');
	return pdf;
}

export { EngineError };
