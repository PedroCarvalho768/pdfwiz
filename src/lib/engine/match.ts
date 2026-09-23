/**
 * Tolerant text matching for redaction. Deliberately free of any mupdf import
 * (like pages.ts) so it is testable as plain data.
 *
 * MuPDF's own search is literal: case, accents, line breaks and hyphenation
 * all defeat it, so "joão da silva" misses "JOÃO DA\nSILVA". This walks the
 * page's glyphs instead, matches on a normalised copy and maps every hit back
 * to the glyphs it covers.
 *
 * Redaction destroys text for good, so only whole-word exact matches are
 * proposed as checked. Partial and similar matches are surfaced for review,
 * never applied by default.
 */

/** A glyph as structured text reports it, in MuPDF page space (y down). */
export interface Glyph {
	c: string;
	/** Bounding box of the glyph. */
	rect: Rect;
	/** Increments per text line, so matches can be split into one box per line. */
	line: number;
}

export type Rect = [number, number, number, number];

/**
 * - `exact`: every word matches, ignoring case and accents. Proposed checked.
 * - `partial`: the text occurs inside a longer word ("Silva" in "Silvana").
 * - `similar`: within a small edit distance (typos, OCR noise).
 */
export type MatchKind = 'exact' | 'partial' | 'similar';

export type MatchMode = 'text' | 'digits';

export interface Match {
	page: number;
	kind: MatchKind;
	/** The matched text as it appears on the page. */
	text: string;
	before: string;
	after: string;
	/** One box per line the match spans; never one box around several lines. */
	rects: Rect[];
}

interface Index {
	/** Normalised searchable text. */
	text: string;
	/** For each character of `text`, the glyph it came from. */
	glyphOf: number[];
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string) => /\s/u.test(c);
const HYPHENS = new Set(['-', '­', '‐', '‑']);

/**
 * Normalised text plus a map back to glyphs. Whitespace runs and line breaks
 * collapse to one space; a hyphen that ends a line is dropped so "exem-/plo"
 * matches "exemplo". In digits mode everything but digits is dropped, so
 * "123.456.789-00" matches "12345678900".
 */
export function buildIndex(glyphs: Glyph[], mode: MatchMode = 'text'): Index {
	let text = '';
	const glyphOf: number[] = [];
	const push = (s: string, g: number) => {
		for (const ch of s) {
			text += ch;
			glyphOf.push(g);
		}
	};

	for (let i = 0; i < glyphs.length; i++) {
		const g = glyphs[i];
		const next = glyphs[i + 1];
		const lineBreak = next !== undefined && next.line !== g.line;

		if (mode === 'digits') {
			if (/\p{N}/u.test(g.c)) push(fold(g.c), i);
			continue;
		}
		if (HYPHENS.has(g.c) && lineBreak && isWordChar(glyphs[i - 1]?.c) && isWordChar(next?.c))
			continue;
		if (isSpace(g.c)) {
			if (!text.endsWith(' ') && text.length) push(' ', i);
		} else {
			push(fold(g.c), i);
		}
		if (lineBreak && !HYPHENS.has(g.c) && !text.endsWith(' ')) push(' ', i);
	}
	return { text, glyphOf };
}

export function normaliseQuery(query: string, mode: MatchMode = 'text'): string {
	if (mode === 'digits') return fold(query).replace(/\P{N}/gu, '');
	return fold(query).replace(/\s+/gu, ' ').trim();
}

/** Classic Levenshtein, bounded: returns `max + 1` as soon as it cannot fit. */
export function editDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
			best = Math.min(best, row[j]);
		}
		if (best > max) return max + 1;
		prev = row;
	}
	return prev[b.length];
}

/** Typos worth offering scale with length; short needles get no slack at all. */
const tolerance = (length: number) => (length < 5 ? 0 : length < 9 ? 1 : 2);

/** Character spans [start, end) in `index.text`. */
function findSpans(index: Index, needle: string, mode: MatchMode) {
	const spans: { start: number; end: number; kind: MatchKind }[] = [];
	if (!needle) return spans;
	const { text } = index;

	for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
		const end = at + needle.length;
		const whole = mode === 'digits' || (!isWordChar(text[at - 1]) && !isWordChar(text[end]));
		spans.push({ start: at, end, kind: whole ? 'exact' : 'partial' });
	}

	const slack = mode === 'text' ? tolerance(needle.length) : 0;
	if (slack === 0) return spans;

	// Similar: compare windows of as many words as the needle has.
	const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
		start: m.index,
		end: m.index + m[0].length
	}));
	const wordsOnly = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	const target = wordsOnly(needle);
	const count = target.split(' ').length;
	const taken = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
	for (let w = 0; w + count <= words.length; w++) {
		const start = words[w].start;
		const end = words[w + count - 1].end;
		if (taken(start, end)) continue;
		if (editDistance(wordsOnly(text.slice(start, end)), target, slack) <= slack)
			spans.push({ start, end, kind: 'similar' });
	}
	return spans.sort((a, b) => a.start - b.start);
}

function unionByLine(glyphs: Glyph[], from: number, to: number): Rect[] {
	const byLine = new Map<number, Rect>();
	for (let i = from; i <= to; i++) {
		const { line, rect } = glyphs[i];
		if (isSpace(glyphs[i].c)) continue;
		const r = byLine.get(line);
		byLine.set(
			line,
			r
				? [
						Math.min(r[0], rect[0]),
						Math.min(r[1], rect[1]),
						Math.max(r[2], rect[2]),
						Math.max(r[3], rect[3])
					]
				: [...rect]
		);
	}
	return [...byLine.values()];
}

const CONTEXT = 32;

export function findMatches(
	page: number,
	glyphs: Glyph[],
	query: string,
	mode: MatchMode = 'text'
): Match[] {
	const index = buildIndex(glyphs, mode);
	const needle = normaliseQuery(query, mode);
	const chars = (from: number, to: number) => {
		let out = '';
		for (let i = Math.max(0, from); i < Math.min(to, glyphs.length); i++) {
			const prev = glyphs[i - 1];
			if (i > from && prev && prev.line !== glyphs[i].line && !HYPHENS.has(prev.c)) out += ' ';
			out += glyphs[i].c;
		}
		return out.replace(/\s+/gu, ' ');
	};

	return findSpans(index, needle, mode).map(({ start, end, kind }) => {
		const from = index.glyphOf[start];
		const to = index.glyphOf[end - 1];
		return {
			page,
			kind,
			text: chars(from, to + 1).trim(),
			before: chars(from - CONTEXT, from).trimStart(),
			after: chars(to + 1, to + 1 + CONTEXT).trimEnd(),
			rects: unionByLine(glyphs, from, to)
		};
	});
}
