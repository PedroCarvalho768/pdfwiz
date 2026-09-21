/**
 * One happy path per tool group, driven through the real UI.
 *
 * PDF behaviour is covered by the Node unit tests in `src/lib/engine`. These
 * tests only guard what Node cannot see: bundling, worker startup, the WASM
 * fetch, the message channel and the download path.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mupdf from 'mupdf';

function fixturePdf(name: string, markers: string[]): string {
	const buffer = new mupdf.Buffer();
	const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
	for (const marker of markers) {
		// Trailing newline matters: MuPDF's markdown parser drops the last
		// character without it. See normaliseInput() in jobs.ts.
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

	const path = join(mkdtempSync(join(tmpdir(), 'pdfwiz-')), name);
	writeFileSync(path, buffer.asUint8Array());
	return path;
}

/** Read a downloaded PDF back with MuPDF so we assert on content, not clicks. */
async function grabDownload(page: Page, action: () => Promise<void>) {
	const [download] = await Promise.all([page.waitForEvent('download'), action()]);
	const path = join(mkdtempSync(join(tmpdir(), 'pdfwiz-out-')), download.suggestedFilename());
	await download.saveAs(path);
	return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

const openPdf = (bytes: Buffer) =>
	mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');

const textOf = (doc: mupdf.Document, page: number) =>
	doc.loadPage(page).toStructuredText('').asText();

test('merges two documents into one, in the order shown', async ({ page }) => {
	const failures: string[] = [];
	page.on('pageerror', (error) => failures.push(error.message));

	await page.goto('/merge-pdf');
	await page.setInputFiles('input[type=file]', [
		fixturePdf('alpha.pdf', ['Alpha']),
		fixturePdf('bravo.pdf', ['Bravo'])
	]);

	const mergeButton = page.getByRole('button', { name: /Juntar 2 arquivos/ });
	await expect(mergeButton).toBeEnabled({ timeout: 30_000 });
	await mergeButton.click();

	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: 'Baixar', exact: true }).click()
	);

	const merged = openPdf(result.bytes);
	expect(merged.countPages()).toBe(2);
	expect(textOf(merged, 0)).toContain('Alpha');
	expect(textOf(merged, 1)).toContain('Bravo');
	expect(failures).toEqual([]);
});

test('splits one document into a zip of separate files', async ({ page }) => {
	await page.goto('/split-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));

	await page.getByRole('radio', { name: /Um arquivo por página/ }).check();
	await expect(page.getByText(/Gera\s*3\s*arquivos/)).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Dividir PDF' }).click();

	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: /Baixar tudo/ }).click()
	);
	expect(result.name).toMatch(/\.zip$/);
	// PK zip magic — proves we produced a real archive, not an empty blob.
	expect(result.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

test('reorders and deletes pages, and saves the result', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));

	// Wait for thumbnails, which proves the streaming render path ran.
	await expect(page.getByRole('img', { name: 'Página 1' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('img', { name: 'Página 3' })).toBeVisible();

	await page.getByRole('button', { name: 'Excluir página' }).first().click();
	await expect(page.getByText('2 de 3 páginas mantidas')).toBeVisible();

	await page.getByRole('button', { name: 'Salvar PDF' }).click();
	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: 'Baixar', exact: true }).click()
	);

	const saved = openPdf(result.bytes);
	expect(saved.countPages()).toBe(2);
	expect(textOf(saved, 0)).toContain('Two');
});

test('rotates a page and carries the rotation into the saved file', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('two.pdf', ['One', 'Two']));

	const firstThumb = page.getByRole('img', { name: 'Página 1' });
	await expect(firstThumb).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Girar à direita' }).first().click();
	// The preview must actually turn; a silent no-op here shipped once already.
	await expect(firstThumb).toHaveAttribute('style', /rotate\(90deg\)/);

	await page.getByRole('button', { name: 'Salvar PDF' }).click();
	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: 'Baixar', exact: true }).click()
	);

	const saved = openPdf(result.bytes).asPDF()!;
	// MuPDF may write an explicit /Rotate 0 or omit the key entirely, so
	// assert the effective rotation rather than how it happens to be stored.
	const rotationOf = (index: number) => {
		const value = saved.loadPage(index).getObject().get('Rotate');
		return value.isNull() ? 0 : value.asNumber();
	};
	expect(rotationOf(0)).toBe(90);
	expect(rotationOf(1)).toBe(0);
});
