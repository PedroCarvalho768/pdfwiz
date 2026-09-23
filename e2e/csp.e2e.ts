/**
 * The Content-Security-Policy is what makes "nothing leaves your device"
 * enforceable, so a flow that trips it is broken even if it looks fine: the
 * browser blocked something the app tried to do. Every flow here records
 * violations from the first byte of the page.
 */
import { expect, test, type Page } from '@playwright/test';
import { downloadButton, fixturePdf, grabDownload, pageTexts } from './helpers';

async function recordViolations(page: Page) {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __csp: string[] }).__csp = seen;
		document.addEventListener('securitypolicyviolation', (event) =>
			seen.push(`${event.violatedDirective} ${event.blockedURI}`)
		);
	});
	return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('the policy ships on every page', async ({ page }) => {
	await page.goto('/merge-pdf');
	const policy = await page
		.locator('meta[http-equiv="content-security-policy"]')
		.getAttribute('content');
	expect(policy).toContain("default-src 'self'");
	expect(policy).toContain("connect-src 'self' https://cdn.jsdelivr.net/npm/@tesseract.js-data/");
	expect(policy).toContain("object-src 'none'");
});

test('dropping a file on the homepage hero violates nothing', async ({ page }) => {
	const violations = await recordViolations(page);
	await page.goto('/');
	await page
		.getByRole('region', { name: 'Teste aqui' })
		.locator('input[type=file]')
		.setInputFiles(fixturePdf('hero.pdf', ['Hero']));
	await expect(page.getByRole('term').filter({ hasText: /^rede$/ })).toBeVisible({
		timeout: 30_000
	});
	expect(await violations()).toEqual([]);
});

test('a merge violates nothing', async ({ page }) => {
	const violations = await recordViolations(page);
	await page.goto('/merge-pdf');
	await page.setInputFiles('input[type=file]', [
		fixturePdf('a.pdf', ['A']),
		fixturePdf('b.pdf', ['B'])
	]);
	await page.getByRole('button', { name: /Juntar 2 arquivos/ }).click();
	const result = await grabDownload(page, () => downloadButton(page).click());
	expect(pageTexts(result.bytes)).toEqual(['A', 'B']);
	expect(await violations()).toEqual([]);
});

test('the OCR page loads its code from this origin and violates nothing', async ({ page }) => {
	const violations = await recordViolations(page);
	const thirdParty: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') thirdParty.push(url.href);
	});

	await page.goto('/ocr-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('scan.pdf', ['Scan']));
	await expect(page.getByRole('button', { name: 'Rodar OCR' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('cdn.jsdelivr.net')).toBeVisible();
	expect(await violations()).toEqual([]);
	// Nothing leaves the origin until OCR actually runs.
	expect(thirdParty).toEqual([]);
});

test('running OCR fetches only the language model from outside', async ({ page }) => {
	test.skip(!!process.env.OFFLINE, 'needs the language model from cdn.jsdelivr.net');
	test.setTimeout(180_000);
	const violations = await recordViolations(page);
	const thirdParty: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') thirdParty.push(url.href);
	});

	await page.goto('/ocr-pdf');
	await page.setInputFiles('input[type=file]', fixturePdf('scan.pdf', ['Scan']));
	await page.getByLabel('Idioma').selectOption('eng');
	await page.getByRole('button', { name: 'Rodar OCR' }).click();
	await expect(downloadButton(page)).toBeVisible({ timeout: 150_000 });

	expect(await violations()).toEqual([]);
	expect(thirdParty).toEqual([
		'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
	]);
});
