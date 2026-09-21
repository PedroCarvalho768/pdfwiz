/**
 * Behavioural tests for every job, in plain Node.
 *
 * Assertions always re-open the produced bytes. Never assert on byte
 * equality: MuPDF output is not reproducible across versions, so such a test
 * only measures the library's version number.
 */
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { handlers } from './index';
import { testContext, fixture, multiPagePdf, openBytes, pageCountOf, textOf } from './testing';

const encode = (s: string) => new TextEncoder().encode(s);

describe('rotate / reverse / duplicate', () => {
	it('rotates only the selected pages', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const out = handlers.rotate(ctx, { handle: doc.handle, degrees: 90, pages: [1] });

		const back = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(back.pages[0].rotation).toBe(0);
		expect(back.pages[1].rotation).toBe(90);
	});

	it('reverses page order', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		const out = handlers.reverse(ctx, { handle: doc.handle });
		expect(textOf(out.bytes, 0)).toContain('Three');
		expect(textOf(out.bytes, 2)).toContain('One');
	});

	it('repeats the document the requested number of times', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		expect(pageCountOf(handlers.duplicate(ctx, { handle: doc.handle, times: 3 }).bytes)).toBe(6);
	});

	it('rejects a copy count below one', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.duplicate(ctx, { handle: doc.handle, times: 0 })).toThrow(/no mínimo 1/);
	});
});

describe('crop / resize / nup / booklet', () => {
	it('insets the crop box by the given percentages', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const original = doc.pages[0];

		const out = handlers.crop(ctx, {
			handle: doc.handle,
			top: 10,
			right: 10,
			bottom: 10,
			left: 10
		});
		const cropped = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(cropped.pages[0].width).toBeCloseTo(original.width * 0.8, 1);
		expect(cropped.pages[0].height).toBeCloseTo(original.height * 0.8, 1);
	});

	it('rejects a margin that would collapse the page', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() =>
			handlers.crop(ctx, { handle: doc.handle, top: 60, right: 0, bottom: 0, left: 0 })
		).toThrow(/entre 0% e 49%/);
	});

	it('scales pages onto a standard size', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const out = handlers.resize(ctx, { handle: doc.handle, size: 'A4' });
		const resized = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(resized.pages[0].width).toBeCloseTo(595.28, 0);
		expect(resized.pages[0].height).toBeCloseTo(841.89, 0);
	});

	it('rejects an unknown page size', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.resize(ctx, { handle: doc.handle, size: 'A9' })).toThrow(
			/Tamanho de papel desconhecido/
		);
	});

	it('packs pages onto fewer sheets and keeps their text', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three', 'Four', 'Five']);
		const out = handlers.nup(ctx, { handle: doc.handle, columns: 2, rows: 2 });
		// Five pages, four per sheet, so two sheets.
		expect(pageCountOf(out.bytes)).toBe(2);
		const first = textOf(out.bytes, 0);
		for (const marker of ['One', 'Two', 'Three', 'Four']) expect(first).toContain(marker);
	});

	it('pads a booklet to a multiple of four sheets', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		// Three pages pad to four, two per sheet side => two sheets.
		expect(pageCountOf(handlers.booklet(ctx, { handle: doc.handle }).bytes)).toBe(2);
	});
});

describe('interleave / overlay / insertBlank', () => {
	it('alternates pages from two documents', () => {
		const { ctx } = testContext();
		const front = fixture(ctx, ['A1', 'A2']);
		const back = fixture(ctx, ['B1', 'B2']);
		const out = handlers.interleave(ctx, { handles: [front.handle, back.handle] });

		expect(pageCountOf(out.bytes)).toBe(4);
		expect(textOf(out.bytes, 0)).toContain('A1');
		expect(textOf(out.bytes, 1)).toContain('B1');
	});

	it('reverses the second document when the back side was scanned backwards', () => {
		const { ctx } = testContext();
		const front = fixture(ctx, ['A1', 'A2']);
		const back = fixture(ctx, ['B2', 'B1']);
		const out = handlers.interleave(ctx, {
			handles: [front.handle, back.handle],
			reverseSecond: true
		});
		expect(textOf(out.bytes, 1)).toContain('B1');
		expect(textOf(out.bytes, 3)).toContain('B2');
	});

	it('draws a stamp onto every page', () => {
		const { ctx } = testContext();
		const base = fixture(ctx, ['Base1', 'Base2']);
		const stamp = fixture(ctx, ['STAMPED']);
		const out = handlers.overlay(ctx, { handle: base.handle, stampHandle: stamp.handle });

		expect(pageCountOf(out.bytes)).toBe(2);
		expect(textOf(out.bytes, 0)).toContain('STAMPED');
		expect(textOf(out.bytes, 1)).toContain('STAMPED');
		expect(textOf(out.bytes, 1)).toContain('Base2');
	});

	it('inserts blank pages at the requested positions', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const out = handlers.insertBlank(ctx, { handle: doc.handle, at: [0, 3] });

		expect(pageCountOf(out.bytes)).toBe(4);
		expect(textOf(out.bytes, 0).trim()).toBe('');
		expect(textOf(out.bytes, 1)).toContain('One');
		expect(textOf(out.bytes, 3).trim()).toBe('');
	});
});

describe('security', () => {
	it('round-trips an encrypted document through its password', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Secret']);
		const locked = handlers.protect(ctx, { handle: doc.handle, userPassword: 'hunter2' });

		expect(() => handlers.open(ctx, { bytes: locked.bytes, magic: 'application/pdf' })).toThrow(
			/protegido por senha/
		);
		const opened = handlers.open(ctx, {
			bytes: locked.bytes,
			magic: 'application/pdf',
			password: 'hunter2'
		});
		expect(opened.encrypted).toBe(true);
	});

	it('removes the password once the document is open', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Secret']);
		const locked = handlers.protect(ctx, { handle: doc.handle, userPassword: 'hunter2' }).bytes;
		const reopened = handlers.open(ctx, {
			bytes: locked,
			magic: 'application/pdf',
			password: 'hunter2'
		});

		const unlocked = handlers.unlock(ctx, { handle: reopened.handle }).bytes;
		expect(openBytes(unlocked).needsPassword()).toBe(false);
		expect(handlers.open(ctx, { bytes: unlocked, magic: 'application/pdf' }).encrypted).toBe(false);
	});

	it('refuses to protect a document with no password at all', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.protect(ctx, { handle: doc.handle })).toThrow(/Defina uma senha/);
	});

	it('applies permission restrictions', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const locked = handlers.protect(ctx, {
			handle: doc.handle,
			ownerPassword: 'owner',
			permissions: { print: true }
		}).bytes;

		const reopened = handlers.open(ctx, { bytes: locked, magic: 'application/pdf' });
		const perms = handlers.permissions(ctx, { handle: reopened.handle });
		expect(perms.print).toBe(true);
		expect(perms.copy).toBe(false);
	});

	/**
	 * The single most important test in the suite. A redaction that leaves
	 * the text extractable is a security failure, not a rendering glitch.
	 */
	it('really removes redacted text rather than covering it', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['TOPSECRET']);
		const page = doc.pages[0];

		const out = handlers.redact(ctx, {
			handle: doc.handle,
			areas: [{ page: 0, rect: [0, 0, page.width, page.height] }]
		});

		expect(textOf(out.bytes, 0)).not.toContain('TOPSECRET');
	});

	it('refuses an empty redaction rather than pretending it worked', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.redact(ctx, { handle: doc.handle, areas: [] })).toThrow(
			/pelo menos uma área/
		);
	});

	it('strips metadata when sanitising', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		handlers.setMetadata(ctx, { handle: doc.handle, values: { Author: 'Leaky Name' } });
		expect(handlers.metadata(ctx, { handle: doc.handle }).Author).toBe('Leaky Name');

		const out = handlers.sanitize(ctx, { handle: doc.handle });
		const clean = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(handlers.metadata(ctx, { handle: clean.handle }).Author).toBe('');
	});

	it('produces a file that no longer opens, and repairs one that does', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);

		const broken = handlers.corrupt(ctx, { handle: doc.handle }).bytes;
		expect(() => openBytes(broken).countPages()).toThrow();

		// Repair works on a document that opened but needed rebuilding.
		const repaired = handlers.repair(ctx, { handle: doc.handle });
		expect(pageCountOf(repaired.file.bytes)).toBe(2);
		expect(typeof repaired.wasRepaired).toBe('boolean');
	});
});

describe('convert', () => {
	it('renders pages to PNG at the requested resolution', async () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const files = await handlers.toImages(ctx, { handle: doc.handle, dpi: 72 });

		expect(files).toHaveLength(2);
		expect(files[0].filename).toBe('page-1.png');
		expect(Array.from(files[0].bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('renders JPEG when asked', async () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const [file] = await handlers.toImages(ctx, { handle: doc.handle, format: 'jpeg', dpi: 72 });
		expect(file.filename).toBe('page-1.jpg');
		expect(Array.from(file.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
	});

	it('rejects an absurd resolution instead of exhausting memory', async () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		await expect(handlers.toImages(ctx, { handle: doc.handle, dpi: 5000 })).rejects.toThrow(
			/entre 10 e 600/
		);
	});

	it('exports text with a page separator', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const text = new TextDecoder().decode(handlers.toText(ctx, { handle: doc.handle }).bytes);
		expect(text).toContain('One');
		expect(text).toContain('\f');
	});

	it('exports HTML and SVG', async () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Hello']);
		const html = new TextDecoder().decode(handlers.toHtml(ctx, { handle: doc.handle }).bytes);
		expect(html).toContain('<!doctype html>');
		expect(html).toContain('Hello');

		const svg = await handlers.toSvg(ctx, { handle: doc.handle });
		expect(svg).toHaveLength(1);
		expect(new TextDecoder().decode(svg[0].bytes)).toContain('<svg');
	});

	it('exports structured text with positions', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Hello']);
		const [page] = handlers.toStructured(ctx, { handle: doc.handle });
		expect((page.data as { blocks: unknown[] }).blocks.length).toBeGreaterThan(0);
	});
});

describe('edit', () => {
	it('stamps a watermark that lands in the text layer', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const out = handlers.watermark(ctx, { handle: doc.handle, text: 'CONFIDENTIAL' });
		expect(textOf(out.bytes, 0)).toContain('CONFIDENTIAL');
		expect(textOf(out.bytes, 1)).toContain('CONFIDENTIAL');
	});

	it('keeps the original page content when stamping', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['KeepMe']);
		const out = handlers.watermark(ctx, { handle: doc.handle, text: 'DRAFT' });
		expect(textOf(out.bytes, 0)).toContain('KeepMe');
	});

	it('rejects an empty watermark', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.watermark(ctx, { handle: doc.handle, text: '  ' })).toThrow(
			/Digite o texto da marca/
		);
	});

	it('numbers pages from the chosen start', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const out = handlers.pageNumbers(ctx, {
			handle: doc.handle,
			template: 'Page {n} of {total}',
			startAt: 5
		});
		expect(textOf(out.bytes, 0)).toContain('Page 5 of 2');
		expect(textOf(out.bytes, 1)).toContain('Page 6 of 2');
	});

	/**
	 * Presence alone would pass even if every stamp landed upside down, so
	 * assert vertical position: this is the regression guard for the page
	 * space / user space flip documented in draw.ts.
	 */
	it('puts a top anchor above a bottom anchor', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);

		const withTop = handlers.headerFooter(ctx, {
			handle: doc.handle,
			text: 'TOPMARK',
			anchor: 'top-left'
		});
		const reopened = handlers.open(ctx, { bytes: withTop.bytes, magic: 'application/pdf' });
		const both = handlers.headerFooter(ctx, {
			handle: reopened.handle,
			text: 'BOTTOMMARK',
			anchor: 'bottom-left'
		});

		const final = handlers.open(ctx, { bytes: both.bytes, magic: 'application/pdf' });
		const lines = handlers.textLines(ctx, { handle: final.handle, page: 0 });
		const top = lines.find((l) => l.text.includes('TOPMARK'));
		const bottom = lines.find((l) => l.text.includes('BOTTOMMARK'));

		expect(top).toBeDefined();
		expect(bottom).toBeDefined();
		// Page space: down is larger y.
		expect(top!.baseline[1]).toBeLessThan(bottom!.baseline[1]);
		expect(top!.baseline[1]).toBeLessThan(doc.pages[0].height / 2);
		expect(bottom!.baseline[1]).toBeGreaterThan(doc.pages[0].height / 2);
	});

	it('adds a header', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const out = handlers.headerFooter(ctx, { handle: doc.handle, text: 'ACME Corp' });
		expect(textOf(out.bytes, 0)).toContain('ACME Corp');
	});

	it('preserves accented characters through the WinAnsi encoder', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const out = handlers.headerFooter(ctx, { handle: doc.handle, text: 'Ação Não Português' });
		expect(textOf(out.bytes, 0)).toContain('Ação Não Português');
	});

	it('escapes parentheses rather than breaking the content stream', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const out = handlers.headerFooter(ctx, { handle: doc.handle, text: 'a (b) \\ c' });
		expect(textOf(out.bytes, 0)).toContain('a (b) \\ c');
		// The original content must survive an injected-looking string.
		expect(textOf(out.bytes, 0)).toContain('Body');
	});

	it('lists text lines with page geometry', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['FindMe']);
		const lines = handlers.textLines(ctx, { handle: doc.handle, page: 0 });

		const line = lines.find((l) => l.text.includes('FindMe'));
		expect(line).toBeDefined();
		// Page space: the heading is near the top, so y is small.
		expect(line!.baseline[1]).toBeLessThan(doc.pages[0].height / 2);
		expect(line!.rect[3]).toBeGreaterThan(line!.rect[1]);
		expect(line!.size).toBeGreaterThan(0);
	});

	it('replaces text: the old string goes, the new one appears', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['OldWord']);
		const line = handlers
			.textLines(ctx, { handle: doc.handle, page: 0 })
			.find((l) => l.text.includes('OldWord'))!;

		const out = handlers.replaceText(ctx, {
			handle: doc.handle,
			edits: [
				{
					page: 0,
					rect: line.rect,
					baseline: line.baseline,
					text: 'NewWord',
					size: line.size
				}
			]
		});

		const text = textOf(out.bytes, 0);
		expect(text).toContain('NewWord');
		expect(text).not.toContain('OldWord');
	});

	it('flattens without losing the page', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const out = handlers.flatten(ctx, { handle: doc.handle });
		expect(pageCountOf(out.bytes)).toBe(1);
	});
});

describe('forms', () => {
	/** Build a document with one text widget, using MuPDF directly. */
	function formDoc() {
		const doc = new mupdf.PDFDocument();
		doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, doc.newDictionary(), ''));
		const page = doc.loadPage(0);
		const widget = page.createAnnotation('Widget');
		widget.setRect([10, 10, 200, 40]);
		const obj = widget.getObject();
		obj.put('FT', doc.newName('Tx'));
		obj.put('T', doc.newString('fullName'));
		obj.put('V', doc.newString(''));
		widget.update();
		return doc.saveToBuffer('').asUint8Array();
	}

	it('lists and fills a text field', () => {
		const { ctx } = testContext();
		const doc = handlers.open(ctx, { bytes: formDoc(), magic: 'application/pdf' });

		const fields = handlers.formFields(ctx, { handle: doc.handle });
		expect(fields.map((f) => f.name)).toContain('fullName');

		const out = handlers.fillForm(ctx, {
			handle: doc.handle,
			values: { fullName: 'Ada Lovelace' }
		});
		const filled = handlers.open(ctx, { bytes: out.bytes, magic: 'application/pdf' });
		expect(
			handlers.formFields(ctx, { handle: filled.handle }).find((f) => f.name === 'fullName')?.value
		).toBe('Ada Lovelace');
	});

	it('names the field that does not exist instead of failing silently', () => {
		const { ctx } = testContext();
		const doc = handlers.open(ctx, { bytes: formDoc(), magic: 'application/pdf' });
		expect(() => handlers.fillForm(ctx, { handle: doc.handle, values: { nope: 'x' } })).toThrow(
			/não tem o campo nope/
		);
	});

	it('flattening a filled form keeps the value as page text', () => {
		const { ctx } = testContext();
		const doc = handlers.open(ctx, { bytes: formDoc(), magic: 'application/pdf' });
		const out = handlers.fillForm(ctx, {
			handle: doc.handle,
			values: { fullName: 'Ada Lovelace' },
			flatten: true
		});
		expect(textOf(out.bytes, 0)).toContain('Ada Lovelace');
	});
});

describe('extract', () => {
	it('reports document structure', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const report = handlers.report(ctx, { handle: doc.handle });

		expect(report.pageCount).toBe(2);
		expect(report.encrypted).toBe(false);
		expect(report.pageSizes).toHaveLength(2);
		expect(report.hasJavaScript).toBe(false);
	});

	it('reads and writes metadata', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		handlers.setMetadata(ctx, {
			handle: doc.handle,
			values: { Title: 'My Report', Author: 'Ada' }
		});
		const meta = handlers.metadata(ctx, { handle: doc.handle });
		expect(meta.Title).toBe('My Report');
		expect(meta.Author).toBe('Ada');
	});

	it('finds text and returns a rectangle per hit', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Needle', 'Haystack']);
		const hits = handlers.search(ctx, { handle: doc.handle, needle: 'Needle' });

		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].page).toBe(0);
		expect(hits[0].rect[2]).toBeGreaterThan(hits[0].rect[0]);
	});

	it('returns nothing for an empty search rather than every page', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(handlers.search(ctx, { handle: doc.handle, needle: '' })).toEqual([]);
	});

	it('extracts embedded images', async () => {
		const { ctx } = testContext();
		// A PDF built from a PNG contains exactly that image.
		const png = multiPagePdf(['One']);
		const doc = handlers.open(ctx, { bytes: png, magic: 'application/pdf' });
		const raster = handlers.rasterize(ctx, { handle: doc.handle, dpi: 72 });
		const withImage = handlers.open(ctx, { bytes: raster.bytes, magic: 'application/pdf' });

		const images = await handlers.extractImages(ctx, { handle: withImage.handle });
		expect(images.length).toBeGreaterThan(0);
		expect(Array.from(images[0].bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});
});

describe('optimize', () => {
	it('reports before and after sizes', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		const result = handlers.compress(ctx, { handle: doc.handle, level: 'lossless' });

		expect(result.before).toBeGreaterThan(0);
		expect(result.after).toBeGreaterThan(0);
		expect(pageCountOf(result.file.bytes)).toBe(3);
	});

	it('converts to grayscale without losing pages', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		const out = handlers.grayscale(ctx, { handle: doc.handle, dpi: 72 });
		expect(pageCountOf(out.bytes)).toBe(2);
	});

	it('rejects an out-of-range grayscale resolution', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.grayscale(ctx, { handle: doc.handle, dpi: 5 })).toThrow(/entre 36 e 600/);
	});

	it('rasterising destroys the text layer, as documented', () => {
		const { ctx } = testContext();
		const source = multiPagePdf(['SelectableText']);
		expect(textOf(source, 0)).toContain('SelectableText');

		const doc = handlers.open(ctx, { bytes: source, magic: 'application/pdf' });
		const out = handlers.rasterize(ctx, { handle: doc.handle, dpi: 72 });
		expect(textOf(out.bytes, 0).trim()).toBe('');
	});
});

describe('open, for every format MuPDF reads', () => {
	const cases: [string, string, Uint8Array][] = [
		['markdown', 'text/markdown', encode('# Markdown Heading\n')],
		['html', 'text/html', encode('<h1>Html Heading</h1>')],
		['plain text', 'text/plain', encode('Plain text body')]
	];

	for (const [label, magic, bytes] of cases) {
		it(`opens ${label} and yields a real PDF`, () => {
			const { ctx } = testContext();
			const info = handlers.open(ctx, { bytes, magic });
			expect(info.pageCount).toBeGreaterThan(0);
			const saved = handlers.save(ctx, { handle: info.handle });
			expect(new TextDecoder().decode(saved.bytes.slice(0, 5))).toBe('%PDF-');
		});
	}
});
