/**
 * Engine tests run in plain Node — the same `mupdf` package the browser
 * worker uses. No jsdom, no browser, no mocks of the PDF engine itself.
 *
 * Assertions are always made by re-opening the produced bytes and inspecting
 * the result. Never assert on byte equality: MuPDF output is not reproducible
 * across versions and such a test only measures the library's version number.
 */
import { describe, expect, it } from 'vitest';
import { handlers } from './index';
import { fixture, pageCountOf, testContext, textOf } from './testing';

const encode = (s: string) => new TextEncoder().encode(s);
import type { RenderedPage } from '../contract';

// ---------------------------------------------------------------------------

describe('open', () => {
	it('converts a non-PDF format into a usable PDF object model', () => {
		const { ctx } = testContext();
		const info = handlers.open(ctx, { bytes: encode('# Markdown Title'), magic: 'text/markdown' });
		expect(info.pageCount).toBeGreaterThan(0);
		expect(handlers.extractText(ctx, { handle: info.handle })).toContain('Markdown Title');
	});

	it('reports page geometry and rotation', () => {
		const { ctx } = testContext();
		const info = fixture(ctx, ['Alpha']);
		expect(info.pages[0].width).toBeGreaterThan(0);
		expect(info.pages[0].rotation).toBe(0);
	});

	it('refuses a password-protected file without a password', () => {
		const { ctx } = testContext();
		const info = fixture(ctx, ['Secret']);
		const locked = handlers.save(ctx, {
			handle: info.handle,
			options: 'encrypt=aes-256,user-password=hunter2'
		}).bytes;

		expect(() => handlers.open(ctx, { bytes: locked, magic: 'application/pdf' })).toThrow(
			/protegido por senha/
		);
		expect(() =>
			handlers.open(ctx, { bytes: locked, magic: 'application/pdf', password: 'wrong' })
		).toThrow(/não foi aceita/);
		expect(
			handlers.open(ctx, { bytes: locked, magic: 'application/pdf', password: 'hunter2' }).pageCount
		).toBe(info.pageCount);
	});

	it('does not lose the last character of markdown without a trailing newline', () => {
		const { ctx } = testContext();
		const info = handlers.open(ctx, { bytes: encode('# Three'), magic: 'text/markdown' });
		expect(handlers.extractText(ctx, { handle: info.handle })).toContain('Three');
	});

	it('surfaces a clear error for unreadable input', () => {
		const { ctx } = testContext();
		expect(() =>
			handlers.open(ctx, { bytes: encode('not a pdf at all'), magic: 'application/pdf' })
		).toThrow(/Não foi possível abrir/);
	});
});

describe('merge', () => {
	it('concatenates documents in the order given', async () => {
		const { ctx } = testContext();
		const a = fixture(ctx, ['Alpha']);
		const b = fixture(ctx, ['Bravo']);

		const out = await handlers.merge(ctx, { handles: [b.handle, a.handle] });
		expect(pageCountOf(out.bytes)).toBe(a.pageCount + b.pageCount);
		expect(textOf(out.bytes, 0)).toContain('Bravo');
		expect(textOf(out.bytes, b.pageCount)).toContain('Alpha');
	});

	it('refuses a merge of fewer than two documents', async () => {
		const { ctx } = testContext();
		const a = fixture(ctx, ['Alpha']);
		await expect(handlers.merge(ctx, { handles: [a.handle] })).rejects.toThrow(/pelo menos dois/);
	});
});

describe('extract', () => {
	it('splits one document into several by page selection', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		expect(doc.pageCount).toBe(3);

		const out = handlers.extract(ctx, {
			handle: doc.handle,
			selections: [
				{ pages: [0, 2], filename: 'odd.pdf' },
				{ pages: [1], filename: 'even.pdf' }
			]
		});

		expect(out.map((f) => f.filename)).toEqual(['odd.pdf', 'even.pdf']);
		expect(pageCountOf(out[0].bytes)).toBe(2);
		expect(textOf(out[0].bytes, 1)).toContain('Three');
		expect(textOf(out[1].bytes, 0)).toContain('Two');
	});
});

describe('organize', () => {
	it('reorders and drops pages according to the submitted order', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);

		const out = handlers.organize(ctx, { handle: doc.handle, order: [2, 0] });
		expect(pageCountOf(out.bytes)).toBe(2);
		expect(textOf(out.bytes, 0)).toContain('Three');
		expect(textOf(out.bytes, 1)).toContain('One');
	});

	it('applies rotation per output position', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);

		const out = handlers.organize(ctx, {
			handle: doc.handle,
			order: [0, 1],
			rotations: [90, 0]
		});

		const reopened = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(reopened.pages[0].rotation).toBe(90);
		expect(reopened.pages[1].rotation).toBe(0);
	});

	it('normalises rotation past a full turn', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const once = handlers.organize(ctx, { handle: doc.handle, order: [0], rotations: [270] });
		const again = handlers.open(ctx, { bytes: once.bytes, magic: 'application/pdf' });
		const twice = handlers.organize(ctx, { handle: again.handle, order: [0], rotations: [180] });

		expect(
			handlers.open(ctx, { bytes: twice.bytes, magic: 'application/pdf' }).pages[0].rotation
		).toBe(90);
	});

	it('refuses to produce a document with no pages', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.organize(ctx, { handle: doc.handle, order: [] })).toThrow(
			/pelo menos uma página/
		);
	});
});

describe('render', () => {
	it('streams one PNG per page instead of batching them', async () => {
		const { ctx, chunks } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);

		await handlers.render(ctx, { handle: doc.handle, width: 100 });

		expect(chunks).toHaveLength(3);
		const first = chunks[0] as RenderedPage;
		expect(first.index).toBe(0);
		expect(first.width).toBe(100);
		// PNG magic number — proves we emitted a real image, not an empty buffer.
		expect(Array.from(first.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('stops early when the job is cancelled', async () => {
		const { ctx, chunks, cancel } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		cancel();

		await expect(handlers.render(ctx, { handle: doc.handle })).rejects.toThrow(
			/Operação cancelada/
		);
		expect(chunks).toHaveLength(0);
	});
});

describe('handle lifecycle', () => {
	it('rejects use of a closed handle', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		handlers.close(ctx, { handle: doc.handle });
		expect(() => handlers.inspect(ctx, { handle: doc.handle })).toThrow(/Documento não encontrado/);
	});
});
