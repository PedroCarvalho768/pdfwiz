import { describe, expect, it } from 'vitest';
import { editDistance, findMatches, type Glyph } from './match';

/** Lay out lines as glyphs, 10pt wide each, one line per 20pt. */
function page(...lines: string[]): Glyph[] {
	return lines.flatMap((text, line) =>
		[...text].map((c, x) => ({
			c,
			line,
			rect: [x * 10, line * 20, x * 10 + 10, line * 20 + 12] as Glyph['rect']
		}))
	);
}

const kinds = (glyphs: Glyph[], query: string, mode?: 'text' | 'digits') =>
	findMatches(0, glyphs, query, mode).map((m) => [m.kind, m.text]);

describe('findMatches', () => {
	it('ignores case and accents', () => {
		expect(kinds(page('Assinado por JOÃO DA SILVA.'), 'joao da silva')).toEqual([
			['exact', 'JOÃO DA SILVA']
		]);
	});

	it('matches across a line break with one box per line', () => {
		const [m] = findMatches(0, page('Contrato de João da', 'Silva, residente'), 'joão da silva');
		expect(m.kind).toBe('exact');
		expect(m.text).toBe('João da Silva');
		expect(m.rects).toHaveLength(2);
		expect(m.rects[0][1]).toBe(0);
		expect(m.rects[1][1]).toBe(20);
		// The second box covers "Silva" only, not the rest of the line.
		expect(m.rects[1][2]).toBe(50);
	});

	it('rejoins a word hyphenated across lines', () => {
		expect(kinds(page('um exem-', 'plo claro'), 'exemplo')).toEqual([['exact', 'exem-plo']]);
	});

	it('flags a match inside a longer word as partial, never exact', () => {
		expect(kinds(page('Silva e Silvana'), 'silva')).toEqual([
			['exact', 'Silva'],
			['partial', 'Silva']
		]);
	});

	it('offers typos as similar', () => {
		expect(kinds(page('Assinado: Joao da Sliva'), 'joão da silva')).toEqual([
			['similar', 'Joao da Sliva']
		]);
	});

	it('gives short needles no slack', () => {
		expect(kinds(page('Ana e Ano'), 'ana')).toEqual([['exact', 'Ana']]);
	});

	it('matches documents regardless of punctuation in digits mode', () => {
		expect(kinds(page('CPF 123.456.789-00 e 12345678900'), '123 456 789 00', 'digits')).toEqual([
			['exact', '123.456.789-00'],
			['exact', '12345678900']
		]);
	});

	it('reports context around the hit', () => {
		const [m] = findMatches(0, page('O cliente Pedro assina aqui'), 'pedro');
		expect(m.before).toBe('O cliente ');
		expect(m.after).toBe(' assina aqui');
	});

	it('finds nothing for an empty query', () => {
		expect(findMatches(0, page('abc'), '   ')).toEqual([]);
	});
});

describe('editDistance', () => {
	it('is bounded', () => {
		expect(editDistance('silva', 'sliva', 2)).toBe(2);
		expect(editDistance('silva', 'xxxxxxxx', 1)).toBe(2);
	});
});
