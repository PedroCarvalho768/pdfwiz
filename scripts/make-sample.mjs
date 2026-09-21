/**
 * Render the hero's sample document at build time.
 *
 * The homepage hero shows real rendered PDF pages, not an illustration of
 * some. Loading the engine just to draw the idle state would pull the ~3.6 MB
 * WASM into first paint and break the bundle budget, so the same engine
 * renders them here instead and ships three small images.
 *
 * Run: node scripts/make-sample.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as mupdf from 'mupdf';

const OUT = 'static/sample';
const encode = (s) => new TextEncoder().encode(s);

/**
 * Deliberately mundane content: the hero should look like the boring
 * document someone actually needs to fix, not a design mockup.
 */
const PAGES = [
	`# Service Agreement

**Between** Halden Survey Ltd and the Client.

This agreement sets out the terms under which survey work is carried out,
what each party is responsible for, and how the work is invoiced.

## 1. Scope

The supplier will carry out the survey described in Schedule A and deliver a
written report within twenty working days of the site visit.

## 2. Fees

Fees are fixed for the scope in Schedule A. Work outside that scope is
agreed in writing before it starts.

## 3. Confidentiality

Neither party discloses the other's confidential information without written
consent, during the agreement or after it ends.
`,
	`## 4. Liability

The supplier's total liability under this agreement is limited to the fees
paid for the work giving rise to the claim.

## 5. Termination

Either party may end this agreement with thirty days' written notice. Work
completed up to that date remains payable.

## Schedule A

| Item | Detail |
| --- | --- |
| Site | Unit 4, Halden Industrial Estate |
| Survey type | Measured building survey |
| Deliverable | Report, floor plans, elevations |
| Site visit | Within 10 working days |
`,
	`## Signatures

Signed for and on behalf of Halden Survey Ltd.

Name: ..............................................

Position: ..........................................

Date: ..............................................

Signed for and on behalf of the Client.

Name: ..............................................

Position: ..........................................

Date: ..............................................
`
];

mkdirSync(OUT, { recursive: true });

PAGES.forEach((markdown, index) => {
	// Trailing newline matters: MuPDF's markdown parser drops the last
	// character without it. See normaliseInput() in src/lib/engine/shared.ts.
	const source = mupdf.Document.openDocument(encode(markdown + '\n'), 'text/markdown');
	const page = source.loadPage(0);
	// 2x for crisp rendering on the displays this will actually be read on.
	const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
	const file = `${OUT}/page-${index + 1}.png`;
	writeFileSync(file, pixmap.asPNG());
	console.log(`${file}  ${pixmap.getWidth()}x${pixmap.getHeight()}`);
	pixmap.destroy();
});

console.log(`Rendered ${PAGES.length} sample pages with the same engine the app uses.`);
