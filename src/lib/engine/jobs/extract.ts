/** Pulling information and embedded resources out of a document. */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import { allPages, pagesOf, type JobContext } from '../shared';

export interface OutlineEntry {
	title: string;
	page: number | null;
	depth: number;
}

export interface DocumentReport {
	format: string;
	version: number;
	pageCount: number;
	encrypted: boolean;
	repaired: boolean;
	permissions: Record<string, boolean>;
	metadata: Record<string, string>;
	pageSizes: { page: number; width: number; height: number; rotation: number }[];
	counts: {
		annotations: number;
		formFields: number;
		attachments: number;
		images: number;
		layers: number;
		objects: number;
	};
	hasJavaScript: boolean;
}

/** MuPDF does not export its OutlineItem type, so mirror it structurally. */
interface OutlineNode {
	title?: string;
	page?: number;
	down?: OutlineNode[];
}

function flattenOutline(
	items: OutlineNode[] | null,
	depth = 0,
	out: OutlineEntry[] = []
): OutlineEntry[] {
	for (const item of items ?? []) {
		out.push({ title: item.title ?? '', page: item.page ?? null, depth });
		if (item.down) flattenOutline(item.down, depth + 1, out);
	}
	return out;
}

/**
 * Walk every object once, collecting the image XObjects.
 *
 * These are the *indirect references*, deliberately not resolved. Resolving
 * yields a plain dictionary whose `isStream()` is false and which
 * `loadImage` rejects with "object is not a stream" — the stream lives on
 * the reference itself.
 */
function imageObjects(doc: mupdf.PDFDocument): mupdf.PDFObject[] {
	const found: mupdf.PDFObject[] = [];
	for (let num = 1; num < doc.countObjects(); num++) {
		try {
			const ref = doc.newIndirect(num);
			if (!ref.isStream()) continue;
			const subtype = ref.get('Subtype');
			if (subtype.isNull() || subtype.asName() !== 'Image') continue;
			found.push(ref);
		} catch {
			// A free or malformed slot in the xref table is not an error.
		}
	}
	return found;
}

export const extractJobs = {
	extractText(ctx: JobContext, params: { handle: DocHandle; pages?: number[] }): string {
		const doc = ctx.get(params.handle);
		return pagesOf(doc, params.pages)
			.map((i) => doc.loadPage(i).toStructuredText('').asText())
			.join('\n\n');
	},

	/** Every embedded image, at its original resolution and encoding. */
	async extractImages(
		ctx: JobContext,
		params: { handle: DocHandle; minSize?: number; stem?: string }
	): Promise<OutputFile[]> {
		const doc = ctx.get(params.handle);
		const minSize = params.minSize ?? 32;
		const stem = params.stem ?? 'image';
		const objects = imageObjects(doc);
		const out: OutputFile[] = [];

		for (const [n, obj] of objects.entries()) {
			ctx.checkCancelled();
			try {
				const image = doc.loadImage(obj);
				if (image.getWidth() < minSize || image.getHeight() < minSize) continue;
				const pixmap = image.toPixmap();
				out.push({
					filename: `${stem}-${String(out.length + 1).padStart(3, '0')}.png`,
					mime: 'image/png',
					bytes: pixmap.asPNG()
				});
				pixmap.destroy();
			} catch {
				// A malformed or unsupported image should not abort the export
				// of every other image in the file.
			}
			ctx.report({ done: n + 1, total: objects.length, label: 'Extracting images' });
			await ctx.yield();
		}
		return out;
	},

	/** Bookmarks, flattened to a list with nesting depth. */
	outline(ctx: JobContext, params: { handle: DocHandle }): OutlineEntry[] {
		return flattenOutline(ctx.get(params.handle).loadOutline());
	},

	/** Files attached to the document. */
	attachments(ctx: JobContext, params: { handle: DocHandle }): OutputFile[] {
		const doc = ctx.get(params.handle);
		const out: OutputFile[] = [];
		for (const [name, spec] of Object.entries(doc.getEmbeddedFiles())) {
			const contents = doc.getEmbeddedFileContents(spec);
			if (!contents) continue;
			out.push({
				filename: name || 'attachment',
				mime: 'application/octet-stream',
				bytes: contents.asUint8Array()
			});
		}
		return out;
	},

	metadata(ctx: JobContext, params: { handle: DocHandle }): Record<string, string> {
		const doc = ctx.get(params.handle);
		const keys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];
		const out: Record<string, string> = {};
		for (const key of keys) out[key] = doc.getMetaData(`info:${key}`) ?? '';
		out.CreationDate = doc.getMetaData('info:CreationDate') ?? '';
		out.ModDate = doc.getMetaData('info:ModDate') ?? '';
		return out;
	},

	setMetadata(
		ctx: JobContext,
		params: { handle: DocHandle; values: Record<string, string>; filename?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		for (const [key, value] of Object.entries(params.values)) doc.setMetaData(`info:${key}`, value);
		return {
			filename: params.filename ?? 'document.pdf',
			mime: 'application/pdf',
			bytes: doc.saveToBuffer('garbage=compact,compress').asUint8Array()
		};
	},

	/**
	 * Find text, returning a hit rectangle per match.
	 *
	 * Rectangles are in MuPDF page space — y runs *down* from the top-left,
	 * matching structured text and annotations. See `draw.ts` for why that
	 * differs from PDF user space.
	 */
	search(
		ctx: JobContext,
		params: { handle: DocHandle; needle: string; pages?: number[]; limit?: number }
	): { page: number; rect: [number, number, number, number] }[] {
		const doc = ctx.get(params.handle);
		if (!params.needle) return [];
		const limit = params.limit ?? 500;
		const hits: { page: number; rect: [number, number, number, number] }[] = [];

		for (const index of pagesOf(doc, params.pages)) {
			if (hits.length >= limit) break;
			// The second argument is an option string, not a hit limit; passing
			// a number makes MuPDF throw "Unused search arguments found".
			for (const quads of doc.loadPage(index).toStructuredText('').search(params.needle, '')) {
				// A hit is a list of quads (one per line it wraps across);
				// their union is the rectangle worth highlighting.
				// A Quad is a flat 8-tuple: ul, ur, ll, lr as x/y pairs.
				const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
				const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
				hits.push({
					page: index,
					rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
				});
			}
		}
		return hits;
	},

	/** Everything an inspector panel wants to show about a file. */
	report(ctx: JobContext, params: { handle: DocHandle }): DocumentReport {
		const doc = ctx.get(params.handle);
		const permissionNames: mupdf.DocumentPermission[] = [
			'print',
			'copy',
			'edit',
			'annotate',
			'form',
			'accessibility',
			'assemble',
			'print-hq'
		];

		let annotations = 0;
		let formFields = 0;
		const pageSizes = allPages(doc).map((index) => {
			const page = doc.loadPage(index);
			annotations += page.getAnnotations().length;
			formFields += page.getWidgets().length;
			const [x0, y0, x1, y1] = page.getBounds();
			const rotate = page.getObject().get('Rotate');
			return {
				page: index,
				width: Math.abs(x1 - x0),
				height: Math.abs(y1 - y0),
				rotation: rotate.isNull() ? 0 : rotate.asNumber()
			};
		});

		const names = doc.getTrailer().get('Root').get('Names');

		return {
			format: doc.getMetaData('format') ?? 'PDF',
			version: doc.getVersion(),
			pageCount: doc.countPages(),
			encrypted: (doc.getMetaData('encryption') ?? 'None') !== 'None',
			repaired: doc.wasRepaired(),
			permissions: Object.fromEntries(permissionNames.map((p) => [p, doc.hasPermission(p)])),
			metadata: extractJobs.metadata(ctx, params),
			pageSizes,
			counts: {
				annotations,
				formFields,
				attachments: Object.keys(doc.getEmbeddedFiles()).length,
				images: imageObjects(doc).length,
				layers: doc.countLayers(),
				objects: doc.countObjects()
			},
			hasJavaScript: !names.isNull() && !names.get('JavaScript').isNull()
		};
	}
};
