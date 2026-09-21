/** Making files smaller, and converting them to grayscale. */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import { EngineError, allPages, rebuild, toOutput, type JobContext } from '../shared';

export interface CompressResult {
	file: OutputFile;
	before: number;
	after: number;
	imagesRecompressed: number;
}

/**
 * Downsample and re-encode the image XObjects in place.
 *
 * This is the part of compression that actually matters — scanned pages are
 * almost entirely image data — and it keeps the text layer as real text,
 * which rasterising the whole page would destroy.
 */
function recompressImages(
	doc: mupdf.PDFDocument,
	ctx: JobContext,
	maxDimension: number,
	quality: number
): number {
	let count = 0;
	const total = doc.countObjects();

	for (let num = 1; num < total; num++) {
		ctx.checkCancelled();
		// The indirect reference, deliberately unresolved: resolving gives a
		// dictionary that is not a stream, which loadImage rejects.
		let obj: mupdf.PDFObject;
		try {
			obj = doc.newIndirect(num);
			if (!obj.isStream()) continue;
			const subtype = obj.get('Subtype');
			if (subtype.isNull() || subtype.asName() !== 'Image') continue;
		} catch {
			continue;
		}

		try {
			const image = doc.loadImage(obj);
			const width = image.getWidth();
			const height = image.getHeight();
			// An image mask is 1 bit per pixel; re-encoding it as JPEG would
			// make it larger and break the masking.
			if (image.getImageMask()) continue;

			const scale = Math.min(1, maxDimension / Math.max(width, height));
			const pixmap = image.toPixmap();
			const source =
				scale < 1
					? // No direct resample API, so redraw the image through a
						// scaled device into a smaller pixmap.
						(() => {
							const target = new mupdf.Pixmap(
								mupdf.ColorSpace.DeviceRGB,
								[
									0,
									0,
									Math.max(1, Math.round(width * scale)),
									Math.max(1, Math.round(height * scale))
								],
								false
							);
							target.clear(255);
							const device = new mupdf.DrawDevice(
								mupdf.Matrix.scale((width * scale) / width, (height * scale) / height),
								target
							);
							device.fillImage(
								image,
								mupdf.Matrix.concat(
									mupdf.Matrix.scale(width, height),
									mupdf.Matrix.scale(scale, scale)
								),
								1
							);
							device.close();
							return target;
						})()
					: pixmap;

			const encoded = source.asJPEG(quality, false);
			// Only keep the new version if it is actually smaller.
			if (encoded.byteLength < obj.readRawStream().getLength()) {
				const replacement = doc.addImage(new mupdf.Image(encoded));
				obj.writeRawStream(replacement.readRawStream());
				for (const key of [
					'Filter',
					'Width',
					'Height',
					'ColorSpace',
					'BitsPerComponent',
					'DecodeParms'
				])
					obj.put(key, replacement.get(key));
				count++;
			}
			if (source !== pixmap) source.destroy();
			pixmap.destroy();
		} catch {
			// A single unreadable image must not abort the whole compression.
		}
	}
	return count;
}

export const optimizeJobs = {
	/**
	 * Shrink a file. `lossless` only prunes and deflates; the image pass
	 * additionally downsamples and re-encodes pictures, which is where the
	 * real savings on scanned documents come from.
	 */
	compress(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			level?: 'lossless' | 'balanced' | 'aggressive';
			filename?: string;
		}
	): CompressResult {
		const doc = ctx.get(params.handle);
		const before = doc.saveToBuffer('').getLength();
		const level = params.level ?? 'balanced';

		let imagesRecompressed = 0;
		if (level !== 'lossless') {
			const settings =
				level === 'aggressive' ? { max: 1000, quality: 45 } : { max: 1600, quality: 72 };
			imagesRecompressed = recompressImages(doc, ctx, settings.max, settings.quality);
		}

		doc.subsetFonts();
		const file = toOutput(doc, params.filename ?? 'compressed.pdf', 'garbage=compact,compress');
		return { file, before, after: file.bytes.byteLength, imagesRecompressed };
	},

	/**
	 * Convert to grayscale by redrawing every page through a gray device.
	 * This rasterises: vectors and text become an image, which is the
	 * trade-off for guaranteeing no colour survives anywhere.
	 */
	grayscale(
		ctx: JobContext,
		params: { handle: DocHandle; dpi?: number; filename?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		const dpi = params.dpi ?? 150;
		if (dpi < 36 || dpi > 600) throw new EngineError('A resolução deve ficar entre 36 e 600 dpi');
		const scale = dpi / 72;

		const out = rebuild(
			doc.countPages(),
			(index) => doc.loadPage(index).getBounds(),
			(device, index) => {
				const page = doc.loadPage(index);
				const [x0, y0, x1, y1] = page.getBounds();
				const pixmap = page.toPixmap(
					mupdf.Matrix.scale(scale, scale),
					mupdf.ColorSpace.DeviceGray,
					false
				);
				const image = new mupdf.Image(pixmap);
				device.fillImage(
					image,
					mupdf.Matrix.concat(mupdf.Matrix.scale(x1 - x0, y1 - y0), mupdf.Matrix.translate(x0, y0)),
					1
				);
				pixmap.destroy();
			}
		);
		return toOutput(out, params.filename ?? 'grayscale.pdf');
	},

	/** Flatten every page to an image — kills text, defeats copy-paste. */
	rasterize(
		ctx: JobContext,
		params: { handle: DocHandle; dpi?: number; filename?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		const dpi = params.dpi ?? 150;
		const scale = dpi / 72;

		const out = rebuild(
			doc.countPages(),
			(index) => doc.loadPage(index).getBounds(),
			(device, index) => {
				const page = doc.loadPage(index);
				const [x0, y0, x1, y1] = page.getBounds();
				const pixmap = page.toPixmap(
					mupdf.Matrix.scale(scale, scale),
					mupdf.ColorSpace.DeviceRGB,
					false
				);
				device.fillImage(
					new mupdf.Image(pixmap),
					mupdf.Matrix.concat(mupdf.Matrix.scale(x1 - x0, y1 - y0), mupdf.Matrix.translate(x0, y0)),
					1
				);
				pixmap.destroy();
			}
		);
		return toOutput(out, params.filename ?? 'rasterized.pdf');
	},

	/** Drop unused objects and subset fonts without touching image quality. */
	clean(ctx: JobContext, params: { handle: DocHandle; filename?: string }): CompressResult {
		const doc = ctx.get(params.handle);
		const before = doc.saveToBuffer('').getLength();
		doc.subsetFonts();
		const file = toOutput(doc, params.filename ?? 'cleaned.pdf', 'garbage=deduplicate,compress');
		return { file, before, after: file.bytes.byteLength, imagesRecompressed: 0 };
	},

	/** Rewrite page labels, e.g. roman numerals for front matter. */
	pageLabels(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			rules: { from: number; style: string; prefix?: string; start?: number }[];
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		for (const index of allPages(doc)) doc.deletePageLabels(index);
		for (const rule of params.rules)
			doc.setPageLabels(rule.from, rule.style, rule.prefix ?? '', rule.start ?? 1);
		return toOutput(doc, params.filename ?? 'labelled.pdf');
	}
};
