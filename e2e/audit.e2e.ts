/**
 * Design audit across viewports and both colour schemes.
 *
 * Contrast is measured by painting each colour into a canvas and reading the
 * pixel back. getComputedStyle returns `oklch(...)` for OKLCH-authored
 * tokens, and parsing those three numbers as RGB reports nonsense ratios.
 */
import { expect, test, type Page } from '@playwright/test';

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
  out.bareAccents = ['em um so','Fique so','estao',' nao ',' sao ','voce '].filter(w => document.body.innerText.includes(w));

  const fails = [];
  for (const el of document.querySelectorAll('p,span,a,li,h1,h2,h3,h4,h5,h6,button,label,small,dt,dd,input,summary,option')) {
    if (el.children.length) continue;
    const t = (el.innerText || el.placeholder || '').trim(); if (!t) continue;
    const r = el.getBoundingClientRect(); if (r.width<4 || r.height<4) continue;
    const cs = getComputedStyle(el); if (cs.visibility==='hidden' || +cs.opacity<0.5) continue;
    const bg = bgOf(el), fg = over(toRGBA(cs.color), bg);
    const ratio = (Math.max(lum(fg),lum(bg))+0.05)/(Math.min(lum(fg),lum(bg))+0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight,10)>=700;
    const need = (px>=24 || (bold && px>=18.66)) ? 3 : 4.5;
    if (ratio < need) fails.push(ratio.toFixed(2)+'<'+need+' '+Math.round(px)+'px "'+t.slice(0,44)+'"');
  }
  out.contrastFails = fails;

  out.smallTapTargets = [...document.querySelectorAll('a,button,input[type=checkbox],select')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 24 && r.width < 24; }).length;
  return out;
})()`;

const SIZES = [
	{ label: 'mobile', width: 390, height: 844 },
	{ label: 'tablet', width: 768, height: 1024 },
	{ label: 'desktop', width: 1440, height: 900 }
];

const PAGES = ['/', '/merge-pdf', '/protect-pdf'];

for (const scheme of ['light', 'dark'] as const) {
	for (const size of SIZES) {
		test(`${scheme} ${size.label} ${size.width}px`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.setViewportSize({ width: size.width, height: size.height });

			for (const path of PAGES) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				const m = (await page.evaluate(MEASURE)) as Record<string, unknown>;

				expect(m.overflowX, `${path} horizontal overflow: ${JSON.stringify(m.culprits)}`).toBe(0);
				expect(m.emDashes, `${path} em-dashes`).toBe(0);
				expect(m.bareAccents, `${path} words missing accents`).toEqual([]);
				expect(m.contrastFails, `${path} contrast`).toEqual([]);
				if (m.h1Lines !== undefined)
					expect(m.h1Lines as number, `${path} h1 lines at ${m.h1Size}`).toBeLessThanOrEqual(3);
				// Eyebrow budget: at most ceil(sections / 3). Zero is the target.
				expect(m.eyebrows, `${path} eyebrows`).toBe(0);
			}
		});
	}
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
