/**
 * The complete job table.
 *
 * Handlers are pure with respect to the worker: they take a context and
 * params, and return a result. That is deliberate — the same `mupdf` package
 * runs in Node, so every handler is testable headlessly with no browser and
 * no mocks. The worker is only a message shim over this object.
 *
 * Types flow *out* of these implementations (see `JobParams` / `JobResult`
 * below), so adding a capability never means updating a parallel type list.
 */
import * as mupdf from 'mupdf';
import { PASSWORD_REQUIRED, type DocHandle, type DocInfo, type RenderedPage } from '../contract';
import {
	EngineError,
	describe,
	normaliseInput,
	pagesOf,
	toOutput,
	toPdfDocument,
	type JobContext
} from '../shared';
import { organizeJobs } from './organize';
import { securityJobs } from './security';
import { convertJobs } from './convert';
import { editJobs } from './edit';
import { extractJobs } from './extract';
import { optimizeJobs } from './optimize';

const coreJobs = {
	/**
	 * Parse any format MuPDF understands and cache it as a PDF. Non-PDF inputs
	 * (markdown, HTML, images, EPUB, CBZ...) are converted on the way in, which
	 * is what gives the converter tools their spine for free.
	 */
	open(ctx: JobContext, params: { bytes: Uint8Array; magic: string; password?: string }): DocInfo {
		let doc: mupdf.Document;
		try {
			doc = mupdf.Document.openDocument(normaliseInput(params.bytes, params.magic), params.magic);
		} catch (err) {
			throw new EngineError(
				`Não foi possível abrir este arquivo como ${params.magic}: ${(err as Error).message}`
			);
		}

		let pdf: mupdf.PDFDocument;
		try {
			if (doc.needsPassword()) {
				if (!params.password)
					throw new EngineError('Este PDF está protegido por senha', PASSWORD_REQUIRED);
				if (doc.authenticatePassword(params.password) === 0)
					throw new EngineError('A senha não foi aceita', PASSWORD_REQUIRED);
			}
			// Non-PDF formats have no PDF object model, so round-trip them
			// through the writer to get one. Real PDFs pass straight through.
			pdf = doc.asPDF() ?? toPdfDocument(doc);
		} catch (err) {
			doc.destroy();
			throw err;
		}
		// The source of a conversion is not needed once the PDF exists.
		if (pdf !== doc) doc.destroy();
		const handle = ctx.store(pdf, params.bytes.byteLength);
		return describe(pdf, handle, params.bytes.byteLength);
	},

	close(ctx: JobContext, params: { handle: DocHandle }): null {
		ctx.drop(params.handle);
		return null;
	},

	inspect(ctx: JobContext, params: { handle: DocHandle }): DocInfo {
		return describe(ctx.get(params.handle), params.handle, ctx.byteLength(params.handle));
	},

	/**
	 * Render pages to PNG, streaming each one as it completes. A 400-page
	 * document must not make the user wait for page 400 to see page 1.
	 */
	async render(
		ctx: JobContext,
		params: { handle: DocHandle; pages?: number[]; width?: number }
	): Promise<null> {
		const doc = ctx.get(params.handle);
		const targetWidth = params.width ?? 220;
		const pages = pagesOf(doc, params.pages);

		for (let n = 0; n < pages.length; n++) {
			ctx.checkCancelled();
			const index = pages[n];
			const page = doc.loadPage(index);
			const [x0, , x1] = page.getBounds();
			const scale = targetWidth / Math.max(1, Math.abs(x1 - x0));
			const pixmap = page.toPixmap(
				mupdf.Matrix.scale(scale, scale),
				mupdf.ColorSpace.DeviceRGB,
				false
			);
			const chunk: RenderedPage = {
				index,
				png: pixmap.asPNG(),
				width: pixmap.getWidth(),
				height: pixmap.getHeight()
			};
			pixmap.destroy();
			ctx.emit(chunk);
			ctx.report({ done: n + 1, total: pages.length, label: 'Renderizando páginas' });
			// Sync WASM hogs the thread; yielding keeps cancel responsive.
			await ctx.yield();
		}
		return null;
	},

	/** Write the cached document out, optionally with custom save flags. */
	save(ctx: JobContext, params: { handle: DocHandle; filename?: string; options?: string }) {
		return toOutput(ctx.get(params.handle), params.filename ?? 'document.pdf', params.options);
	}
};

export const handlers = {
	...coreJobs,
	...organizeJobs,
	...securityJobs,
	...convertJobs,
	...editJobs,
	...extractJobs,
	...optimizeJobs
};

export type Handlers = typeof handlers;
export type JobName = keyof Handlers;
export type JobParams<N extends JobName> = Parameters<Handlers[N]>[1];
export type JobResult<N extends JobName> = Awaited<ReturnType<Handlers[N]>>;

export { EngineError, type JobContext };
export { PAGE_SIZES } from './organize';
export { PERMISSION_BITS, permissionMask, type PermissionName } from './security';
export type { TextLine } from './edit';
export type { DocumentReport, OutlineEntry, SearchHit } from './extract';
export type { CompressResult } from './optimize';
