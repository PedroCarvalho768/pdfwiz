# PDFWiz

52 ferramentas de PDF que rodam inteiramente no navegador. Juntar, dividir,
editar texto, converter, comprimir, assinar, tarjar, criptografar, tirar
senha e OCR, sem servidor, sem upload e sem conta.

Interface em pt-BR. As URLs continuam em inglês (`/merge-pdf`, `/unlock-pdf`)
porque são o ativo de busca do projeto e já estavam pré-renderizadas.

Produção: <https://pdf.rikode.com.br>

---

## How it works

One engine, one seam.

```
src/lib/engine/
  contract.ts   types shared by the UI and the worker, the only seam
  pages.ts      page-range maths (deliberately free of any mupdf import)
  draw.ts       content-stream drawing; the ONE place coordinates flip
  shared.ts     engine-internal helpers
  jobs/         every PDF capability, as plain functions over MuPDF
  worker.ts     message shim over jobs/; holds no PDF logic
  client.ts     main-thread handle on the worker
src/lib/tools/  registry.ts (the catalog) + components for custom UI
src/lib/ui/     ToolPage is the shared tool body; FormTool renders any field-driven tool; LocalProof is the hero
src/routes/
  +page.svelte        searchable tool index
  [tool]/+page.svelte ONE generic page that renders every tool (via ToolPage)
  sitemap.xml/        prerendered sitemap of all tool URLs
```

[MuPDF](https://mupdf.com/) does nearly all of the work: page manipulation,
rendering, text extraction, true redaction, annotations, form widgets,
encryption, compression and repair. It also reads Markdown, HTML, EPUB, MOBI,
CBZ, XPS, SVG and images, so most "X para PDF" converters are the same code
path with a different input type.

Four rules keep 52 tools from turning into sprawl:

1. **One generic tool route.** Adding a tool means one entry in
   `registry.ts`, never a new page, layout, form or download path.
2. **One job contract.** Nothing outside `src/lib/engine` imports `mupdf`.
3. **Declare, don't build.** A tool lists its fields and an `execute`;
   `FormTool.svelte` renders it. Only genuinely custom interaction (page
   grid, text editor, form filler, metadata, OCR) gets a component.
4. **MuPDF's journal is the undo stack** (`enableJournal()`). Do not build a
   parallel operation log.

## Design system

Tokens live in `src/routes/layout.css`, authored in OKLCH and named by role
(`--color-bg`, `--color-ink`, `--color-accent`), never by shade.

- **Type:** Archivo Variable driven on its width axis for display, Fragment
  Mono for measured numbers only. Both self-hosted via `@fontsource`; no
  render-blocking font CDN.
- **Colour:** one committed petrol accent (H 205). Deliberately not the
  category reflex (PDF tools are red: Adobe, iLovePDF, Smallpdf) and not the
  software reflex (indigo). Neutrals are tinted toward the same hue.
  `--color-danger` is the only second hue and always carries meaning.
- **Panel:** `--color-panel*` does not invert between schemes. The hero
  workbench holds white pages and stays dark in both.
- **Radius:** one system. Cards 12px, controls 8px.

The signature moment: **drop a PDF on the homepage and it renders your real
pages in the hero, beside numbers that were measured rather than written,
including the count of network requests made while processing.** It stays at
zero because there is no server. A site that uploads your file cannot ship
that component.

### Things that will bite you

Each of these cost real debugging time and is commented at the source:

- **Coordinates.** MuPDF page space runs y _down_ from the top-left, and
  every read API (structured text, search quads, `getBounds`, annotation
  rects) uses it. PDF user space runs y _up_. `draw.ts` is the only place
  they meet. A mistake here does not error, it silently draws in the wrong
  half of the page, which is why the tests assert vertical position.
- **Content streams can leave a dangling CTM.** MuPDF's own `DocumentWriter`
  emits `1 0 0 -1 0 h cm` and never balances it. Appending without wrapping
  the original in `q`/`Q` inherits that flip.
- **An image XObject is the indirect reference, not the resolved object.**
  `doc.newIndirect(n)` is a stream; `.resolve()` gives a dictionary that
  `loadImage` rejects.
- **MuPDF returns null _objects_, not `undefined`.** `?.` does not guard
  them; `isNull()` does.
- **Svelte `$state` proxies cannot be posted to a worker.** Hold worker
  results in `$state.raw`. `client.ts` turns the `DataCloneError` into an
  actionable message.
- **`@theme` does not work inside `@media`.** Tailwind v4 hoists those
  declarations to `:root`, which silently deletes the other colour scheme.
  Dark mode overrides the registered custom properties directly instead.
- **`getComputedStyle` returns `oklch(...)` for OKLCH tokens.** Any contrast
  script that parses colours as `rgb()` will read those three numbers as RGB
  and report nonsense. `e2e/audit.e2e.ts` resolves colours by painting them
  into a canvas and reading the pixel back.
- **The markdown parser drops the last character** when input does not end in
  a newline. Normalised on the way in.
- **`@tailwindcss/forms` paints every text control `#fff`** and leaves `color`
  inherited, so in dark mode typed text was near-white on white. The controls
  are themed once in `layout.css` (`html input:where(...)`, which outranks the
  plugin's `:where()` selectors). The audit fills real inputs to catch it.
- **Same-route navigation keeps component state.** `/merge-pdf` to
  `/split-pdf` is the same route with new params, so the tool body lives in
  `ToolPage.svelte` under `{#key tool.id}`. Do not reintroduce a reset effect.
- **A meta CSP does not reach workers.** The policy in `vite.config.ts` is
  emitted as `<meta http-equiv>` on every prerendered page and governs the
  document. Workers loaded from a URL (MuPDF, Tesseract) take their policy
  from their own response headers, so send the same policy as an HTTP header
  from the host to cover them.
- **tesseract.js loads code from a CDN by default.** Its worker and WASM core
  are bundled from `node_modules` instead (`?url` imports in `OcrTool.svelte`);
  only the language model comes from `cdn.jsdelivr.net`, and the page says so.

## Development

```bash
npm install
npm run dev
```

| Command                | What it does                                             |
| ---------------------- | -------------------------------------------------------- |
| `npm run test:unit`    | Engine tests, in Node. No browser, no mocks.             |
| `npm run test:e2e`     | Shared UI mechanisms plus the design audit, in Chromium. |
| `npm run check:bundle` | Fails if the engine leaks into the initial payload.      |
| `npm test`             | All of the above.                                        |
| `npm run build`        | Static site in `build/`, deployable to any CDN.          |

`e2e/audit.e2e.ts` is the design guard: it asserts zero horizontal overflow,
zero contrast failures, zero em-dashes, zero eyebrows, no tap target under
24x24 px and h1 at most 3 lines, across light and dark at 390 / 768 / 1440 on
the homepage and all 52 tool pages, plus a few tools with a file loaded and
inputs filled. `src/lib/tools/copy.spec.ts` is the copy guard: it scans the
catalog and every UI source file for English leftovers and pt-BR words typed
without accents. `pairs.txt` holds the resolved token pairs for a standalone
WCAG check.

The same `mupdf` package runs in Node, so every job handler is testable
headlessly. Assert by re-opening produced bytes, never on byte equality;
MuPDF output is not reproducible across versions.

The MuPDF WASM is ~3.6 MB brotli and is fetched only when a user first drops
a file. The initial payload is ~13 KB gzip. It is a single-threaded build, so
no COOP/COEP headers are needed.

`scripts/make-sample.mjs` renders the hero's sample pages with the same
engine at build time, so the idle hero carries a real document without
loading the WASM.

## Known ceilings

Stated plainly, and repeated in the UI on the tools they affect:

- **Text editing does not reflow.** Edited lines are redrawn in a base-14
  font at the original position; a much longer replacement overruns.
- **Office fidelity.** `.docx` and `.xlsx` go through an HTML bridge
  (mammoth / SheetJS). Structure survives; exact layout shifts.
- **PDF para Word** rebuilds paragraphs from the text layer. Tables, columns
  and images are not reconstructed.
- **PPTX** is not feasible client-side at an acceptable download size.
- **Signing** places an image on the page. It is not a cryptographic
  signature; PKCS#7 in the WASM build is unverified.
- **Grayscale and flatten-to-images rasterise**, destroying the text layer.
- **OCR downloads a language model** (`<lang>.traineddata.gz`) from
  `cdn.jsdelivr.net` on first use of each language. It is the only
  third-party request in the app, and the page CSP allows no other host. The
  document itself never leaves the device, and the tool says so on the page.

## Licence

AGPL-3.0-or-later, because MuPDF is AGPL. Section 13 requires offering source
to anyone who uses the software over a network, so the "Veja o código-fonte"
link in the footer is a licence obligation, not decoration. Do not remove it,
and keep it pointing at a repository that actually resolves.
