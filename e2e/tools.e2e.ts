/**
 * One happy path per tool group, driven through the real UI.
 *
 * PDF behaviour is covered by the Node unit tests in `src/lib/engine`. These
 * tests only guard what Node cannot see: bundling, worker startup, the WASM
 * fetch, the message channel and the download path.
 */
import { expect, test } from '@playwright/test';
import {
	downloadButton,
	fixturePdf,
	grabDownload,
	openPdf,
	pageTexts,
	textOf,
	zipNames
} from './helpers';

test('merges documents in the order shown, after reordering and removing', async ({ page }) => {
	const failures: string[] = [];
	page.on('pageerror', (error) => failures.push(error.message));

	await page.goto('/merge-pdf');
	await page.setInputFiles('input[type=file]', [
		fixturePdf('alpha.pdf', ['Alpha']),
		fixturePdf('bravo.pdf', ['Bravo'])
	]);
	await expect(page.getByRole('button', { name: /Juntar 2 arquivos/ })).toBeEnabled({
		timeout: 30_000
	});

	// Adding a third file must not undo the manual order.
	await page.getByRole('button', { name: 'Mover bravo.pdf para cima' }).click();
	await page.setInputFiles('input[type=file]', fixturePdf('charlie.pdf', ['Charlie']));
	await expect(page.getByRole('button', { name: /Juntar 3 arquivos/ })).toBeEnabled();

	await page.getByRole('button', { name: 'Remover alpha.pdf' }).click();
	const mergeButton = page.getByRole('button', { name: /Juntar 2 arquivos/ });
	await expect(mergeButton).toBeEnabled();
	await mergeButton.click();

	const result = await grabDownload(page, () => downloadButton(page).click());
	const texts = pageTexts(result.bytes);
	expect(texts).toHaveLength(2);
	expect(texts[0]).toContain('Bravo');
	expect(texts[1]).toContain('Charlie');
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
	expect(zipNames(result.bytes)).toEqual(['three-1.pdf', 'three-2.pdf', 'three-3.pdf']);
});

test('reorders and deletes pages, and saves the result', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));

	// Wait for thumbnails, which proves the streaming render path ran.
	await expect(page.getByRole('img', { name: 'Página 1' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('img', { name: 'Página 3' })).toBeVisible();

	await page.getByRole('button', { name: 'Excluir página 1' }).click();
	await expect(page.getByText('2 de 3 páginas mantidas')).toBeVisible();

	await page.getByRole('button', { name: 'Salvar PDF' }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());

	const saved = openPdf(result.bytes);
	expect(saved.countPages()).toBe(2);
	expect(textOf(saved, 0)).toContain('Two');
});

test('a deleted page can be brought back with Desfazer', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));
	await expect(page.getByRole('img', { name: 'Página 2' })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Excluir página 2' }).click();
	await expect(page.getByText('2 de 3 páginas mantidas')).toBeVisible();
	await page.getByRole('button', { name: 'Desfazer' }).click();
	await expect(page.getByText('3 de 3 páginas mantidas')).toBeVisible();
	await expect(page.getByRole('img', { name: 'Página 2' })).toBeVisible();
});

test('reorders pages from the keyboard alone', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('three.pdf', ['One', 'Two', 'Three']));
	await expect(page.getByRole('img', { name: 'Página 3' })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Mover página 1 para frente' }).focus();
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Mover página 1 para frente' }).focus();
	await page.keyboard.press('Space');

	await page.getByRole('button', { name: 'Salvar PDF' }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	const texts = pageTexts(result.bytes);
	expect(texts[0]).toContain('Two');
	expect(texts[1]).toContain('Three');
	expect(texts[2]).toContain('One');
});

test('rotates a page and carries the rotation into the saved file', async ({ page }) => {
	await page.goto('/organize-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('two.pdf', ['One', 'Two']));

	const firstThumb = page.getByRole('img', { name: 'Página 1' });
	await expect(firstThumb).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: 'Girar página 1 à direita' }).click();
	// The preview must actually turn; a silent no-op here shipped once already.
	await expect(firstThumb).toHaveAttribute('style', /rotate\(90deg\)/);

	await page.getByRole('button', { name: 'Salvar PDF' }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());

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
