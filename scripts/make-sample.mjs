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
	`# Contrato de Prestação de Serviços

**Entre** Levantamentos Halden Ltda. e o Contratante.

Este contrato define as condições em que o levantamento é feito, as
responsabilidades de cada parte e a forma de cobrança.

## 1. Objeto

A contratada fará o levantamento descrito no Anexo A e entregará um
relatório escrito em até vinte dias úteis após a visita ao local.

## 2. Honorários

Os honorários são fixos para o escopo do Anexo A. Trabalho fora desse
escopo é combinado por escrito antes de começar.

## 3. Confidencialidade

Nenhuma das partes divulga informação confidencial da outra sem
consentimento escrito, durante o contrato ou depois dele.
`,
	`## 4. Responsabilidade

A responsabilidade total da contratada limita-se aos honorários pagos pelo
trabalho que deu origem à reclamação.

## 5. Rescisão

Qualquer parte pode encerrar este contrato com aviso escrito de trinta
dias. O trabalho feito até essa data continua devido.

## Anexo A

| Item | Detalhe |
| --- | --- |
| Local | Galpão 4, Distrito Industrial Halden |
| Tipo | Levantamento métrico da edificação |
| Entrega | Relatório, plantas e fachadas |
| Visita | Em até 10 dias úteis |
`,
	`## Assinaturas

Pela Levantamentos Halden Ltda.

Nome: ..............................................

Cargo: .............................................

Data: ..............................................

Pelo Contratante.

Nome: ..............................................

Cargo: .............................................

Data: ..............................................
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
