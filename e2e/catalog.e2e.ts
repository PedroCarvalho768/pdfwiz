/**
 * Coverage for the shared mechanisms rather than for every tool.
 *
 * Each tool's PDF behaviour is already tested in Node. What Node cannot see
 * is the plumbing they all share, so there is one test per mechanism: the
 * field renderer, the raw-input path, the password prompt, a custom
 * component, a text preview, and multi-file zip output.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mupdf from 'mupdf';

function write(name: string, bytes: Uint8Array): string {
	const path = join(mkdtempSync(join(tmpdir(), 'pdfwiz-')), name);
	writeFileSync(path, bytes);
	return path;
}

function fixturePdf(name: string, markers: string[]): string {
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

const downloadButton = (page: Page) => page.getByRole('button', { name: 'Baixar', exact: true });

test('the directory searches tools, including in Portuguese', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: /Juntar PDF/ })).toBeVisible();

	await page.getByPlaceholder(/juntar/).fill('senha');
	await expect(page.getByRole('link', { name: /Tirar a senha/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Juntar PDF/ })).toBeHidden();
});

test('a field-driven tool renders its form and applies the values', async ({ page }) => {
	const failures: string[] = [];
	page.on('pageerror', (error) => failures.push(error.message));

	await page.goto('/rotate-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('two.pdf', ['One', 'Two']));

	// Only page 2, so page 1 must stay upright — proves the pages field works.
	await page.getByLabel('Páginas').fill('2');
	await page.getByRole('button', { name: 'Girar PDF' }).click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	const saved = openPdf(result.bytes).asPDF()!;
	const rotationOf = (i: number) => {
		const value = saved.loadPage(i).getObject().get('Rotate');
		return value.isNull() ? 0 : value.asNumber();
	};
	expect(rotationOf(0)).toBe(0);
	expect(rotationOf(1)).toBe(90);
	expect(failures).toEqual([]);
});

test('an invalid page selection blocks the run instead of failing later', async ({ page }) => {
	await page.goto('/rotate-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('two.pdf', ['One', 'Two']));

	await page.getByLabel('Páginas').fill('99');
	await expect(page.getByText(/fora do intervalo/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Girar PDF' })).toBeDisabled();
});

test('protecting then reopening prompts for the password', async ({ page }) => {
	await page.goto('/protect-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('secret.pdf', ['Secret']));

	await page.getByLabel('Senha para abrir').fill('hunter2');
	await page.getByRole('button', { name: 'Proteger com senha' }).click();

	const locked = await grabDownload(page, () => downloadButton(page).click());
	expect(openPdf(locked.bytes).needsPassword()).toBe(true);

	// Now feed it back in: the UI must ask for the password, not just fail.
	const lockedPath = write('locked.pdf', new Uint8Array(locked.bytes));
	await page.goto('/unlock-pdf');
	await page.setInputFiles('input[type=file]', lockedPath);

	await expect(page.getByText('Este PDF está protegido por senha')).toBeVisible();
	await page.getByPlaceholder('Senha').fill('hunter2');
	await page.getByRole('button', { name: 'Desbloquear' }).click();

	await page.getByRole('button', { name: 'Tirar a senha' }).click();
	const opened = await grabDownload(page, () => downloadButton(page).click());
	expect(openPdf(opened.bytes).needsPassword()).toBe(false);
});

test('a wrong password is reported rather than silently accepted', async ({ page }) => {
	await page.goto('/protect-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('secret.pdf', ['Secret']));
	await page.getByLabel('Senha para abrir').fill('hunter2');
	await page.getByRole('button', { name: 'Proteger com senha' }).click();
	const locked = await grabDownload(page, () => downloadButton(page).click());

	await page.goto('/unlock-pdf');
	await page.setInputFiles('input[type=file]', write('l.pdf', new Uint8Array(locked.bytes)));
	await page.getByPlaceholder('Senha').fill('wrong-one');
	await page.getByRole('button', { name: 'Desbloquear' }).click();
	await expect(page.getByRole('alert')).toContainText(/não foi aceita/);
});

test('redaction removes the text from the downloaded file', async ({ page }) => {
	await page.goto('/redact-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('s.pdf', ['TOPSECRET']));

	await page.getByLabel('Texto a remover').fill('TOPSECRET');
	await page.getByRole('button', { name: 'Tarjar texto' }).click();

	await expect(page.getByText(/1 ocorrência .* removida/)).toBeVisible();
	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(textOf(openPdf(result.bytes), 0)).not.toContain('TOPSECRET');
});

test('searching for absent text reports it instead of producing a file', async ({ page }) => {
	await page.goto('/redact-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('s.pdf', ['Hello']));
	await page.getByLabel('Texto a remover').fill('NotPresent');
	await page.getByRole('button', { name: 'Tarjar texto' }).click();
	await expect(page.getByRole('alert')).toContainText(/não aparece/);
});

test('a text export shows a preview alongside the download', async ({ page }) => {
	await page.goto('/pdf-to-text');
	await page.setInputFiles('input[type=file]', fixturePdf('t.pdf', ['PreviewMe']));
	await page.getByRole('button', { name: 'PDF para texto' }).click();

	await page.locator('summary', { hasText: 'Prévia' }).click();
	await expect(page.locator('pre')).toContainText('PreviewMe');
});

test('an image export produces one file per page, zipped', async ({ page }) => {
	await page.goto('/pdf-to-png');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['A', 'B', 'C']));
	await page.getByRole('button', { name: 'PDF para PNG' }).click();

	await expect(page.getByRole('heading', { name: /3\s+arquivos/ })).toBeVisible({
		timeout: 30_000
	});
	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: /Baixar tudo/ }).click()
	);
	expect(result.name).toMatch(/\.zip$/);
	expect(result.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

test('the text editor rewrites a line in place', async ({ page }) => {
	await page.goto('/edit-pdf-text');
	await page.setInputFiles('input[type=file]', fixturePdf('e.pdf', ['OldWord']));

	const line = page.getByLabel('Linha 1');
	await expect(line).toHaveValue(/OldWord/, { timeout: 30_000 });
	await line.fill('NewWord');

	await page.getByRole('button', { name: /Salvar 1 alteração/ }).click();
	await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });
	const result = await grabDownload(page, () => downloadButton(page).click());

	const text = textOf(openPdf(result.bytes), 0);
	expect(text).toContain('NewWord');
	expect(text).not.toContain('OldWord');
});

test('a raw-input tool converts Word without the engine opening it first', async ({ page }) => {
	const { Document, Packer, Paragraph, TextRun } = await import('docx');
	const blob = await Packer.toBlob(
		new Document({
			sections: [{ children: [new Paragraph({ children: [new TextRun('WordContent')] })] }]
		})
	);
	const path = write('sample.docx', new Uint8Array(await blob.arrayBuffer()));

	await page.goto('/word-to-pdf');
	await page.setInputFiles('input[type=file]', path);
	await page.getByRole('button', { name: 'Word para PDF' }).click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(textOf(openPdf(result.bytes), 0)).toContain('WordContent');
});

test('the inspector reports document details', async ({ page }) => {
	await page.goto('/pdf-info');
	await page.setInputFiles('input[type=file]', fixturePdf('i.pdf', ['One', 'Two']));
	await page.getByRole('button', { name: 'Inspecionar PDF' }).click();

	await expect(page.getByText('2 páginas,')).toBeVisible();
	await expect(page.getByRole('definition').filter({ hasText: 'No' }).first()).toBeVisible();
});

test('corrupting produces a file that no longer opens', async ({ page }) => {
	await page.goto('/corrupt-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('c.pdf', ['One']));
	await page.getByRole('button', { name: 'Corromper PDF' }).click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(() => openPdf(result.bytes).countPages()).toThrow();
});

test('compression reports the size change', async ({ page }) => {
	await page.goto('/compress-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('big.pdf', ['One', 'Two', 'Three']));
	await page.getByRole('button', { name: 'Comprimir PDF' }).click();

	await expect(page.getByText(/(menor|sem redução)/)).toBeVisible({ timeout: 30_000 });
});
