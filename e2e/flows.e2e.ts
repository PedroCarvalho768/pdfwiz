/**
 * The custom-component tools and the page lifecycle around them: saving
 * values that start life in Svelte state, and state that must not survive
 * a navigation.
 */
import { expect, test } from '@playwright/test';
import {
	downloadButton,
	fixturePdf,
	formPdf,
	grabDownload,
	openPdf,
	pageTexts,
	widgetValues
} from './helpers';

test('metadata edits save and read back', async ({ page }) => {
	const failures: string[] = [];
	page.on('pageerror', (error) => failures.push(error.message));

	await page.goto('/pdf-metadata');
	await page.setInputFiles('input[type=file]', fixturePdf('meta.pdf', ['One']));
	await page.getByLabel('Título').fill('Relatório anual');
	await page.getByLabel('Autor').fill('Maria Silva');
	await page.getByRole('button', { name: 'Salvar metadados' }).click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	const doc = openPdf(result.bytes);
	expect(doc.getMetaData('info:Title')).toBe('Relatório anual');
	expect(doc.getMetaData('info:Author')).toBe('Maria Silva');

	// And the app itself reads it back.
	await page.goto('/pdf-info');
	await page.setInputFiles('input[type=file]', result.path);
	await page.getByRole('button', { name: 'Inspecionar PDF' }).click();
	await expect(page.getByRole('definition').filter({ hasText: 'Relatório anual' })).toBeVisible();
	await expect(page.getByRole('term').filter({ hasText: /^Título$/ })).toBeVisible();
	expect(failures).toEqual([]);
});

test('a form fills, saves only what changed, and reads back', async ({ page }) => {
	await page.goto('/fill-pdf-form');
	await page.setInputFiles('input[type=file]', formPdf('form.pdf'));

	// The field is reachable by its label, which proves the association.
	const name = page.getByRole('textbox', { name: /Nome completo/ });
	await expect(name).toBeVisible({ timeout: 30_000 });
	await name.fill('Maria Silva');
	await page.getByRole('checkbox', { name: /Concordo/ }).check();
	// A radio group renders as one group of options, not a checkbox per widget.
	await expect(page.getByRole('group', { name: /Plano/ }).getByRole('radio')).toHaveCount(3);
	await page.getByRole('radio', { name: 'Pro' }).check();

	await page.getByRole('button', { name: 'Salvar formulário preenchido' }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(result.name).toBe('form-preenchido.pdf');
	expect(widgetValues(result.bytes)).toEqual({
		fullname: 'Maria Silva',
		agree: 'Sim',
		plano: 'Pro'
	});
});

test('inserts blank pages before the chosen source pages and at the end', async ({ page }) => {
	await page.goto('/insert-blank-pages');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));

	// "3" is a source page, not an output position; "4" means after the last.
	await page.getByLabel('Inserir antes destas páginas').fill('1,3,4');
	await page.getByRole('button', { name: 'Inserir páginas em branco' }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(pageTexts(result.bytes)).toEqual(['', 'One', 'Two', '', 'Three', '']);
});

test('navigating to another tool starts it clean', async ({ page }) => {
	await page.goto('/fill-pdf-form');
	await page.setInputFiles('input[type=file]', fixturePdf('plain.pdf', ['NoFields']));
	await expect(page.getByText('Este PDF não tem campos preenchíveis')).toBeVisible({
		timeout: 30_000
	});

	// Same route, different params: a client-side navigation, not a reload.
	await page.getByRole('link', { name: 'Carimbo ou assinatura' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Carimbo ou assinatura');
	await expect(page.getByText('plain.pdf', { exact: true })).toBeHidden();
	await expect(page.getByText('Solte o arquivo aqui ou clique para escolher')).toBeVisible();
});

test('a single-file tool can swap its file after loading', async ({ page }) => {
	await page.goto('/pdf-to-text');
	await page.setInputFiles('input[type=file]', fixturePdf('first.pdf', ['FirstFile']));
	await expect(page.getByText('first.pdf', { exact: true })).toBeVisible();

	await page
		.getByText('Trocar arquivo')
		.locator('input[type=file]')
		.setInputFiles(fixturePdf('second.pdf', ['SecondFile']));
	await expect(page.getByText('second.pdf', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'PDF para texto' }).click();
	await page.locator('summary', { hasText: 'Prévia' }).click();
	await expect(page.locator('pre')).toContainText('SecondFile');
});

test('a file dropped outside a drop zone does not navigate away', async ({ page }) => {
	await page.goto('/pdf-to-text');
	await page.setInputFiles('input[type=file]', fixturePdf('keep.pdf', ['Keep']));
	await expect(page.getByText('keep.pdf', { exact: true })).toBeVisible();

	const prevented = await page.evaluate(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['x'], 'stray.pdf', { type: 'application/pdf' }));
		const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
		document.querySelector('h1')!.dispatchEvent(drop);
		return drop.defaultPrevented;
	});
	expect(prevented).toBe(true);
	await expect(page.getByText('keep.pdf', { exact: true })).toBeVisible();
});
