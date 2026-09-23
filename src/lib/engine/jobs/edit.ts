/** Stamping, annotating, forms and text replacement. */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import {
	anchorText,
	drawImage,
	drawRect,
	drawText,
	measureText,
	type Anchor,
	type FontName
} from '../draw';
import { EngineError, allPages, pagesOf, toOutput, type JobContext } from '../shared';

/**
 * A line of text on the page, with the geometry needed to replace it.
 * All coordinates are MuPDF page space: y runs DOWN from the top-left.
 */
export interface TextLine {
	page: number;
	text: string;
	rect: [number, number, number, number];
	/** Baseline origin — where a replacement string should start. */
	baseline: [number, number];
	size: number;
	font: string;
}

interface StextLine {
	text: string;
	x: number;
	y: number;
	bbox: { x: number; y: number; w: number; h: number };
	font?: { name?: string; size?: number };
}

interface StextBlock {
	type: string;
	lines?: StextLine[];
}

/**
 * Read the page's text lines straight out of structured text.
 *
 * No coordinate conversion happens here, and that is deliberate: structured
 * text, annotation rectangles and redaction all share MuPDF page space, so
 * these values can be handed to `applyRedactions` as-is. Only `draw.ts`
 * flips, because only a content stream uses the other axis.
 */
function readLines(doc: mupdf.PDFDocument, index: number): TextLine[] {
	const page = doc.loadPage(index);
	const parsed = JSON.parse(page.toStructuredText('').asJSON()) as { blocks: StextBlock[] };

	const out: TextLine[] = [];
	for (const block of parsed.blocks ?? []) {
		if (block.type !== 'text') continue;
		for (const line of block.lines ?? []) {
			if (!line.text) continue;
			const { x, y, w, h } = line.bbox;
			out.push({
				page: index,
				text: line.text,
				rect: [x, y, x + w, y + h],
				baseline: [line.x, line.y],
				size: line.font?.size ?? h,
				font: line.font?.name ?? 'Helvetica'
			});
		}
	}
	return out;
}

/** Values that turn a checkbox or radio button off. */
const OFF_VALUES = new Set(['Off', 'off', 'false', '']);
/** Generic "on" values accepted for a single checkbox, whatever its on-state is called. */
const GENERIC_ON = new Set(['true', 'Yes', 'on']);

/** The name of a button widget's on appearance state, e.g. "Yes", "Sim", "1". */
function onStateOf(widget: mupdf.PDFWidget): string | null {
	let on: string | null = null;
	widget
		.getObject()
		.get('AP', 'N')
		.forEach((_, key) => {
			if (key !== 'Off') on ??= String(key);
		});
	return on;
}

const isOn = (widget: mupdf.PDFWidget) => {
	const state = widget.getObject().get('AS');
	return state.isName() && state.asName() !== 'Off';
};

export const editJobs = {
	/** Diagonal or horizontal text stamped across a page selection. */
	watermark(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			text: string;
			size?: number;
			color?: string;
			opacity?: number;
			rotate?: number;
			font?: FontName;
			pages?: number[];
			filename?: string;
		}
	): OutputFile {
		if (!params.text.trim()) throw new EngineError("Digite o texto da marca d'água");
		const {
			size = 48,
			color = '#ff0000',
			opacity = 0.25,
			rotate = 45,
			font = 'Helvetica-Bold'
		} = params;

		const doc = ctx.get(params.handle);
		const width = measureText(params.text, font, size);

		for (const index of pagesOf(doc, params.pages)) {
			const page = doc.loadPage(index);
			const [x0, y0, x1, y1] = page.getBounds();
			const radians = (rotate * Math.PI) / 180;
			// Centre the rotated string on the page centre. y is page space,
			// so the rotation offset adds downward where user space subtracts.
			drawText(doc, page, {
				text: params.text,
				x: (x0 + x1) / 2 - (Math.cos(radians) * width) / 2,
				y: (y0 + y1) / 2 + (Math.sin(radians) * width) / 2 + size / 3,
				size,
				color,
				opacity,
				rotate,
				font
			});
		}
		return toOutput(doc, params.filename ?? 'watermarked.pdf');
	},

	/** Page numbers, with a template so the format is the caller's choice. */
	pageNumbers(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			/** `{n}` is the page number, `{total}` the count. */
			template?: string;
			anchor?: Anchor;
			size?: number;
			color?: string;
			font?: FontName;
			margin?: number;
			startAt?: number;
			pages?: number[];
			filename?: string;
		}
	): OutputFile {
		const {
			template = '{n}',
			anchor = 'bottom-center',
			size = 11,
			color = '#000000',
			font = 'Helvetica',
			margin = 28,
			startAt = 1
		} = params;

		const doc = ctx.get(params.handle);
		const selection = pagesOf(doc, params.pages);

		selection.forEach((index, position) => {
			const page = doc.loadPage(index);
			const text = template
				.replaceAll('{n}', String(startAt + position))
				.replaceAll('{total}', String(selection.length));
			const { x, y } = anchorText(
				page.getBounds(),
				anchor,
				measureText(text, font, size),
				size,
				margin
			);
			drawText(doc, page, { text, x, y, size, color, font });
		});
		return toOutput(doc, params.filename ?? 'numbered.pdf');
	},

	/** Fixed text in a page corner or margin. */
	headerFooter(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			text: string;
			anchor?: Anchor;
			size?: number;
			color?: string;
			font?: FontName;
			margin?: number;
			pages?: number[];
			filename?: string;
		}
	): OutputFile {
		if (!params.text.trim()) throw new EngineError('Digite o texto a adicionar');
		const {
			anchor = 'top-center',
			size = 10,
			color = '#444444',
			font = 'Helvetica',
			margin = 24
		} = params;

		const doc = ctx.get(params.handle);
		for (const index of pagesOf(doc, params.pages)) {
			const page = doc.loadPage(index);
			const { x, y } = anchorText(
				page.getBounds(),
				anchor,
				measureText(params.text, font, size),
				size,
				margin
			);
			drawText(doc, page, { text: params.text, x, y, size, color, font });
		}
		return toOutput(doc, params.filename ?? 'with-header.pdf');
	},

	/** Place text at an exact position — the primitive behind free-form edits. */
	addText(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			items: {
				page: number;
				text: string;
				x: number;
				y: number;
				size?: number;
				color?: string;
				font?: FontName;
				rotate?: number;
				opacity?: number;
			}[];
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		for (const item of params.items) {
			pagesOf(doc, [item.page]);
			drawText(doc, doc.loadPage(item.page), item);
		}
		return toOutput(doc, params.filename ?? 'edited.pdf');
	},

	/** Stamp an image — a logo, or a drawn signature. */
	addImage(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			bytes: Uint8Array;
			placements: {
				page: number;
				x: number;
				y: number;
				width: number;
				height: number;
				opacity?: number;
			}[];
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		let image: mupdf.Image;
		try {
			image = new mupdf.Image(params.bytes);
		} catch (err) {
			throw new EngineError(`Não foi possível ler essa imagem: ${(err as Error).message}`);
		}

		for (const placement of params.placements) {
			pagesOf(doc, [placement.page]);
			drawImage(doc, doc.loadPage(placement.page), image, placement);
		}
		return toOutput(doc, params.filename ?? 'stamped.pdf');
	},

	/** Translucent colour over a rectangle, for marking up a document. */
	highlight(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			areas: { page: number; rect: [number, number, number, number] }[];
			color?: string;
			opacity?: number;
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		for (const area of params.areas) {
			pagesOf(doc, [area.page]);
			drawRect(
				doc,
				doc.loadPage(area.page),
				area.rect,
				params.color ?? '#ffe14d',
				params.opacity ?? 0.4
			);
		}
		return toOutput(doc, params.filename ?? 'highlighted.pdf');
	},

	/** Every text line on a page, with the geometry the editor needs. */
	textLines(ctx: JobContext, params: { handle: DocHandle; page: number }): TextLine[] {
		const doc = ctx.get(params.handle);
		pagesOf(doc, [params.page]);
		return readLines(doc, params.page);
	},

	/**
	 * Replace existing text by removing it and drawing a replacement.
	 *
	 * This is genuine editing of the page content, but it is not reflow: the
	 * surrounding paragraph does not move, and the replacement is drawn in a
	 * standard font rather than the document's original. Long replacements
	 * will overrun. That ceiling is inherent — no free engine reflows PDF
	 * text — and the UI says so rather than pretending otherwise.
	 */
	replaceText(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			edits: {
				page: number;
				rect: [number, number, number, number];
				baseline: [number, number];
				text: string;
				size: number;
				font?: FontName;
				color?: string;
			}[];
			filename?: string;
		}
	): OutputFile {
		if (params.edits.length === 0) throw new EngineError('Nada foi editado');
		const doc = ctx.get(params.handle);

		const byPage = new Map<number, typeof params.edits>();
		for (const edit of params.edits) {
			pagesOf(doc, [edit.page]);
			byPage.set(edit.page, [...(byPage.get(edit.page) ?? []), edit]);
		}

		for (const [index, edits] of byPage) {
			const page = doc.loadPage(index);
			// Remove the old glyphs first. Without black boxes, so the result
			// looks edited rather than censored.
			for (const edit of edits) {
				const annotation = page.createAnnotation('Redact');
				annotation.setRect(edit.rect);
				annotation.update();
			}
			page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE);

			for (const edit of edits) {
				if (!edit.text) continue;
				drawText(doc, page, {
					text: edit.text,
					x: edit.baseline[0],
					y: edit.baseline[1],
					size: edit.size,
					font: edit.font ?? 'Helvetica',
					color: edit.color ?? '#000000'
				});
			}
		}
		return toOutput(doc, params.filename ?? 'edited.pdf');
	},

	/** Read the interactive form fields. */
	formFields(
		ctx: JobContext,
		params: { handle: DocHandle }
	): {
		page: number;
		name: string;
		label: string;
		type: string;
		value: string;
		options: string[];
		readOnly: boolean;
		/**
		 * For a checkbox or radio widget, the value that turns THIS widget on
		 * in fillForm (its on-state, e.g. "Yes", "Sim", "1"); null otherwise.
		 * A radio group lists one entry per widget, all with the same name.
		 */
		exportValue: string | null;
	}[] {
		const doc = ctx.get(params.handle);
		const out = [];
		for (const index of allPages(doc)) {
			for (const widget of doc.loadPage(index).getWidgets()) {
				out.push({
					page: index,
					name: widget.getName(),
					label: widget.getLabel(),
					type: widget.getFieldType(),
					value: widget.getValue(),
					options: widget.isChoice() ? widget.getOptions() : [],
					readOnly: widget.isReadOnly(),
					exportValue: widget.isCheckbox() || widget.isRadioButton() ? onStateOf(widget) : null
				});
			}
		}
		return out;
	},

	/** Fill form fields by name, optionally flattening them afterwards. */
	fillForm(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			values: Record<string, string>;
			flatten?: boolean;
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		const byName = new Map<string, mupdf.PDFWidget[]>();
		for (const index of allPages(doc))
			for (const widget of doc.loadPage(index).getWidgets())
				byName.set(widget.getName(), [...(byName.get(widget.getName()) ?? []), widget]);

		// Validate everything before writing anything: failing halfway would
		// leave the open document partly filled.
		const unknown = Object.keys(params.values).filter((name) => !byName.has(name));
		if (unknown.length)
			throw new EngineError(`Este formulário não tem o campo ${unknown.join(', ')}`);

		const writes: (() => void)[] = [];
		for (const [name, value] of Object.entries(params.values)) {
			const widgets = byName.get(name)!;
			if (!widgets.every((w) => w.isCheckbox() || w.isRadioButton())) {
				for (const widget of widgets)
					writes.push(() => {
						if (widget.isChoice()) widget.setChoiceValue(value);
						else widget.setTextValue(value);
						widget.update();
					});
				continue;
			}

			// A checkbox or radio group: the value names the on-state (export
			// value) of the widget to turn on. Every other widget goes off.
			let targets = OFF_VALUES.has(value) ? [] : widgets.filter((w) => onStateOf(w) === value);
			if (!OFF_VALUES.has(value) && targets.length === 0) {
				if (widgets.length === 1 && GENERIC_ON.has(value)) targets = widgets;
				else throw new EngineError(`O campo ${name} não tem a opção "${value}"`);
			}
			for (const widget of widgets)
				writes.push(() => {
					if (targets.includes(widget) !== isOn(widget)) widget.toggle();
					widget.update();
				});
		}
		for (const write of writes) write();

		// `bake` turns widgets into ordinary page content, so the values stay
		// visible in readers that ignore form data.
		if (params.flatten) doc.bake(false, true);
		return toOutput(doc, params.filename ?? 'filled.pdf');
	},

	/** Turn annotations and form fields into plain, uneditable page content. */
	flatten(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			annotations?: boolean;
			forms?: boolean;
			filename?: string;
		}
	): OutputFile {
		const doc = ctx.get(params.handle);
		doc.bake(params.annotations ?? true, params.forms ?? true);
		return toOutput(doc, params.filename ?? 'flattened.pdf');
	}
};
