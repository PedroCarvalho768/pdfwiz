import { describe, expect, it } from 'vitest';
import { handlers } from './index';
import { testContext, textOf } from './testing';

const openText = (text: string) => {
	const { ctx } = testContext();
	const doc = handlers.open(ctx, { bytes: new TextEncoder().encode(text), magic: 'text/plain' });
	return { ctx, handle: doc.handle };
};

describe('findMatches', () => {
	it('finds a name regardless of case and accents on a real page', () => {
		const { ctx, handle } = openText('Assinado por JOÃO DA SILVA em São Paulo.\n');
		const matches = handlers.findMatches(ctx, { handle, query: 'joao da silva' });
		expect(matches.map((m) => [m.kind, m.text])).toEqual([['exact', 'JOÃO DA SILVA']]);
		expect(matches[0].rects).toHaveLength(1);
	});

	it('matches CPFs by digits whatever the punctuation', () => {
		const { ctx, handle } = openText('CPF 123.456.789-00 ou 12345678900.\n');
		const matches = handlers.findMatches(ctx, { handle, query: '123.456.789-00', mode: 'digits' });
		expect(matches).toHaveLength(2);
	});

	it('is not capped per page like MuPDF search', () => {
		const { ctx, handle } = openText(Array.from({ length: 900 }, () => 'zq').join(' ') + '\n');
		expect(handlers.findMatches(ctx, { handle, query: 'zq' }).length).toBe(900);
	});

	it('its rectangles redact exactly the match and leave the source intact', () => {
		const { ctx, handle } = openText('Cliente Pedro Alves assina aqui.\n');
		const [m] = handlers.findMatches(ctx, { handle, query: 'pedro alves' });
		const out = handlers.redact(ctx, {
			handle,
			areas: m.rects.map((rect) => ({ page: m.page, rect }))
		});
		const text = textOf(out.bytes, 0);
		expect(text).not.toMatch(/Pedro|Alves/);
		expect(text).toContain('Cliente');
		expect(text).toContain('assina aqui');
		// Redaction works on a copy: the open document can be reviewed again.
		expect(handlers.findMatches(ctx, { handle, query: 'pedro alves' })).toHaveLength(1);
	});
});
