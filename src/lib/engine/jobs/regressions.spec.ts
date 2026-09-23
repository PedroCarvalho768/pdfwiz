/**
 * Regression tests for defects found in review. Each one failed against the
 * code it guards; assertions re-open the produced bytes, never compare them.
 */
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { handlers } from './index';
import { permissionMask } from './security';
import { fixture, multiPagePdf, openBytes, testContext, textOf } from './testing';
import type { JobContext } from '../shared';

const open = (ctx: JobContext, bytes: Uint8Array) =>
	handlers.open(ctx, { bytes, magic: 'application/pdf' });

/** Edit a fixture with raw MuPDF calls, then hand back its saved bytes. */
function edited(bytes: Uint8Array, edit: (doc: mupdf.PDFDocument) => void): Uint8Array {
	const doc = new mupdf.PDFDocument(bytes);
	edit(doc);
	return doc.saveToBuffer('').asUint8Array();
}

/** The whole file with streams decompressed, as Latin-1 (asString stops at NUL). */
const plainText = (bytes: Uint8Array) =>
	new TextDecoder('latin1').decode(
		new mupdf.PDFDocument(bytes).saveToBuffer('decompress').asUint8Array()
	);

function withOutline(markers: string[]): Uint8Array {
	return edited(multiPagePdf(markers), (doc) => {
		const iterator = doc.outlineIterator();
		markers.forEach((marker, page) =>
			iterator.insert({ title: `Chapter ${marker}`, uri: `#page=${page + 1}`, open: true })
		);
	});
}

/** A registered AcroForm text field, so catalog-level form structure exists. */
function withForm(bytes: Uint8Array): Uint8Array {
	return edited(bytes, (doc) => {
		const page = doc.loadPage(0);
		const field = doc.addObject({
			Type: 'Annot',
			Subtype: 'Widget',
			FT: 'Tx',
			T: '(fullName)',
			V: '(Ada)',
			Rect: [10, 10, 200, 40],
			P: page.getObject()
		});
		const annots = doc.newArray();
		annots.push(field);
		page.getObject().put('Annots', annots);
		const fields = doc.newArray();
		fields.push(field);
		doc
			.getTrailer()
			.get('Root')
			.put('AcroForm', doc.addObject({ Fields: fields }));
	});
}

/** Deterministic noise, so JPEG really is smaller than the Flate original. */
function noise(length: number, lo: number, hi: number, seed = 7): Uint8Array {
	const out = new Uint8Array(length);
	let s = seed;
	for (let i = 0; i < length; i++) {
		// xorshift32: cheap, and its low bits are not periodic like an LCG's.
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		out[i] = lo + ((s >>> 0) % (hi - lo + 1));
	}
	return out;
}

/** One 400pt square page painted edge to edge by a single image XObject. */
function imagePage(
	width: number,
	height: number,
	colorSpace: 'DeviceRGB' | 'DeviceGray',
	samples: Uint8Array,
	extra: Record<string, unknown> = {}
): Uint8Array {
	const doc = new mupdf.PDFDocument();
	const image = doc.addStream(samples, {
		Type: 'XObject',
		Subtype: 'Image',
		Width: width,
		Height: height,
		ColorSpace: colorSpace,
		BitsPerComponent: 8,
		...extra
	});
	const resources = doc.addObject({ XObject: { Im0: image } });
	doc.insertPage(-1, doc.addPage([0, 0, 400, 400], 0, resources, 'q 400 0 0 400 0 0 cm /Im0 Do Q'));
	return doc.saveToBuffer('compress').asUint8Array();
}

/** Rendered RGB at a fraction of the page, 0..1 on both axes. */
function pixelAt(bytes: Uint8Array, fx: number, fy: number): [number, number, number] {
	const page = openBytes(bytes).loadPage(0);
	const pixmap = page.toPixmap(mupdf.Matrix.scale(0.25, 0.25), mupdf.ColorSpace.DeviceRGB, false);
	const x = Math.floor(pixmap.getWidth() * fx);
	const y = Math.floor(pixmap.getHeight() * fy);
	const pixels = pixmap.getPixels();
	const i = y * pixmap.getStride() + x * 3;
	return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** The first image XObject in the file: its dictionary and its decoded form. */
function firstImage(bytes: Uint8Array): { dict: mupdf.PDFObject; image: mupdf.Image } {
	const doc = new mupdf.PDFDocument(bytes);
	for (let n = 1; n < doc.countObjects(); n++) {
		const ref = doc.newIndirect(n);
		if (ref.isStream() && ref.get('Subtype').toString() === '/Image')
			return { dict: ref, image: doc.loadImage(ref) };
	}
	throw new Error('no image in file');
}

describe('organize: one graft map per source (1)', () => {
	it('merging a document with itself does not duplicate its fonts', async () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Alpha', 'Bravo', 'Charlie']);
		const out = await handlers.merge(ctx, { handles: [doc.handle, doc.handle] });
		expect(out.bytes.byteLength).toBeLessThan(2 * doc.byteLength * 1.3);
	});

	it('interleaving does not duplicate fonts either', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Alpha', 'Bravo', 'Charlie']);
		const out = handlers.interleave(ctx, { handles: [doc.handle, doc.handle] });
		expect(out.bytes.byteLength).toBeLessThan(2 * doc.byteLength * 1.3);
	});
});

describe('organize: structure survives page tools (2)', () => {
	it('keeps the outline and the form through rotate', () => {
		const { ctx } = testContext();
		const doc = open(ctx, withForm(withOutline(['One', 'Two'])));
		const out = handlers.rotate(ctx, { handle: doc.handle, degrees: 90, pages: [0] });
		const back = open(ctx, out.bytes);

		expect(handlers.outline(ctx, { handle: back.handle }).map((o) => o.title)).toEqual([
			'Chapter One',
			'Chapter Two'
		]);
		expect(handlers.formFields(ctx, { handle: back.handle }).map((f) => f.name)).toEqual([
			'fullName'
		]);
		const acro = openBytes(out.bytes).asPDF()!.getTrailer().get('Root', 'AcroForm', 'Fields');
		expect(acro.length).toBe(1);
		expect(back.pages[0].rotation).toBe(90);
	});

	it('keeps the outline and the form through crop', () => {
		const { ctx } = testContext();
		const doc = open(ctx, withForm(withOutline(['One', 'Two'])));
		const out = handlers.crop(ctx, { handle: doc.handle, top: 5, right: 5, bottom: 5, left: 5 });
		const back = open(ctx, out.bytes);
		expect(handlers.outline(ctx, { handle: back.handle })).toHaveLength(2);
		expect(openBytes(out.bytes).asPDF()!.getTrailer().get('Root', 'AcroForm').isNull()).toBe(false);
	});

	it('keeps the outline through reorder, and bookmarks follow their page', () => {
		const { ctx } = testContext();
		const doc = open(ctx, withOutline(['One', 'Two', 'Three']));
		const out = handlers.reverse(ctx, { handle: doc.handle });
		const outline = handlers.outline(ctx, { handle: open(ctx, out.bytes).handle });
		expect(outline.find((o) => o.title === 'Chapter One')?.page).toBe(2);
	});

	it('does not mutate the open document', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		handlers.rotate(ctx, { handle: doc.handle, degrees: 90 });
		const again = handlers.rotate(ctx, { handle: doc.handle, degrees: 90 });
		expect(open(ctx, again.bytes).pages[0].rotation).toBe(90);
	});

	it('gives duplicated pages independent rotation and content', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const out = handlers.organize(ctx, { handle: doc.handle, order: [0, 0], rotations: [90, 0] });
		const back = open(ctx, out.bytes);
		expect(back.pages.map((p) => p.rotation)).toEqual([90, 0]);

		const dup = open(ctx, handlers.duplicate(ctx, { handle: doc.handle, times: 2 }).bytes);
		const numbered = handlers.pageNumbers(ctx, { handle: dup.handle, template: 'Folha {n}' });
		expect(textOf(numbered.bytes, 0)).toContain('Folha 1');
		expect(textOf(numbered.bytes, 0)).not.toContain('Folha 2');
	});
});

describe('compress (3, 4, 5)', () => {
	it('downscales a large image without shrinking it into a corner', () => {
		const { ctx } = testContext();
		const size = 1800;
		const samples = noise(size * size * 3, 0, 40);
		for (let i = 0; i < samples.length; i += 3) samples[i] = 215 + (samples[i] % 40);
		const doc = open(ctx, imagePage(size, size, 'DeviceRGB', samples));

		const result = handlers.compress(ctx, { handle: doc.handle, level: 'balanced' });
		expect(result.imagesRecompressed).toBe(1);
		const [r, g, b] = pixelAt(result.file.bytes, 0.9, 0.9);
		expect(r).toBeGreaterThan(180);
		expect(g).toBeLessThan(90);
		expect(b).toBeLessThan(90);
	});

	it('drops /Decode when replacing an image and keeps it gray', () => {
		const { ctx } = testContext();
		const size = 700;
		// Raw samples are dark; Decode [1 0] makes them render light.
		const doc = open(
			ctx,
			imagePage(size, size, 'DeviceGray', noise(size * size, 0, 30), { Decode: [1, 0] })
		);
		expect(pixelAt(handlers.save(ctx, { handle: doc.handle }).bytes, 0.5, 0.5)[0]).toBeGreaterThan(
			200
		);

		const result = handlers.compress(ctx, { handle: doc.handle, level: 'balanced' });
		expect(result.imagesRecompressed).toBe(1);
		expect(pixelAt(result.file.bytes, 0.5, 0.5)[0]).toBeGreaterThan(200);
		const { dict, image } = firstImage(result.file.bytes);
		expect(dict.get('Decode').isNull()).toBe(true);
		expect(image.getColorSpace()!.isGray()).toBe(true);
	});

	it('keeps a gray image gray through the downscale path', () => {
		const { ctx } = testContext();
		const size = 1800;
		const doc = open(ctx, imagePage(size, size, 'DeviceGray', noise(size * size, 100, 160)));
		const result = handlers.compress(ctx, { handle: doc.handle, level: 'balanced' });
		expect(result.imagesRecompressed).toBe(1);
		const { image } = firstImage(result.file.bytes);
		expect(image.getColorSpace()!.isGray()).toBe(true);
		expect(image.getWidth()).toBe(1600);
	});

	it('reports the real input size and counts images it could not process', () => {
		const { ctx } = testContext();
		const bytes = imagePage(64, 64, 'DeviceRGB', noise(64 * 64 * 3, 0, 255));
		// A colour space no reader knows makes the image undecodable.
		const broken = edited(bytes, (doc) => {
			for (let n = 1; n < doc.countObjects(); n++) {
				const ref = doc.newIndirect(n);
				if (ref.isStream() && ref.get('Subtype').toString() === '/Image')
					ref.put('ColorSpace', doc.newName('NoSuchSpace'));
			}
		});
		// Trailing bytes a re-save would not reproduce: `before` must be the
		// file as opened, not whatever MuPDF would write for it now.
		const input = new Uint8Array([...broken, ...new TextEncoder().encode('\n'.repeat(200))]);
		const doc = open(ctx, input);
		const result = handlers.compress(ctx, { handle: doc.handle, level: 'balanced' });
		expect(result.before).toBe(input.byteLength);
		expect(result.imagesSkipped).toBe(1);
		expect(result.imagesRecompressed).toBe(0);

		const cleaned = handlers.clean(ctx, { handle: doc.handle });
		expect(cleaned.before).toBe(input.byteLength);
	});
});

describe('crop geometry (6)', () => {
	it('a top margin removes the top of the page, not the bottom', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Heading']);
		const top = handlers.crop(ctx, { handle: doc.handle, top: 30, right: 0, bottom: 0, left: 0 });
		expect(textOf(top.bytes, 0)).not.toContain('Heading');

		const bottom = handlers.crop(ctx, {
			handle: doc.handle,
			top: 0,
			right: 0,
			bottom: 30,
			left: 0
		});
		expect(textOf(bottom.bytes, 0)).toContain('Heading');
	});
});

describe('n-up order (7)', () => {
	it('fills the first row at the top of the sheet', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three', 'Four']);
		const out = handlers.nup(ctx, { handle: doc.handle, columns: 2, rows: 2 });
		const lines = handlers.textLines(ctx, { handle: open(ctx, out.bytes).handle, page: 0 });
		const at = (word: string) => lines.find((l) => l.text.includes(word))!.baseline;
		expect(at('One')[1]).toBeLessThan(at('Three')[1]);
		expect(at('One')[0]).toBeLessThan(at('Two')[0]);
		expect(at('One')[1]).toBeCloseTo(at('Two')[1], 0);
	});
});

describe('insertBlank semantics (8)', () => {
	it('inserts before the given source pages, and at the end for pageCount', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One', 'Two', 'Three']);
		const out = handlers.insertBlank(ctx, { handle: doc.handle, at: [0, 2, 3] });
		const texts = [0, 1, 2, 3, 4, 5].map((i) => textOf(out.bytes, i).trim());
		expect(texts).toEqual(['', 'One', 'Two', '', 'Three', '']);
	});

	it('rejects a position past the end', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.insertBlank(ctx, { handle: doc.handle, at: [2] })).toThrow(
			/fora do intervalo/
		);
	});

	it('keeps the outline', () => {
		const { ctx } = testContext();
		const doc = open(ctx, withOutline(['One', 'Two']));
		const out = handlers.insertBlank(ctx, { handle: doc.handle, at: [1] });
		const outline = handlers.outline(ctx, { handle: open(ctx, out.bytes).handle });
		expect(outline.find((o) => o.title === 'Chapter Two')?.page).toBe(2);
	});
});

describe('stamping over edited content (9)', () => {
	it('replaceText works on a stamped, saved and reopened file', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['OldWord']);
		const stamped = handlers.headerFooter(ctx, { handle: doc.handle, text: 'Header' });
		const reopened = open(ctx, stamped.bytes);
		const line = handlers
			.textLines(ctx, { handle: reopened.handle, page: 0 })
			.find((l) => l.text.includes('OldWord'))!;
		const edit = { page: 0, rect: line.rect, baseline: line.baseline, size: line.size };

		const out = handlers.replaceText(ctx, {
			handle: reopened.handle,
			edits: [{ ...edit, text: 'NewWord' }]
		});
		expect(textOf(out.bytes, 0)).toContain('NewWord');
		expect(textOf(out.bytes, 0)).toContain('Header');

		const twice = handlers.replaceText(ctx, {
			handle: reopened.handle,
			edits: [{ ...edit, text: 'Third' }]
		});
		expect(textOf(twice.bytes, 0)).toContain('Third');
		expect(textOf(twice.bytes, 0)).not.toContain('NewWord');
	});

	it('does not leave a private marker in the saved file', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const out = handlers.headerFooter(ctx, { handle: doc.handle, text: 'Header' });
		expect(plainText(out.bytes)).not.toContain('PWIsolated');
	});
});

describe('stamp geometry on offset and rotated pages (10)', () => {
	it('a top-left header lands top-left after a crop', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const cropped = open(
			ctx,
			handlers.crop(ctx, { handle: doc.handle, top: 20, right: 0, bottom: 0, left: 20 }).bytes
		);
		const out = handlers.headerFooter(ctx, {
			handle: cropped.handle,
			text: 'CORNER',
			anchor: 'top-left',
			size: 10,
			margin: 24
		});
		const line = handlers
			.textLines(ctx, { handle: open(ctx, out.bytes).handle, page: 0 })
			.find((l) => l.text.includes('CORNER'));
		expect(line).toBeDefined();
		expect(line!.rect[0]).toBeCloseTo(24, -1);
		expect(line!.baseline[1]).toBeCloseTo(34, -1);
	});

	it('a bottom-centre number on a /Rotate 90 page sits bottom-centre and upright', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const rotated = open(ctx, handlers.rotate(ctx, { handle: doc.handle, degrees: 90 }).bytes);
		const { width, height } = rotated.pages[0];
		expect(width).toBeGreaterThan(height);

		const out = handlers.pageNumbers(ctx, {
			handle: rotated.handle,
			template: 'Pagina {n} de {total}'
		});
		const line = handlers
			.textLines(ctx, { handle: open(ctx, out.bytes).handle, page: 0 })
			.find((l) => l.text.includes('Pagina'));
		expect(line).toBeDefined();
		const [x0, y0, x1, y1] = line!.rect;
		expect(x1 - x0).toBeGreaterThan(y1 - y0);
		expect((x0 + x1) / 2).toBeCloseTo(width / 2, -1);
		expect(y1).toBeGreaterThan(height * 0.85);
	});

	it('a highlight covers the rectangle it was given on a cropped page', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const cropped = open(
			ctx,
			handlers.crop(ctx, { handle: doc.handle, top: 20, right: 0, bottom: 0, left: 20 }).bytes
		);
		const { width, height } = cropped.pages[0];
		const out = handlers.highlight(ctx, {
			handle: cropped.handle,
			areas: [{ page: 0, rect: [0, 0, width / 2, height / 2] }],
			color: '#0000ff',
			opacity: 1
		});
		const [r, , b] = pixelAt(out.bytes, 0.1, 0.1);
		expect(b).toBeGreaterThan(200);
		expect(r).toBeLessThan(60);
	});
});

describe('WinAnsi encoding (11)', () => {
	it('keeps typographic punctuation and the euro sign', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['Body']);
		const text = 'Preço € “aspas” – travessão — fim…';
		const out = handlers.headerFooter(ctx, { handle: doc.handle, text });
		expect(textOf(out.bytes, 0)).toContain(text);
	});
});

describe('search and redaction (12)', () => {
	const words = Array.from({ length: 60 }, (_, i) => `w${i}x`).join(' ');

	it('redacting a match that wraps across lines removes only the matched words', () => {
		const { ctx } = testContext();
		const doc = handlers.open(ctx, { bytes: new TextEncoder().encode(words), magic: 'text/plain' });
		const lines = textOf(handlers.save(ctx, { handle: doc.handle }).bytes, 0)
			.split('\n')
			.map((l) => l.trim().split(' '))
			.filter((l) => l.length > 2);
		const needle = `${lines[0].at(-1)} ${lines[1][0]}`;

		const hits = handlers.search(ctx, { handle: doc.handle, needle });
		expect(hits).toHaveLength(1);
		expect(hits[0].quads).toHaveLength(2);

		const out = handlers.redact(ctx, {
			handle: doc.handle,
			areas: hits.flatMap((hit) => hit.quads.map((rect) => ({ page: hit.page, rect })))
		});
		const after = textOf(out.bytes, 0);
		expect(after).not.toContain(lines[0].at(-1)!);
		expect(after).not.toContain(lines[1][0]);
		expect(after).toContain(lines[0][0]);
		expect(after).toContain(lines[1].at(-1)!);
	});

	it('has no default cap on the number of hits', () => {
		const { ctx } = testContext();
		const doc = open(ctx, multiPagePdf(['zq '.repeat(300), 'zq '.repeat(300), 'zq '.repeat(300)]));
		expect(handlers.search(ctx, { handle: doc.handle, needle: 'zq' })).toHaveLength(900);
	});

	it("fails loudly when a page reaches MuPDF's per-page hit cap", () => {
		const { ctx } = testContext();
		const doc = handlers.open(ctx, {
			bytes: new TextEncoder().encode('zq '.repeat(620)),
			magic: 'text/plain'
		});
		expect(() => handlers.search(ctx, { handle: doc.handle, needle: 'zq' })).toThrow(
			/ocorrências demais/
		);
	});
});

describe('sanitize (13, 14)', () => {
	it('removes the Info dictionary, and XMP and PieceInfo everywhere', () => {
		const { ctx } = testContext();
		const bytes = edited(multiPagePdf(['One']), (doc) => {
			const info = doc.addObject({ Company: '(LeakyCorp)', Author: '(Leaky Name)' });
			doc.getTrailer().put('Info', info);
			const xmp = (tag: string) =>
				doc.addStream(`<x:xmpmeta>${tag}</x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' });
			doc.getTrailer().get('Root').put('Metadata', xmp('CatalogXmp'));
			const page = doc.loadPage(0).getObject();
			page.put('Metadata', xmp('PageXmpSecret'));
			page.put('PieceInfo', doc.newDictionary());
			page.get('PieceInfo').put('App', doc.addObject({ Private: '(PieceSecret)' }));
			const form = doc.addStream('', {
				Type: 'XObject',
				Subtype: 'Form',
				BBox: [0, 0, 1, 1],
				Metadata: xmp('FormXmpSecret')
			});
			page.get('Resources').put('XObject', doc.addObject({ Fx: form }));
		});
		const doc = open(ctx, bytes);
		const out = handlers.sanitize(ctx, { handle: doc.handle });
		const plain = plainText(out.bytes);
		for (const secret of [
			'LeakyCorp',
			'Leaky Name',
			'CatalogXmp',
			'PageXmpSecret',
			'PieceSecret',
			'FormXmpSecret'
		])
			expect(plain).not.toContain(secret);
		expect(textOf(out.bytes, 0)).toContain('One');
	});

	it('removes page, annotation and form JavaScript', () => {
		const { ctx } = testContext();
		const bytes = edited(multiPagePdf(['One']), (doc) => {
			const js = (code: string) => ({ S: 'JavaScript', JS: `(${code})` });
			const page = doc.loadPage(0).getObject();
			page.put('AA', doc.addObject({ O: js('pageOpenJs()') }));
			const link = doc.addObject({
				Type: 'Annot',
				Subtype: 'Link',
				Rect: [0, 0, 50, 50],
				A: js('linkJs()')
			});
			const widget = doc.addObject({
				Type: 'Annot',
				Subtype: 'Widget',
				FT: 'Tx',
				T: '(f)',
				Rect: [60, 60, 120, 80],
				AA: { K: js('keystrokeJs()') }
			});
			const annots = doc.newArray();
			annots.push(link);
			annots.push(widget);
			page.put('Annots', annots);
			const fields = doc.newArray();
			fields.push(widget);
			const co = doc.newArray();
			co.push(widget);
			doc
				.getTrailer()
				.get('Root')
				.put('AcroForm', doc.addObject({ Fields: fields, CO: co }));
		});
		const doc = open(ctx, bytes);
		const out = handlers.sanitize(ctx, { handle: doc.handle });
		const plain = plainText(out.bytes);
		for (const secret of ['pageOpenJs', 'linkJs', 'keystrokeJs', '/JavaScript'])
			expect(plain).not.toContain(secret);
		const acro = openBytes(out.bytes).asPDF()!.getTrailer().get('Root', 'AcroForm');
		expect(acro.get('CO').isNull()).toBe(true);
		expect(handlers.formFields(ctx, { handle: open(ctx, out.bytes).handle })).toHaveLength(1);
	});
});

describe('protect (15, 16, 17)', () => {
	it('restrictions hold for someone who only knows the open password', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const locked = handlers.protect(ctx, {
			handle: doc.handle,
			userPassword: 'user',
			permissions: { print: true }
		}).bytes;
		const reopened = handlers.open(ctx, {
			bytes: locked,
			magic: 'application/pdf',
			password: 'user'
		});
		const perms = handlers.permissions(ctx, { handle: reopened.handle });
		expect(perms.print).toBe(true);
		expect(perms.copy).toBe(false);
		expect(perms.edit).toBe(false);
	});

	it('refuses a password containing a comma, in Portuguese', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.protect(ctx, { handle: doc.handle, userPassword: 'a,b' })).toThrow(
			'A senha não pode conter vírgula'
		);
		expect(() =>
			handlers.protect(ctx, { handle: doc.handle, userPassword: 'ok', ownerPassword: 'x,y' })
		).toThrow('A senha não pode conter vírgula');
	});

	it('writes the permission mask as ISO 32000 Table 22 requires', () => {
		const mask = permissionMask({ print: true });
		expect(mask & 0b11).toBe(0);
		expect(mask & 0xc0).toBe(0xc0);
		expect(mask >>> 12).toBe(0xfffff);

		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		const locked = handlers.protect(ctx, {
			handle: doc.handle,
			ownerPassword: 'owner',
			permissions: { print: true, fillForms: true }
		}).bytes;
		const p = openBytes(locked).asPDF()!.getTrailer().get('Encrypt', 'P').asNumber();
		expect(p & 0b11).toBe(0);
		expect(p & 0xc0).toBe(0xc0);
		const reopened = open(ctx, locked);
		const perms = handlers.permissions(ctx, { handle: reopened.handle });
		expect(perms.print).toBe(true);
		expect(perms.form).toBe(true);
		expect(perms.annotate).toBe(false);
	});
});

describe('fillForm (19)', () => {
	function buttonForm(): Uint8Array {
		const doc = new mupdf.PDFDocument();
		doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, doc.newDictionary(), ''));
		const page = doc.loadPage(0).getObject();
		const appearance = (on: string) => ({
			N: {
				[on]: doc.addStream('0 0 1 rg 0 0 10 10 re f', {
					Type: 'XObject',
					Subtype: 'Form',
					BBox: [0, 0, 10, 10]
				}),
				Off: doc.addStream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] })
			}
		});
		const text = doc.addObject({
			Type: 'Annot',
			Subtype: 'Widget',
			FT: 'Tx',
			T: '(fullName)',
			V: '()',
			Rect: [10, 250, 200, 280]
		});
		const checkbox = doc.addObject({
			Type: 'Annot',
			Subtype: 'Widget',
			FT: 'Btn',
			T: '(agree)',
			V: 'Off',
			AS: 'Off',
			Rect: [10, 200, 30, 220],
			AP: appearance('Sim')
		});
		const group = doc.addObject({ FT: 'Btn', Ff: 1 << 15, T: '(color)', V: 'Off' });
		const kids = doc.newArray();
		const annots = doc.newArray();
		annots.push(text);
		annots.push(checkbox);
		for (const [on, x] of [
			['Red', 10],
			['Blue', 50]
		] as const) {
			const kid = doc.addObject({
				Type: 'Annot',
				Subtype: 'Widget',
				Parent: group,
				AS: 'Off',
				Rect: [x, 100, x + 20, 120],
				AP: appearance(on)
			});
			kids.push(kid);
			annots.push(kid);
		}
		group.put('Kids', kids);
		page.put('Annots', annots);
		const fields = doc.newArray();
		fields.push(text);
		fields.push(checkbox);
		fields.push(group);
		doc
			.getTrailer()
			.get('Root')
			.put('AcroForm', doc.addObject({ Fields: fields }));
		return doc.saveToBuffer('').asUint8Array();
	}

	const valueOf = (ctx: JobContext, bytes: Uint8Array, name: string) =>
		handlers
			.formFields(ctx, { handle: open(ctx, bytes).handle })
			.filter((f) => f.name === name)
			.map((f) => f.value);

	it('fills nothing when one of the names is unknown', () => {
		const { ctx } = testContext();
		const doc = open(ctx, buttonForm());
		expect(() =>
			handlers.fillForm(ctx, { handle: doc.handle, values: { fullName: 'Ada', nope: 'x' } })
		).toThrow(/não tem o campo nope/);
		const saved = handlers.save(ctx, { handle: doc.handle }).bytes;
		expect(valueOf(ctx, saved, 'fullName')).toEqual(['']);
	});

	it('turns on the radio button whose export value was given, and only that one', () => {
		const { ctx } = testContext();
		const doc = open(ctx, buttonForm());
		const out = handlers.fillForm(ctx, { handle: doc.handle, values: { color: 'Blue' } }).bytes;
		expect(new Set(valueOf(ctx, out, 'color'))).toEqual(new Set(['Blue']));
		const states = new mupdf.PDFDocument(out)
			.loadPage(0)
			.getWidgets()
			.filter((w) => w.getName() === 'color')
			.map((w) => w.getObject().get('AS').toString());
		expect(states).toEqual(['/Off', '/Blue']);
	});

	it('rejects a radio value that is not one of its options', () => {
		const { ctx } = testContext();
		const doc = open(ctx, buttonForm());
		expect(() =>
			handlers.fillForm(ctx, { handle: doc.handle, values: { color: 'Green' } })
		).toThrow(/Green/);
	});

	it("accepts a checkbox's own on-state name", () => {
		const { ctx } = testContext();
		const doc = open(ctx, buttonForm());
		const out = handlers.fillForm(ctx, { handle: doc.handle, values: { agree: 'Sim' } }).bytes;
		expect(valueOf(ctx, out, 'agree')).toEqual(['Sim']);

		const again = open(ctx, out);
		const off = handlers.fillForm(ctx, { handle: again.handle, values: { agree: 'Off' } }).bytes;
		expect(valueOf(ctx, off, 'agree')).toEqual(['Off']);
	});
});

describe('rotation is inherited (22)', () => {
	it('reads /Rotate from the page tree and normalises negatives', () => {
		const { ctx } = testContext();
		const bytes = edited(multiPagePdf(['One', 'Two']), (doc) => {
			doc.getTrailer().get('Root', 'Pages').put('Rotate', 90);
			doc.loadPage(0).getObject().delete('Rotate');
			doc.loadPage(1).getObject().put('Rotate', -90);
		});
		const info = open(ctx, bytes);
		expect(info.pages.map((p) => p.rotation)).toEqual([90, 270]);
		const report = handlers.report(ctx, { handle: info.handle });
		expect(report.pageSizes.map((p) => p.rotation)).toEqual([90, 270]);
	});
});

describe('rasterize resolution cap (23)', () => {
	it('rejects an absurd resolution', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(() => handlers.rasterize(ctx, { handle: doc.handle, dpi: 5000 })).toThrow(
			/entre 36 e 600/
		);
	});
});

describe('user-visible engine strings are Portuguese (21)', () => {
	it('labels progress in Portuguese', async () => {
		const { ctx, labels } = testContext();
		const doc = fixture(ctx, ['One', 'Two']);
		await handlers.merge(ctx, { handles: [doc.handle, doc.handle] });
		await handlers.render(ctx, { handle: doc.handle, width: 20 });
		await handlers.toImages(ctx, { handle: doc.handle, dpi: 10 });
		await handlers.toSvg(ctx, { handle: doc.handle });
		const images = open(ctx, handlers.rasterize(ctx, { handle: doc.handle, dpi: 36 }).bytes);
		await handlers.extractImages(ctx, { handle: images.handle, minSize: 1 });
		expect(new Set(labels)).toEqual(
			new Set([
				'Juntando páginas',
				'Renderizando páginas',
				'Convertendo páginas',
				'Extraindo imagens'
			])
		);
	});

	it('reports a closed handle and a cancellation in Portuguese', async () => {
		const { ctx, cancel } = testContext();
		const doc = fixture(ctx, ['One']);
		handlers.close(ctx, { handle: doc.handle });
		expect(() => handlers.inspect(ctx, { handle: doc.handle })).toThrow(/Documento não encontrado/);
		const other = fixture(ctx, ['Two']);
		cancel();
		await expect(handlers.render(ctx, { handle: other.handle })).rejects.toThrow(
			/Operação cancelada/
		);
	});
});

describe('open (20)', () => {
	it('frees the source document after converting a non-PDF', () => {
		const { ctx } = testContext();
		const original = mupdf.Document.prototype.destroy;
		let destroyed = 0;
		mupdf.Document.prototype.destroy = function (this: mupdf.Document) {
			destroyed++;
			return original.call(this);
		};
		try {
			handlers.open(ctx, { bytes: new TextEncoder().encode('# Hi\n'), magic: 'text/markdown' });
		} finally {
			mupdf.Document.prototype.destroy = original;
		}
		expect(destroyed).toBeGreaterThan(0);
	});

	it('inspect reports the stored byte length', () => {
		const { ctx } = testContext();
		const doc = fixture(ctx, ['One']);
		expect(handlers.inspect(ctx, { handle: doc.handle }).byteLength).toBe(doc.byteLength);
	});
});
