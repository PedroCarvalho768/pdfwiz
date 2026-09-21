/**
 * Content-stream drawing.
 *
 * These helpers append to a page's existing content rather than redrawing it
 * through a `DocumentWriter`. That distinction matters: redrawing flattens a
 * document, destroying annotations, form fields and links. Stamping a
 * watermark or a page number must not do that, so this path edits the page
 * object in place and leaves everything else untouched.
 *
 * ## Coordinates — read this before touching any geometry
 *
 * Two y axes are in play and they point in opposite directions:
 *
 * - **MuPDF page space**: y runs DOWN from the top-left. This is what
 *   `page.getBounds()`, structured-text bounding boxes, search quads and
 *   annotation rectangles all use. It is the engine's public convention, so
 *   every job's params and results are in it.
 * - **PDF user space**: y runs UP from the bottom-left. This exists only
 *   inside a content stream.
 *
 * Every function in this file takes page space and flips internally, so
 * `flipY` below is the ONLY place the two meet. Getting this wrong does not
 * error — it silently draws in the wrong half of the page, which is why the
 * tests assert on vertical position rather than only on text presence.
 */
import * as mupdf from 'mupdf';
import { EngineError } from './contract';

export type FontName =
	| 'Helvetica'
	| 'Helvetica-Bold'
	| 'Helvetica-Oblique'
	| 'Times-Roman'
	| 'Times-Bold'
	| 'Times-Italic'
	| 'Courier'
	| 'Courier-Bold';

export const FONT_NAMES: FontName[] = [
	'Helvetica',
	'Helvetica-Bold',
	'Helvetica-Oblique',
	'Times-Roman',
	'Times-Bold',
	'Times-Italic',
	'Courier',
	'Courier-Bold'
];

/** `#rrggbb` (or `rgb(...)`-free shorthand) to PDF's 0..1 components. */
export function parseColor(value: string): [number, number, number] {
	const hex = value.trim().replace(/^#/, '');
	const full =
		hex.length === 3
			? hex
					.split('')
					.map((c) => c + c)
					.join('')
			: hex;
	if (!/^[0-9a-fA-F]{6}$/.test(full))
		throw new EngineError(`"${value}" não é uma cor no formato #ff0000`);
	return [
		parseInt(full.slice(0, 2), 16) / 255,
		parseInt(full.slice(2, 4), 16) / 255,
		parseInt(full.slice(4, 6), 16) / 255
	];
}

/**
 * Encode a string as a PDF literal in WinAnsi.
 *
 * Latin-1 and WinAnsi agree over the accented range that matters for western
 * European text, so a codepoint below 256 maps straight through; anything
 * above it has no glyph in a base-14 simple font and would otherwise render
 * as garbage, so it is replaced rather than silently mangled.
 */
export function pdfString(text: string): string {
	let out = '';
	for (const char of text) {
		const code = char.codePointAt(0)!;
		if (char === '(' || char === ')' || char === '\\') out += '\\' + char;
		else if (code === 10) out += '\\n';
		else if (code === 13) out += '\\r';
		else if (code === 9) out += '\\t';
		else if (code >= 32 && code < 127) out += char;
		else if (code < 256) out += '\\' + code.toString(8).padStart(3, '0');
		else out += '?';
	}
	return `(${out})`;
}

/** Width of `text` in points, so callers can centre and right-align. */
export function measureText(text: string, fontName: FontName, size: number): number {
	const font = new mupdf.Font(fontName);
	let width = 0;
	for (const char of text) width += font.advanceGlyph(font.encodeCharacter(char));
	return width * size;
}

/** MuPDF page space to PDF user space, and back — the two are mirror images. */
const flipY = (bounds: mupdf.Rect, y: number) => bounds[1] + bounds[3] - y;

/** Add `value` under /Resources/<category>/<name>, creating the dictionaries. */
function putResource(
	doc: mupdf.PDFDocument,
	page: mupdf.PDFPage,
	category: string,
	name: string,
	value: mupdf.PDFObject
) {
	const pageObj = page.getObject();
	let resources = pageObj.get('Resources');
	if (!resources.isDictionary()) pageObj.put('Resources', (resources = doc.newDictionary()));
	let bucket = resources.get(category);
	if (!bucket.isDictionary()) resources.put(category, (bucket = doc.newDictionary()));
	bucket.put(name, value);
}

/** Marks a page whose original content we have already wrapped in q/Q. */
const ISOLATED_KEY = 'PWIsolated';

/**
 * Append a content stream to a page, preserving whatever is already drawn.
 *
 * The existing content is first wrapped in `q` ... `Q`. This is not
 * defensive padding — it is required. A content stream may leave the graphics
 * state modified when it ends, and MuPDF's own `DocumentWriter` output does
 * exactly that: it opens with `1 0 0 -1 0 h cm` (a y-flip) plus a translate
 * and never balances them, because nothing follows it. Appending to such a
 * page without isolation inherits that transform, and the stamp lands
 * mirrored and offset instead of where it was asked for.
 *
 * PDF concatenates the streams of a Contents array into one stream, so
 * bracketing the original restores the default CTM for whatever we add.
 */
function appendContent(doc: mupdf.PDFDocument, page: mupdf.PDFPage, content: string) {
	const pageObj = page.getObject();
	const stream = doc.addStream(content, null);
	const existing = pageObj.get('Contents');

	if (existing.isNull()) {
		pageObj.put('Contents', stream);
		return;
	}

	if (pageObj.get(ISOLATED_KEY).isNull()) {
		const wrapped = doc.newArray();
		wrapped.push(doc.addStream('q\n', null));
		if (existing.isArray()) existing.forEach((part) => wrapped.push(part));
		else wrapped.push(existing);
		wrapped.push(doc.addStream('\nQ\n', null));
		pageObj.put('Contents', wrapped);
		pageObj.put(ISOLATED_KEY, doc.newBoolean(true));
	}

	pageObj.get('Contents').push(stream);
}

/** Register an ExtGState for constant alpha, returning its resource name. */
function alphaState(doc: mupdf.PDFDocument, page: mupdf.PDFPage, opacity: number): string | null {
	if (opacity >= 1) return null;
	const name = `PWgs${Math.round(opacity * 100)}`;
	const state = doc.newDictionary();
	state.put('Type', doc.newName('ExtGState'));
	state.put('ca', doc.newReal(opacity));
	state.put('CA', doc.newReal(opacity));
	putResource(doc, page, 'ExtGState', name, doc.addObject(state));
	return name;
}

export interface TextOptions {
	text: string;
	/** Baseline origin in MuPDF page space: y measured DOWN from the top. */
	x: number;
	y: number;
	size?: number;
	font?: FontName;
	/** `#rrggbb`. */
	color?: string;
	opacity?: number;
	/** Counter-clockwise degrees, rotated about (x, y). */
	rotate?: number;
}

/** Stamp text onto a page without disturbing its existing content. */
export function drawText(doc: mupdf.PDFDocument, page: mupdf.PDFPage, options: TextOptions) {
	const {
		text,
		x,
		y,
		size = 12,
		font = 'Helvetica',
		color = '#000000',
		opacity = 1,
		rotate = 0
	} = options;
	if (!text) return;

	const resourceName = `PWf${FONT_NAMES.indexOf(font)}`;
	putResource(doc, page, 'Font', resourceName, doc.addSimpleFont(new mupdf.Font(font), 'Latin'));

	const [r, g, b] = parseColor(color);
	const gs = alphaState(doc, page, opacity);
	const userY = flipY(page.getBounds(), y);
	const radians = (rotate * Math.PI) / 180;
	const cos = Math.cos(radians).toFixed(6);
	const sin = Math.sin(radians).toFixed(6);

	// Rotate about the anchor: translate to it, rotate, draw at the origin.
	const parts = [
		'q',
		gs ? `/${gs} gs` : '',
		`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
		`${cos} ${sin} ${-sin} ${cos} ${x.toFixed(3)} ${userY.toFixed(3)} cm`,
		'BT',
		`/${resourceName} ${size} Tf`,
		`${pdfString(text)} Tj`,
		'ET',
		'Q'
	];
	appendContent(doc, page, parts.filter(Boolean).join('\n'));
}

export interface ImageOptions {
	/** Top-left corner in MuPDF page space: y measured DOWN from the top. */
	x: number;
	y: number;
	width: number;
	height: number;
	opacity?: number;
}

/** Stamp an image onto a page without disturbing its existing content. */
export function drawImage(
	doc: mupdf.PDFDocument,
	page: mupdf.PDFPage,
	image: mupdf.Image,
	options: ImageOptions
) {
	const { x, y, width, height, opacity = 1 } = options;
	const name = `PWx${Math.random().toString(36).slice(2, 8)}`;
	putResource(doc, page, 'XObject', name, doc.addImage(image));
	const gs = alphaState(doc, page, opacity);
	// An image is anchored by its top-left, but drawn from its bottom-left.
	const userY = flipY(page.getBounds(), y + height);

	appendContent(
		doc,
		page,
		[
			'q',
			gs ? `/${gs} gs` : '',
			// An image XObject draws into the unit square, so the CTM is its box.
			`${width.toFixed(3)} 0 0 ${height.toFixed(3)} ${x.toFixed(3)} ${userY.toFixed(3)} cm`,
			`/${name} Do`,
			'Q'
		]
			.filter(Boolean)
			.join('\n')
	);
}

/** Fill a rectangle — used for redaction backing and highlight boxes. */
export function drawRect(
	doc: mupdf.PDFDocument,
	page: mupdf.PDFPage,
	rect: mupdf.Rect,
	color: string,
	opacity = 1
) {
	const [x0, y0, x1, y1] = rect;
	const bounds = page.getBounds();
	const [uy0, uy1] = [flipY(bounds, y0), flipY(bounds, y1)];
	const [r, g, b] = parseColor(color);
	const gs = alphaState(doc, page, opacity);
	appendContent(
		doc,
		page,
		[
			'q',
			gs ? `/${gs} gs` : '',
			`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
			`${Math.min(x0, x1)} ${Math.min(uy0, uy1)} ${Math.abs(x1 - x0)} ${Math.abs(uy1 - uy0)} re f`,
			'Q'
		]
			.filter(Boolean)
			.join('\n')
	);
}

export type Anchor =
	| 'top-left'
	| 'top-center'
	| 'top-right'
	| 'middle-left'
	| 'center'
	| 'middle-right'
	| 'bottom-left'
	| 'bottom-center'
	| 'bottom-right';

export const ANCHORS: Anchor[] = [
	'top-left',
	'top-center',
	'top-right',
	'middle-left',
	'center',
	'middle-right',
	'bottom-left',
	'bottom-center',
	'bottom-right'
];

/**
 * Resolve an anchor to a text baseline position inside `bounds`, in MuPDF
 * page space — so "top" is the SMALLER y.
 */
export function anchorText(
	bounds: mupdf.Rect,
	anchor: Anchor,
	textWidth: number,
	size: number,
	margin: number
): { x: number; y: number } {
	const [x0, y0, x1, y1] = bounds;
	const [vertical, horizontal] = anchor.split('-');
	const width = Math.abs(x1 - x0);
	const height = Math.abs(y1 - y0);

	const x =
		horizontal === 'left'
			? x0 + margin
			: horizontal === 'right'
				? x1 - margin - textWidth
				: x0 + (width - textWidth) / 2;

	const y =
		vertical === 'top'
			? y0 + margin + size
			: vertical === 'bottom'
				? y1 - margin
				: y0 + (height + size) / 2;

	return { x, y };
}
