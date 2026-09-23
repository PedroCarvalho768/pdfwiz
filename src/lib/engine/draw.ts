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
 * Page space is also what the viewer shows: it already accounts for /Rotate
 * and for a CropBox or MediaBox that does not start at 0,0. So the mapping
 * is not a plain y-flip; it is the inverse of `page.getTransform()` (user
 * space to page space). `toUser` below is the ONLY place the two meet, and
 * every stamp is drawn through it, which also keeps text upright on a
 * rotated page. Getting this wrong does not error: it silently draws in the
 * wrong place, which is why the tests assert on position, not presence.
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
 * WinAnsi bytes 0x80-0x9F, which is where it departs from Latin-1: Latin-1
 * puts invisible C1 controls there, WinAnsi puts typographic punctuation.
 */
const WIN_ANSI_HIGH: Record<number, number> = {
	0x20ac: 0x80,
	0x201a: 0x82,
	0x0192: 0x83,
	0x201e: 0x84,
	0x2026: 0x85,
	0x2020: 0x86,
	0x2021: 0x87,
	0x02c6: 0x88,
	0x2030: 0x89,
	0x0160: 0x8a,
	0x2039: 0x8b,
	0x0152: 0x8c,
	0x017d: 0x8e,
	0x2018: 0x91,
	0x2019: 0x92,
	0x201c: 0x93,
	0x201d: 0x94,
	0x2022: 0x95,
	0x2013: 0x96,
	0x2014: 0x97,
	0x02dc: 0x98,
	0x2122: 0x99,
	0x0161: 0x9a,
	0x203a: 0x9b,
	0x0153: 0x9c,
	0x017e: 0x9e,
	0x0178: 0x9f
};

/** The WinAnsi byte for a codepoint, or null if the encoding has no glyph for it. */
function winAnsi(code: number): number | null {
	if (code >= 0x20 && code < 0x7f) return code;
	if (code >= 0xa0 && code <= 0xff) return code;
	return WIN_ANSI_HIGH[code] ?? null;
}

/**
 * Encode a string as a PDF literal in WinAnsi, the encoding `drawText`
 * registers its base-14 fonts with. A character WinAnsi cannot represent,
 * control characters included, becomes "?" rather than a byte that would
 * draw some other glyph.
 */
export function pdfString(text: string): string {
	let out = '';
	for (const char of text) {
		const byte = winAnsi(char.codePointAt(0)!);
		if (byte === null) out += '?';
		else if (char === '(' || char === ')' || char === '\\') out += '\\' + char;
		else if (byte < 0x7f) out += char;
		else out += '\\' + byte.toString(8).padStart(3, '0');
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

/** MuPDF page space to PDF user space for this page. */
const toUser = (page: mupdf.PDFPage): mupdf.Matrix => mupdf.Matrix.invert(page.getTransform());

/** `local`, then page space to user space, as a content-stream `cm` operator. */
const cm = (page: mupdf.PDFPage, local: mupdf.Matrix) =>
	`${mupdf.Matrix.concat(local, toUser(page))
		.map((n) => +n.toFixed(5))
		.join(' ')} cm`;

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

/**
 * The first stream of a Contents array we have already isolated. Recognised
 * by content, not by a private key on the page: MuPDF operations such as
 * `applyRedactions` rewrite /Contents into a single stream, and a key would
 * survive that and claim an isolation that no longer exists.
 */
const ISOLATION_OPEN = 'q % pdfwiz: isolates the original content\n';

function isIsolated(contents: mupdf.PDFObject): boolean {
	if (!contents.isArray() || contents.length < 2) return false;
	const first = contents.get(0);
	return first.isStream() && first.readStream().asString() === ISOLATION_OPEN;
}

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
	// Files written by an earlier version carry this key; it means nothing now.
	pageObj.delete('PWIsolated');

	if (existing.isNull()) {
		pageObj.put('Contents', stream);
		return;
	}

	// Always build a new array rather than pushing onto the existing one: a
	// direct array can be shared by several page dictionaries in memory.
	const next = doc.newArray();
	if (isIsolated(existing)) {
		existing.forEach((part) => next.push(part));
	} else {
		next.push(doc.addStream(ISOLATION_OPEN, null));
		if (existing.isArray()) existing.forEach((part) => next.push(part));
		else next.push(existing);
		next.push(doc.addStream('\nQ\n', null));
	}
	next.push(stream);
	pageObj.put('Contents', next);
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
	const radians = (rotate * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	// Glyph space runs y up and page space y down. Rotate counter-clockwise
	// as the viewer sees it, about the anchor, then map into user space.
	const parts = [
		'q',
		gs ? `/${gs} gs` : '',
		`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
		cm(page, [cos, -sin, -sin, -cos, x, y]),
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

	appendContent(
		doc,
		page,
		[
			'q',
			gs ? `/${gs} gs` : '',
			// An image XObject fills the unit square with y up, so its bottom
			// edge (v = 0) goes to the lower edge of the box in page space.
			cm(page, [width, 0, 0, -height, x, y + height]),
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
	const [r, g, b] = parseColor(color);
	const gs = alphaState(doc, page, opacity);
	appendContent(
		doc,
		page,
		[
			'q',
			gs ? `/${gs} gs` : '',
			`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
			// The rectangle stays in page space; the CTM maps it.
			cm(page, mupdf.Matrix.identity),
			`${Math.min(x0, x1)} ${Math.min(y0, y1)} ${Math.abs(x1 - x0)} ${Math.abs(y1 - y0)} re f`,
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
