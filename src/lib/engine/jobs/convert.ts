/**
 * Getting content out of a PDF in other formats.
 *
 * Converting *into* PDF needs no job of its own: `open` already parses every
 * format MuPDF reads (Markdown, HTML, EPUB, CBZ, XPS, SVG, images) and hands
 * back a PDF object model, so "X to PDF" is open-then-save.
 */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import { EngineError, pagesOf, type JobContext } from '../shared';

export type ImageFormat = 'png' | 'jpeg';

const pad = (n: number, total: number) => String(n).padStart(String(total).length, '0');

export const convertJobs = {
	/** Render pages to image files, streaming each one as it is ready. */
	async toImages(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			format?: ImageFormat;
			/** Dots per inch; PDF user space is 72 dpi. */
			dpi?: number;
			quality?: number;
			grayscale?: boolean;
			pages?: number[];
			stem?: string;
		}
	): Promise<OutputFile[]> {
		const { format = 'png', dpi = 150, quality = 85, grayscale = false } = params;
		if (dpi < 10 || dpi > 600) throw new EngineError('A resolução deve ficar entre 10 e 600 dpi');

		const doc = ctx.get(params.handle);
		const pages = pagesOf(doc, params.pages);
		const stem = params.stem ?? 'page';
		const scale = dpi / 72;
		const out: OutputFile[] = [];

		for (const [n, index] of pages.entries()) {
			ctx.checkCancelled();
			const pixmap = doc
				.loadPage(index)
				.toPixmap(
					mupdf.Matrix.scale(scale, scale),
					grayscale ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB,
					false
				);
			out.push({
				filename: `${stem}-${pad(index + 1, doc.countPages())}.${format === 'jpeg' ? 'jpg' : 'png'}`,
				mime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
				bytes: format === 'jpeg' ? pixmap.asJPEG(quality, false) : pixmap.asPNG()
			});
			pixmap.destroy();
			ctx.report({ done: n + 1, total: pages.length, label: 'Convertendo páginas' });
			await ctx.yield();
		}
		return out;
	},

	/** Plain text, with a form feed between pages so page breaks survive. */
	toText(
		ctx: JobContext,
		params: { handle: DocHandle; pages?: number[]; stem?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		const text = pagesOf(doc, params.pages)
			.map((i) => doc.loadPage(i).toStructuredText('').asText())
			.join('\n\f\n');
		return {
			filename: `${params.stem ?? 'document'}.txt`,
			mime: 'text/plain',
			bytes: new TextEncoder().encode(text)
		};
	},

	/** A single HTML document with one section per page. */
	toHtml(
		ctx: JobContext,
		params: { handle: DocHandle; pages?: number[]; stem?: string; title?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		const title = params.title || params.stem || 'Document';
		const body = pagesOf(doc, params.pages)
			.map((i) => doc.loadPage(i).toStructuredText('').asHTML(i))
			.join('\n');

		const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title.replace(/[<>&]/g, '')}</title>
</head>
<body>
${body}
</body>
</html>`;
		return {
			filename: `${params.stem ?? 'document'}.html`,
			mime: 'text/html',
			bytes: new TextEncoder().encode(html)
		};
	},

	/** One SVG per page, preserving vectors rather than rasterising. */
	async toSvg(
		ctx: JobContext,
		params: { handle: DocHandle; pages?: number[]; stem?: string }
	): Promise<OutputFile[]> {
		const doc = ctx.get(params.handle);
		const pages = pagesOf(doc, params.pages);
		const stem = params.stem ?? 'page';
		const out: OutputFile[] = [];

		for (const [n, index] of pages.entries()) {
			ctx.checkCancelled();
			const page = doc.loadPage(index);
			// One writer per page: an SVG file holds exactly one drawing.
			const buffer = new mupdf.Buffer();
			const writer = new mupdf.DocumentWriter(buffer, 'svg', '');
			const device = writer.beginPage(page.getBounds());
			page.run(device, mupdf.Matrix.identity);
			device.close();
			writer.endPage();
			writer.close();

			out.push({
				filename: `${stem}-${pad(index + 1, doc.countPages())}.svg`,
				mime: 'image/svg+xml',
				bytes: buffer.asUint8Array().slice()
			});
			ctx.report({ done: n + 1, total: pages.length, label: 'Convertendo páginas' });
			await ctx.yield();
		}
		return out;
	},

	/**
	 * Structured text as JSON: blocks, lines, fonts and bounding boxes.
	 * This is also the raw material the DOCX and Markdown exporters use.
	 */
	toStructured(
		ctx: JobContext,
		params: { handle: DocHandle; pages?: number[] }
	): { page: number; data: unknown }[] {
		const doc = ctx.get(params.handle);
		return pagesOf(doc, params.pages).map((index) => ({
			page: index,
			data: JSON.parse(doc.loadPage(index).toStructuredText('').asJSON())
		}));
	}
};
