/** Page-level composition: order, geometry and imposition. */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import {
	EngineError,
	allPages,
	pageRotation,
	pagesOf,
	rebuild,
	setPageRotation,
	toOutput,
	type JobContext
} from '../shared';

/** Standard page sizes in points, for resize and blank-page insertion. */
export const PAGE_SIZES: Record<string, [number, number]> = {
	A3: [841.89, 1190.55],
	A4: [595.28, 841.89],
	A5: [419.53, 595.28],
	Letter: [612, 792],
	Legal: [612, 1008],
	Tabloid: [792, 1224]
};

const sizeOf = (name: string): [number, number] => {
	const size = PAGE_SIZES[name];
	if (!size) throw new EngineError(`Tamanho de papel desconhecido: "${name}"`);
	return size;
};

/** Copy pages from `src` into a fresh document, in the order given. */
function collect(src: mupdf.PDFDocument, order: number[]): mupdf.PDFDocument {
	const out = new mupdf.PDFDocument();
	for (const index of order) out.graftPage(-1, src, index);
	return out;
}

export const organizeJobs = {
	/** Concatenate several already-open documents into one. */
	async merge(
		ctx: JobContext,
		params: { handles: DocHandle[]; filename?: string }
	): Promise<OutputFile> {
		if (params.handles.length < 2) throw new EngineError('Juntar exige pelo menos dois arquivos');
		const out = new mupdf.PDFDocument();
		const total = params.handles.reduce((n, h) => n + ctx.get(h).countPages(), 0);
		let done = 0;

		for (const handle of params.handles) {
			const src = ctx.get(handle);
			for (let i = 0; i < src.countPages(); i++) {
				ctx.checkCancelled();
				out.graftPage(-1, src, i);
				ctx.report({ done: ++done, total, label: 'Merging pages' });
				await ctx.yield();
			}
		}
		return toOutput(out, params.filename ?? 'merged.pdf');
	},

	/**
	 * Pull page selections out into new documents. One selection is "extract
	 * pages"; many selections is "split into N files".
	 */
	extract(
		ctx: JobContext,
		params: { handle: DocHandle; selections: { pages: number[]; filename: string }[] }
	): OutputFile[] {
		const src = ctx.get(params.handle);
		if (params.selections.length === 0) throw new EngineError('Nada foi selecionado para extrair');
		return params.selections.map(({ pages, filename }) =>
			toOutput(collect(src, pagesOf(src, pages)), filename)
		);
	},

	/**
	 * Reorder, delete and rotate in a single pass. The UI edits a page model
	 * and submits the whole desired result, rather than issuing one job per
	 * fiddly operation.
	 */
	organize(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			/** Source page indices in their new order; omissions are deletions. */
			order: number[];
			/** Extra clockwise rotation per output position, in degrees. */
			rotations?: number[];
			filename?: string;
		}
	): OutputFile {
		const src = ctx.get(params.handle);
		if (params.order.length === 0)
			throw new EngineError('Um documento precisa de pelo menos uma página');

		const out = collect(src, pagesOf(src, params.order));
		params.order.forEach((_, position) => {
			const extra = params.rotations?.[position];
			if (!extra) return;
			const page = out.loadPage(position);
			setPageRotation(out, page, pageRotation(page) + extra);
		});
		return toOutput(out, params.filename ?? 'organized.pdf');
	},

	/** Rotate a page selection by a fixed amount. */
	rotate(
		ctx: JobContext,
		params: { handle: DocHandle; degrees: number; pages?: number[]; filename?: string }
	): OutputFile {
		const src = ctx.get(params.handle);
		const out = collect(src, allPages(src));
		for (const index of pagesOf(out, params.pages)) {
			const page = out.loadPage(index);
			setPageRotation(out, page, pageRotation(page) + params.degrees);
		}
		return toOutput(out, params.filename ?? 'rotated.pdf');
	},

	/** Reverse page order. */
	reverse(ctx: JobContext, params: { handle: DocHandle; filename?: string }): OutputFile {
		const src = ctx.get(params.handle);
		return toOutput(collect(src, allPages(src).reverse()), params.filename ?? 'reversed.pdf');
	},

	/** Repeat the whole document, or a selection, N times. */
	duplicate(
		ctx: JobContext,
		params: { handle: DocHandle; times: number; pages?: number[]; filename?: string }
	): OutputFile {
		if (!Number.isInteger(params.times) || params.times < 1)
			throw new EngineError('O número de cópias deve ser inteiro e no mínimo 1');
		const src = ctx.get(params.handle);
		const selection = pagesOf(src, params.pages);
		const order: number[] = [];
		for (let n = 0; n < params.times; n++) order.push(...selection);
		return toOutput(collect(src, order), params.filename ?? 'duplicated.pdf');
	},

	/**
	 * Crop by insetting the CropBox. Percentages rather than points, so the
	 * same setting behaves sensibly across mixed page sizes.
	 */
	crop(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			top: number;
			right: number;
			bottom: number;
			left: number;
			pages?: number[];
			filename?: string;
		}
	): OutputFile {
		const { top, right, bottom, left } = params;
		if ([top, right, bottom, left].some((v) => v < 0 || v >= 50))
			throw new EngineError('Cada margem deve ficar entre 0% e 49%');

		const src = ctx.get(params.handle);
		const out = collect(src, allPages(src));
		for (const index of pagesOf(out, params.pages)) {
			const page = out.loadPage(index);
			const [x0, y0, x1, y1] = page.getBounds();
			const width = x1 - x0;
			const height = y1 - y0;
			page.setPageBox('CropBox', [
				x0 + (width * left) / 100,
				y0 + (height * bottom) / 100,
				x1 - (width * right) / 100,
				y1 - (height * top) / 100
			]);
		}
		return toOutput(out, params.filename ?? 'cropped.pdf');
	},

	/** Scale every page onto a standard paper size, preserving aspect ratio. */
	resize(
		ctx: JobContext,
		params: { handle: DocHandle; size: string; landscape?: boolean; filename?: string }
	): OutputFile {
		const src = ctx.get(params.handle);
		const [shortSide, longSide] = sizeOf(params.size);
		const target: [number, number] = params.landscape
			? [longSide, shortSide]
			: [shortSide, longSide];

		const out = rebuild(
			src.countPages(),
			() => [0, 0, target[0], target[1]],
			(device, index) => {
				const page = src.loadPage(index);
				const [x0, y0, x1, y1] = page.getBounds();
				const scale = Math.min(target[0] / (x1 - x0), target[1] / (y1 - y0));
				// Centre the scaled page on the new sheet.
				const matrix = mupdf.Matrix.concat(
					mupdf.Matrix.scale(scale, scale),
					mupdf.Matrix.translate(
						(target[0] - (x1 - x0) * scale) / 2 - x0 * scale,
						(target[1] - (y1 - y0) * scale) / 2 - y0 * scale
					)
				);
				page.run(device, matrix);
			}
		);
		return toOutput(out, params.filename ?? 'resized.pdf');
	},

	/** Place several source pages per sheet in a grid. */
	nup(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			columns: number;
			rows: number;
			size?: string;
			landscape?: boolean;
			gap?: number;
			filename?: string;
		}
	): OutputFile {
		const { columns, rows, gap = 8 } = params;
		if (columns < 1 || rows < 1) throw new EngineError('Colunas e linhas devem ser no mínimo 1');

		const src = ctx.get(params.handle);
		const perSheet = columns * rows;
		const sheets = Math.ceil(src.countPages() / perSheet);
		const [shortSide, longSide] = sizeOf(params.size ?? 'A4');
		const [sheetWidth, sheetHeight] = params.landscape
			? [longSide, shortSide]
			: [shortSide, longSide];

		const cellWidth = (sheetWidth - gap * (columns + 1)) / columns;
		const cellHeight = (sheetHeight - gap * (rows + 1)) / rows;

		const out = rebuild(
			sheets,
			() => [0, 0, sheetWidth, sheetHeight],
			(device, sheet) => {
				for (let slot = 0; slot < perSheet; slot++) {
					const pageIndex = sheet * perSheet + slot;
					if (pageIndex >= src.countPages()) break;

					const page = src.loadPage(pageIndex);
					const [x0, y0, x1, y1] = page.getBounds();
					const scale = Math.min(cellWidth / (x1 - x0), cellHeight / (y1 - y0));

					const column = slot % columns;
					// PDF counts y upwards, so the first row sits at the top.
					const row = rows - 1 - Math.floor(slot / columns);
					const cellX = gap + column * (cellWidth + gap);
					const cellY = gap + row * (cellHeight + gap);

					page.run(
						device,
						mupdf.Matrix.concat(
							mupdf.Matrix.scale(scale, scale),
							mupdf.Matrix.translate(
								cellX + (cellWidth - (x1 - x0) * scale) / 2 - x0 * scale,
								cellY + (cellHeight - (y1 - y0) * scale) / 2 - y0 * scale
							)
						)
					);
				}
			}
		);
		return toOutput(out, params.filename ?? 'nup.pdf');
	},

	/**
	 * Saddle-stitch imposition: two pages per sheet side, ordered so that
	 * printing double-sided and folding down the middle yields a booklet.
	 */
	booklet(
		ctx: JobContext,
		params: { handle: DocHandle; size?: string; filename?: string }
	): OutputFile {
		const src = ctx.get(params.handle);
		const count = src.countPages();
		// Saddle stitching needs a multiple of four; blanks pad the end.
		const padded = Math.ceil(count / 4) * 4;

		const order: (number | null)[] = [];
		for (let i = 0; i < padded / 2; i += 2) {
			const last = padded - 1 - i;
			order.push(last <= count - 1 ? last : null, i <= count - 1 ? i : null);
			order.push(i + 1 <= count - 1 ? i + 1 : null, last - 1 <= count - 1 ? last - 1 : null);
		}

		const [shortSide, longSide] = sizeOf(params.size ?? 'A4');
		const [sheetWidth, sheetHeight] = [longSide, shortSide];
		const half = sheetWidth / 2;

		const out = rebuild(
			order.length / 2,
			() => [0, 0, sheetWidth, sheetHeight],
			(device, sheet) => {
				for (const side of [0, 1]) {
					const pageIndex = order[sheet * 2 + side];
					if (pageIndex === null || pageIndex === undefined) continue;
					const page = src.loadPage(pageIndex);
					const [x0, y0, x1, y1] = page.getBounds();
					const scale = Math.min(half / (x1 - x0), sheetHeight / (y1 - y0));
					page.run(
						device,
						mupdf.Matrix.concat(
							mupdf.Matrix.scale(scale, scale),
							mupdf.Matrix.translate(
								side * half + (half - (x1 - x0) * scale) / 2 - x0 * scale,
								(sheetHeight - (y1 - y0) * scale) / 2 - y0 * scale
							)
						)
					);
				}
			}
		);
		return toOutput(out, params.filename ?? 'booklet.pdf');
	},

	/**
	 * Interleave two documents, page by page. The classic use is rejoining a
	 * stack scanned front-side first and then back-side.
	 */
	interleave(
		ctx: JobContext,
		params: {
			handles: [DocHandle, DocHandle];
			/** Reverse the second document, as a back-side scan usually needs. */
			reverseSecond?: boolean;
			filename?: string;
		}
	): OutputFile {
		const [first, second] = params.handles.map((handle) => ctx.get(handle));
		const secondOrder = allPages(second);
		if (params.reverseSecond) secondOrder.reverse();

		const out = new mupdf.PDFDocument();
		const longest = Math.max(first.countPages(), secondOrder.length);
		for (let i = 0; i < longest; i++) {
			if (i < first.countPages()) out.graftPage(-1, first, i);
			if (i < secondOrder.length) out.graftPage(-1, second, secondOrder[i]);
		}
		return toOutput(out, params.filename ?? 'interleaved.pdf');
	},

	/** Draw one document on top of another — letterheads, stamps, borders. */
	overlay(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			stampHandle: DocHandle;
			/** Draw the stamp beneath the page instead of over it. */
			behind?: boolean;
			/** Reuse the stamp's single page on every page. */
			repeat?: boolean;
			filename?: string;
		}
	): OutputFile {
		const base = ctx.get(params.handle);
		const stamp = ctx.get(params.stampHandle);

		const out = rebuild(
			base.countPages(),
			(index) => base.loadPage(index).getBounds(),
			(device, index) => {
				const stampIndex = params.repeat === false ? index : index % stamp.countPages();
				const draw = () => {
					if (stampIndex < stamp.countPages())
						stamp.loadPage(stampIndex).run(device, mupdf.Matrix.identity);
				};
				if (params.behind) draw();
				base.loadPage(index).run(device, mupdf.Matrix.identity);
				if (!params.behind) draw();
			}
		);
		return toOutput(out, params.filename ?? 'overlaid.pdf');
	},

	/** Insert blank pages at chosen positions. */
	insertBlank(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			/** 0-based positions in the output, after insertion. */
			at: number[];
			size?: string;
			filename?: string;
		}
	): OutputFile {
		const src = ctx.get(params.handle);
		const out = new mupdf.PDFDocument();
		const insertAt = new Set(params.at);
		const [width, height] = params.size
			? sizeOf(params.size)
			: (() => {
					const [x0, y0, x1, y1] = src.loadPage(0).getBounds();
					return [x1 - x0, y1 - y0] as [number, number];
				})();

		let position = 0;
		const addBlank = () => {
			out.insertPage(-1, out.addPage([0, 0, width, height], 0, out.newDictionary(), ''));
			position++;
		};

		for (let i = 0; i < src.countPages(); i++) {
			while (insertAt.has(position)) addBlank();
			out.graftPage(-1, src, i);
			position++;
		}
		while (insertAt.has(position)) addBlank();

		return toOutput(out, params.filename ?? 'with-blanks.pdf');
	}
};
