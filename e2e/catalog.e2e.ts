/**
 * Coverage for the shared mechanisms rather than for every tool.
 *
 * Each tool's PDF behaviour is already tested in Node. What Node cannot see
 * is the plumbing they all share, so there is one test per mechanism: the
 * field renderer, the raw-input path, the password prompt, a custom
 * component, a text preview, and multi-file zip output.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
	downloadButton,
	fixturePdf,
	grabDownload,
	lockedPdf,
	openPdf,
	textOf,
	write,
	zipNames
} from './helpers';

/** The value cell next to a label in the result's details table. */
const detail = (page: Page, term: string) =>
	page
		.locator('dl > div')
		.filter({ has: page.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }) })
		.getByRole('definition');

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
	// Named after the file, not the PDF's /Title.
	expect(result.name).toBe('two-girado.pdf');
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

test('a required page selection left empty blocks the run', async ({ page }) => {
	await page.goto('/extract-pages');
	await page.setInputFiles('input[type=file]', fixturePdf('two.pdf', ['One', 'Two']));

	const button = page.getByRole('button', { name: 'Extrair páginas' });
	await expect(button).toBeDisabled();
	await expect(page.getByText('Preencha Páginas a manter primeiro.')).toBeVisible();

	await page.getByLabel('Páginas a manter').fill('2');
	await button.click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	const saved = openPdf(result.bytes);
	expect(saved.countPages()).toBe(1);
	expect(textOf(saved, 0)).toContain('Two');
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
	await page.getByLabel('Senha de locked.pdf').fill('hunter2');
	await page.getByRole('button', { name: 'Desbloquear' }).click();

	await page.getByRole('button', { name: 'Tirar a senha' }).click();
	const opened = await grabDownload(page, () => downloadButton(page).click());
	expect(openPdf(opened.bytes).needsPassword()).toBe(false);
});

test('a wrong password is reported rather than silently accepted', async ({ page }) => {
	await page.goto('/unlock-pdf');
	await page.setInputFiles('input[type=file]', lockedPdf('l.pdf', ['Secret'], 'hunter2'));
	await page.getByLabel('Senha de l.pdf').fill('wrong-one');
	await page.getByRole('button', { name: 'Desbloquear' }).click();
	await expect(page.getByRole('alert')).toContainText(/não foi aceita/);
	// Focused, so it is seen and announced even below the fold.
	await expect(page.getByRole('alert')).toBeFocused();
});

test('a locked file in a batch pauses the queue instead of dropping files', async ({ page }) => {
	await page.goto('/merge-pdf');
	await page.setInputFiles('input[type=file]', [
		fixturePdf('alpha.pdf', ['Alpha']),
		lockedPdf('locked.pdf', ['Locked'], 'pw'),
		fixturePdf('charlie.pdf', ['Charlie'])
	]);

	// The prompt names the file that is actually locked.
	await expect(page.getByText('Digite a senha para abrir locked.pdf')).toBeVisible({
		timeout: 30_000
	});
	await page.getByLabel('Senha de locked.pdf').fill('pw');
	await page.getByRole('button', { name: 'Desbloquear' }).click();

	await expect(page.getByRole('button', { name: /Juntar 3 arquivos/ })).toBeEnabled();
	await page.getByRole('button', { name: /Juntar 3 arquivos/ }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	const merged = openPdf(result.bytes);
	expect([0, 1, 2].map((i) => textOf(merged, i))).toEqual([
		expect.stringContaining('Alpha'),
		expect.stringContaining('Locked'),
		expect.stringContaining('Charlie')
	]);
});

test('redaction reviews tolerant matches and removes only the checked ones', async ({ page }) => {
	await page.goto('/redact-pdf');
	await page.setInputFiles(
		'input[type=file]',
		fixturePdf('s.pdf', ['Assinado por JOÃO DA SILVA', 'Testemunha Silvana Costa'])
	);

	// Lower case, no accent: still an exact match. "Silvana" is only partial.
	await page.getByLabel('Texto a remover').fill('joao da silva');
	await expect(page.getByText('1 ocorrência encontrada')).toBeVisible();
	await page.getByLabel('Texto a remover').fill('silva');
	await expect(page.getByRole('heading', { name: 'Ocorrências exatas (1)' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Dentro de outras palavras (1)' })).toBeVisible();
	await expect(page.getByRole('checkbox', { name: /Silvana/ })).not.toBeChecked();
	await expect(page.getByRole('checkbox', { name: /SILVA/ })).toBeChecked();

	await page.getByRole('button', { name: 'Tarjar 1 ocorrência' }).click();
	await expect(page.getByText('1 ocorrência removida em 1 página.')).toBeVisible();
	const result = await grabDownload(page, () => downloadButton(page).click());
	const doc = openPdf(result.bytes);
	expect(textOf(doc, 0)).not.toContain('SILVA');
	// The unchecked partial match survives, and so does the rest of the text.
	expect(textOf(doc, 1)).toContain('Silvana');
	expect(textOf(doc, 0)).toContain('Assinado por');
});

test('searching for absent text says so and offers nothing to redact', async ({ page }) => {
	await page.goto('/redact-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('s.pdf', ['Hello']));
	await page.getByLabel('Texto a remover').fill('NotPresent');
	await expect(page.getByText('Nada encontrado para "NotPresent".')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Marque o que tarjar' })).toBeDisabled();
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

	const heading = page.getByRole('heading', { name: /3\s+arquivos/ });
	await expect(heading).toBeVisible({ timeout: 30_000 });
	// The result takes focus, so keyboard users land on it.
	await expect(heading).toBeFocused();
	const result = await grabDownload(page, () =>
		page.getByRole('button', { name: /Baixar tudo/ }).click()
	);
	expect(result.name).toMatch(/\.zip$/);
	const names = zipNames(result.bytes);
	expect(names).toHaveLength(3);
	for (const name of names) expect(name).toMatch(/\.png$/);
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

test('text edits survive switching pages and are saved together', async ({ page }) => {
	await page.goto('/edit-pdf-text');
	await page.setInputFiles('input[type=file]', fixturePdf('e.pdf', ['FirstOld', 'SecondOld']));

	await expect(page.getByLabel('Linha 1')).toHaveValue(/FirstOld/, { timeout: 30_000 });
	await page.getByLabel('Linha 1').fill('FirstNew');
	await page.getByLabel('Página').selectOption({ label: '2' });
	await expect(page.getByLabel('Linha 1')).toHaveValue(/SecondOld/);
	await page.getByLabel('Linha 1').fill('SecondNew');
	await page.getByLabel('Página').selectOption({ label: '1' });
	await expect(page.getByLabel('Linha 1')).toHaveValue('FirstNew');

	await page.getByRole('button', { name: /Salvar 2 alterações/ }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	const doc = openPdf(result.bytes);
	expect(textOf(doc, 0)).toContain('FirstNew');
	expect(textOf(doc, 1)).toContain('SecondNew');
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
	await expect(detail(page, 'Criptografado')).toHaveText('Não');
	await expect(detail(page, 'Contém JavaScript')).toHaveText('Não');
	await expect(detail(page, 'Permitido')).toContainText('imprimir');
});

test('corrupting produces a file that no longer opens', async ({ page }) => {
	await page.goto('/corrupt-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('c.pdf', ['One']));
	await page.getByRole('button', { name: 'Corromper PDF' }).click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(() => openPdf(result.bytes).countPages()).toThrow();
});

test('compression produces a smaller file and says by how much', async ({ page }) => {
	const input = fixturePdf('big.pdf', ['One', 'Two', 'Three']);
	await page.goto('/compress-pdf');
	await page.setInputFiles('input[type=file]', input);
	await page.getByRole('button', { name: 'Comprimir PDF' }).click();

	await expect(page.getByText(/^De [\d.,]+ [KM]?B para [\d.,]+ [KM]?B \(\d+% menor\)/)).toBeVisible(
		{
			timeout: 30_000
		}
	);
	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(result.bytes.byteLength).toBeLessThan(readFileSync(input).byteLength);
	expect(openPdf(result.bytes).countPages()).toBe(3);
});
