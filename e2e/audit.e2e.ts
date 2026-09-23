/**
 * Design audit across viewports and both colour schemes.
 *
 * Contrast is measured by painting each colour into a canvas and reading the
 * pixel back. getComputedStyle returns `oklch(...)` for OKLCH-authored
 * tokens, and parsing those three numbers as RGB reports nonsense ratios.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixturePdf } from './helpers';

const MEASURE = `(() => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const toRGBA = (css) => { if (cache.has(css)) return cache.get(css);
    ctx.clearRect(0,0,1,1); try { ctx.fillStyle = css; } catch { return [0,0,0,1]; }
    ctx.clearRect(0,0,1,1); ctx.fillRect(0,0,1,1);
    const d = ctx.getImageData(0,0,1,1).data; const v=[d[0],d[1],d[2],d[3]/255]; cache.set(css,v); return v; };
  const f = c => { c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
  const lum = ([r,g,b]) => 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
  const over = (fg,bg) => fg.slice(0,3).map((c,i)=>c*fg[3]+bg[i]*(1-fg[3]));
  const bgOf = el => { let n=el, st=[]; while(n){const c=toRGBA(getComputedStyle(n).backgroundColor);
      if(c[3]>0.01){st.push(c); if(c[3]>0.99)break;} n=n.parentElement;}
    let base=[255,255,255]; for(const c of st.reverse()) base=over(c,base); return base; };

  const de = document.documentElement, h1 = document.querySelector('h1');
  const out = { vw: innerWidth, overflowX: de.scrollWidth - de.clientWidth };
  out.culprits = [...document.querySelectorAll('*')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width>0 && (r.right>innerWidth+1 || r.left<-1); })
    .slice(0,6).map(el => el.tagName.toLowerCase()+'.'+String(el.className||'').split(/\\s+/)[0]);
  if (h1) { const cs = getComputedStyle(h1);
    out.h1Lines = Math.round(h1.getBoundingClientRect().height / (parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2));
    out.h1Size = cs.fontSize; }
  out.emDashes = (document.body.innerText.match(/\\u2014/g)||[]).length;
  out.eyebrows = [...document.querySelectorAll('*')].filter(el => { const c=getComputedStyle(el), t=el.innerText;
    return !el.children.length && c.textTransform==='uppercase' && parseFloat(c.letterSpacing)>0.5
      && t && t.trim().length>0 && t.trim().length<40; }).length;

  const fails = [];
  for (const el of document.querySelectorAll('p,span,a,li,h1,h2,h3,h4,h5,h6,button,label,small,dt,dd,input,summary,option')) {
    if (el.children.length) continue;
    // A filled control is judged on its value, not its placeholder: typed
    // text rendered in the wrong colour is exactly the bug to catch.
    const typed = el.matches('textarea, input:not([type=checkbox],[type=radio],[type=color],[type=file],[type=range])') ? el.value : '';
    const t = (typed || el.innerText || el.placeholder || '').trim(); if (!t) continue;
    const r = el.getBoundingClientRect(); if (r.width<4 || r.height<4) continue;
    const cs = getComputedStyle(el); if (cs.visibility==='hidden' || +cs.opacity<0.5) continue;
    const bg = bgOf(el), fg = over(toRGBA(cs.color), bg);
    const ratio = (Math.max(lum(fg),lum(bg))+0.05)/(Math.min(lum(fg),lum(bg))+0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight,10)>=700;
    const need = (px>=24 || (bold && px>=18.66)) ? 3 : 4.5;
    if (ratio < need) fails.push(ratio.toFixed(2)+'<'+need+' '+Math.round(px)+'px "'+t.slice(0,44)+'"');
  }
  out.contrastFails = fails;

  // WCAG 2.5.8: 24x24 CSS px. A checkbox or radio inside its <label> is hit
  // through the label, so the label's box is the target.
  out.smallTapTargets = [...document.querySelectorAll('a,button,input[type=checkbox],input[type=radio],select')]
    .map(e => (e.matches('input') && e.closest('label')) || e)
    // Visually hidden (sr-only, 1px) elements are not targets until focused.
    .filter(e => { const r = e.getBoundingClientRect(); return r.height > 1 && r.width > 1 && r.height < 24 && r.width < 24; })
    .map(e => e.tagName.toLowerCase() + ' "' + (e.getAttribute('aria-label') || e.innerText || '').slice(0, 30) + '"');
  return out;
})()`;

const SIZES = [
	{ label: 'mobile', width: 390, height: 844 },
	{ label: 'tablet', width: 768, height: 1024 },
	{ label: 'desktop', width: 1440, height: 900 }
];

// Every tool page, read from the catalog source rather than imported: the
// registry pulls in $lib aliases that do not resolve under Playwright.
const TOOL_IDS = [
	...readFileSync('src/lib/tools/registry.ts', 'utf8').matchAll(/^\t\tid: '([a-z0-9-]+)',$/gm)
].map((match) => match[1]);
const PAGES = ['/', ...TOOL_IDS.map((id) => `/${id}`)];

type Measured = Record<string, unknown>;

function assertDesign(m: Measured, where: string) {
	expect(m.overflowX, `${where} horizontal overflow: ${JSON.stringify(m.culprits)}`).toBe(0);
	expect(m.emDashes, `${where} em-dashes`).toBe(0);
	expect(m.contrastFails, `${where} contrast`).toEqual([]);
	expect(m.smallTapTargets, `${where} tap targets under 24px`).toEqual([]);
	if (m.h1Lines !== undefined)
		expect(m.h1Lines as number, `${where} h1 lines at ${m.h1Size}`).toBeLessThanOrEqual(3);
	// Eyebrow budget: at most ceil(sections / 3). Zero is the target.
	expect(m.eyebrows, `${where} eyebrows`).toBe(0);
}

test('the catalog lists every tool, and so does the sitemap', async ({ page }) => {
	expect(TOOL_IDS).toHaveLength(52);
	const sitemap = await (await page.request.get('/sitemap.xml')).text();
	for (const id of TOOL_IDS) expect(sitemap).toContain(`https://pdf.rikode.com.br/${id}</loc>`);
});

for (const scheme of ['light', 'dark'] as const) {
	for (const path of PAGES) {
		test(`${scheme} ${path}`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(path);
			// Fonts must be in before h1 line counts mean anything.
			await page.waitForLoadState('networkidle');
			for (const size of SIZES) {
				await page.setViewportSize({ width: size.width, height: size.height });
				const m = (await page.evaluate(MEASURE)) as Measured;
				assertDesign(m, `${path} at ${size.width}px`);
			}
		});
	}

	// Controls only render once a file is in, and the dark-mode bug that hid
	// typed text lived exactly there. Fill the inputs, then measure.
	test(`${scheme} loaded tools with typed values`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme });
		const pdf = fixturePdf('audit.pdf', ['One', 'Two']);
		const cases: [string, () => Promise<void>][] = [
			['/pdf-metadata', () => page.getByLabel('Título').fill('Valor digitado')],
			['/protect-pdf', () => page.getByLabel('Senha para abrir').fill('segredo')],
			['/watermark-pdf', () => page.getByLabel('Páginas').fill('1-2')],
			['/organize-pdf', () => expect(page.getByRole('img', { name: 'Página 2' })).toBeVisible()]
		];
		for (const [path, fill] of cases) {
			await page.goto(path);
			await page.setInputFiles('input[type=file]', pdf);
			await fill();
			for (const size of SIZES) {
				await page.setViewportSize({ width: size.width, height: size.height });
				assertDesign(
					(await page.evaluate(MEASURE)) as Measured,
					`${path} loaded at ${size.width}px`
				);
			}
		}
	});
}

test('screenshots for review', async ({ page }: { page: Page }) => {
	const dir = process.env.SHOT_DIR;
	test.skip(!dir, 'SHOT_DIR not set');
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const size of SIZES) {
			await page.setViewportSize({ width: size.width, height: size.height });
			await page.goto('/');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/${scheme}-${size.label}.png`, fullPage: true });
		}
	}
});
