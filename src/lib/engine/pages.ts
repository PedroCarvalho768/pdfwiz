/**
 * Page-selection maths. Deliberately free of any `mupdf` import: the UI needs
 * to validate a range as the user types, and pulling in the engine to do that
 * would drag a 10 MB WASM binary into the initial bundle.
 */
import { EngineError } from './contract';

/** Expand a 1-based page selection like "1-3,7,12-" into 0-based indices. */
export function parsePageRange(spec: string, pageCount: number): number[] {
	const trimmed = spec.trim();
	if (!trimmed || trimmed.toLowerCase() === 'all')
		return Array.from({ length: pageCount }, (_, i) => i);

	const out: number[] = [];
	for (const part of trimmed.split(',')) {
		const chunk = part.trim();
		if (!chunk) continue;
		const match = /^(\d*)\s*-\s*(\d*)$/.exec(chunk);
		if (match) {
			const from = match[1] ? parseInt(match[1], 10) : 1;
			const to = match[2] ? parseInt(match[2], 10) : pageCount;
			if (from > to)
				throw new EngineError(`Intervalo inválido "${chunk}": o início vem depois do fim`);
			for (let p = from; p <= to; p++) out.push(p - 1);
		} else if (/^\d+$/.test(chunk)) {
			out.push(parseInt(chunk, 10) - 1);
		} else {
			throw new EngineError(`Não entendi a seleção de páginas "${chunk}"`);
		}
	}

	const bad = out.find((i) => i < 0 || i >= pageCount);
	if (bad !== undefined)
		throw new EngineError(
			`A página ${bad + 1} está fora do intervalo (o documento tem ${pageCount})`
		);
	if (out.length === 0) throw new EngineError('Essa seleção não corresponde a nenhuma página');
	return out;
}

/**
 * Each comma-separated group becomes its own output file, so "1-3,4-6" splits
 * into two documents rather than one of six pages.
 */
export function parseRangeGroups(spec: string, pageCount: number): number[][] {
	const groups = spec
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	if (groups.length === 0) throw new EngineError('Informe pelo menos um intervalo de páginas');
	return groups.map((group) => parsePageRange(group, pageCount));
}

/** Split every `size` pages into a separate document. */
export function chunkPages(pageCount: number, size: number): number[][] {
	if (!Number.isInteger(size) || size < 1)
		throw new EngineError('Páginas por arquivo deve ser no mínimo 1');
	const out: number[][] = [];
	for (let start = 0; start < pageCount; start += size)
		out.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, i) => start + i));
	return out;
}

/** Human-readable label for a contiguous-ish selection, e.g. "1-3" or "2,5". */
export function describeSelection(pages: number[]): string {
	if (pages.length === 0) return 'empty';
	const parts: string[] = [];
	let start = pages[0];
	let previous = pages[0];

	for (const page of pages.slice(1)) {
		if (page === previous + 1) {
			previous = page;
			continue;
		}
		parts.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`);
		start = previous = page;
	}
	parts.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`);
	return parts.join(',');
}
