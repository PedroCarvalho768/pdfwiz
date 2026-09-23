/**
 * Fixtures and assertions shared by the e2e suites. Outputs are checked by
 * re-opening the downloaded bytes with the same MuPDF package, never by
 * trusting that a click did something.
 */
import type { Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import * as mupdf from 'mupdf';

export function write(name: string, bytes: Uint8Array): string {
	const path = join(mkdtempSync(join(tmpdir(), 'aegis-')), name);
	writeFileSync(path, bytes);
	return path;
}

/** A PDF with one page per marker, each page carrying its marker as text. */
export function fixturePdf(name: string, markers: string[]): string {
	const buffer = new mupdf.Buffer();
	const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
	for (const marker of markers) {
		// Trailing newline matters: MuPDF's markdown parser drops the last
		// character without it. See normaliseInput() in shared.ts.
		const src = mupdf.Document.openDocument(
			new TextEncoder().encode(`# ${marker}\n`),
			'text/markdown'
		);
		for (let i = 0; i < src.countPages(); i++) {
			const page = src.loadPage(i);
			const device = writer.beginPage(page.getBounds());
			page.run(device, mupdf.Matrix.identity);
			device.close();
			writer.endPage();
		}
	}
	writer.close();
	return write(name, buffer.asUint8Array());
}

/** fixturePdf, encrypted with AES-256 under `password`. */
export function lockedPdf(name: string, markers: string[], password: string): string {
	const doc = openPdf(readFileSync(fixturePdf(name, markers))).asPDF()!;
	const options = `encrypt=aes-256,user-password=${password},owner-password=${password}`;
	return write(name, doc.saveToBuffer(options).asUint8Array());
}

/**
 * A one-page AcroForm: a text field "fullname" (tooltip "Nome completo"), a
 * checkbox "agree" (tooltip "Concordo") whose on-state is /Sim rather than
 * /Yes, and a radio group "plano" with options /Basico and /Pro. Written by
 * hand, then round-tripped through MuPDF so the xref is valid.
 */
export function formPdf(name: string): string {
	const empty = (n: number) =>
		`${n} 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length 0 >> stream\n\nendstream endobj\n`;
	const radio = (n: number, state: string, y: number) =>
		`${n} 0 obj << /Type /Annot /Subtype /Widget /Parent 9 0 R /Rect [20 ${y} 40 ${y + 20}] /P 3 0 R /AS /Off /F 4 /AP << /N << /${state} 7 0 R /Off 8 0 R >> >> >> endobj\n`;
	const source =
		'%PDF-1.7\n' +
		'1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R 9 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 6 0 R >> >> >> >> endobj\n' +
		'2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
		'3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Annots [4 0 R 5 0 R 10 0 R 11 0 R] >> endobj\n' +
		'4 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /T (fullname) /TU (Nome completo) /Rect [20 240 280 270] /P 3 0 R /DA (/Helv 12 Tf 0 g) /V () /F 4 >> endobj\n' +
		'5 0 obj << /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /TU (Concordo) /Rect [20 200 40 220] /P 3 0 R /V /Off /AS /Off /F 4 /AP << /N << /Sim 7 0 R /Off 8 0 R >> >> >> endobj\n' +
		'6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
		empty(7) +
		empty(8) +
		'9 0 obj << /FT /Btn /Ff 49152 /T (plano) /TU (Plano) /V /Off /Kids [10 0 R 11 0 R] >> endobj\n' +
		radio(10, 'Basico', 160) +
		radio(11, 'Pro', 130) +
		'trailer << /Root 1 0 R >>\n%%EOF\n';
	const doc = mupdf.Document.openDocument(new TextEncoder().encode(source), 'application/pdf');
	return write(name, doc.asPDF()!.saveToBuffer('').asUint8Array());
}

export async function grabDownload(page: Page, action: () => Promise<void>) {
	const [download] = await Promise.all([page.waitForEvent('download'), action()]);
	const path = join(mkdtempSync(join(tmpdir(), 'aegis-out-')), download.suggestedFilename());
	await download.saveAs(path);
	return { name: download.suggestedFilename(), bytes: readFileSync(path), path };
}

export const openPdf = (bytes: Uint8Array) =>
	mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');

export const textOf = (doc: mupdf.Document, page: number) =>
	doc.loadPage(page).toStructuredText('').asText();

/** Every page's text, in order. */
export const pageTexts = (bytes: Uint8Array) => {
	const doc = openPdf(bytes);
	return Array.from({ length: doc.countPages() }, (_, i) => textOf(doc, i).trim());
};

/** Entry names inside a downloaded zip. */
export const zipNames = (bytes: Uint8Array) => Object.keys(unzipSync(new Uint8Array(bytes))).sort();

export const downloadButton = (page: Page) =>
	page.getByRole('button', { name: 'Baixar', exact: true });

/** The engine's form widgets by name, for asserting filled values. */
export function widgetValues(bytes: Uint8Array): Record<string, string> {
	const doc = openPdf(bytes).asPDF()!;
	const out: Record<string, string> = {};
	for (let i = 0; i < doc.countPages(); i++)
		for (const widget of doc.loadPage(i).getWidgets()) out[widget.getName()] = widget.getValue();
	return out;
}
