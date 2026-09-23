/** Pure page-selection maths — no engine, no WASM, no browser. */
import { describe, expect, it } from 'vitest';
import { chunkPages, describeSelection, parsePageRange, parseRangeGroups } from './pages';

describe('parsePageRange', () => {
	it('expands mixed ranges and singles to 0-based indices', () => {
		expect(parsePageRange('1-3,7', 10)).toEqual([0, 1, 2, 6]);
	});

	it('treats an open-ended range as running to the last page', () => {
		expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
		expect(parsePageRange('-2', 10)).toEqual([0, 1]);
	});

	it('defaults to every page when empty or "all"', () => {
		expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
		expect(parsePageRange('all', 3)).toEqual([0, 1, 2]);
	});

	it('rejects out-of-range pages rather than silently clamping', () => {
		expect(() => parsePageRange('1,99', 10)).toThrow(/fora do intervalo/);
	});

	it('rejects backwards and malformed selections', () => {
		expect(() => parsePageRange('5-2', 10)).toThrow(/o início vem depois do fim/);
		expect(() => parsePageRange('abc', 10)).toThrow(/Não entendi/);
	});

	it('rejects a huge range without expanding it first', () => {
		expect(() => parsePageRange('1-1000000000', 10)).toThrow(/página 1000000000 está fora/);
	});

	it('names the missing page when an open range starts past the end', () => {
		expect(() => parsePageRange('12-', 10)).toThrow(/A página 12 está fora do intervalo/);
	});

	it('accepts the position after the last page only when asked', () => {
		expect(() => parsePageRange('1,4', 3)).toThrow(/fora do intervalo/);
		expect(parsePageRange('1,4', 3, { allowEnd: true })).toEqual([0, 3]);
		expect(parsePageRange('2-', 3, { allowEnd: true })).toEqual([1, 2]);
		expect(() => parsePageRange('5', 3, { allowEnd: true })).toThrow(/fora do intervalo/);
	});
});

describe('parseRangeGroups', () => {
	it('gives each comma-separated group its own output document', () => {
		expect(parseRangeGroups('1-2,5', 10)).toEqual([[0, 1], [4]]);
	});

	it('rejects an empty selection', () => {
		expect(() => parseRangeGroups('  ', 10)).toThrow(/pelo menos um intervalo/);
	});
});

describe('chunkPages', () => {
	it('splits evenly and keeps the short final chunk', () => {
		expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
	});

	it('rejects a chunk size below one', () => {
		expect(() => chunkPages(5, 0)).toThrow(/no mínimo 1/);
	});
});

describe('describeSelection', () => {
	it('collapses runs and keeps gaps separate', () => {
		expect(describeSelection([0, 1, 2, 4])).toBe('1-3,5');
		expect(describeSelection([3])).toBe('4');
		expect(describeSelection([])).toBe('empty');
	});
});
