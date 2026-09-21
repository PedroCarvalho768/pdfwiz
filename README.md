# PDFWiz

52 PDF tools that run entirely in your browser. Merge, split, edit text,
convert, compress, sign, redact, encrypt, unlock, OCR — with no server, no
upload and no account.

Files are opened, edited and saved on the user's own device. There is no
backend to send them to, which is both the privacy story and the reason
hosting costs nothing at any traffic level.

## How it works

One engine, one seam.

```
src/lib/engine/
  contract.ts   types shared by the UI and the worker — the only seam
  pages.ts      page-range maths (deliberately free of any mupdf import)
  draw.ts       content-stream drawing; the ONE place coordinates flip
  shared.ts     engine-internal helpers
  jobs/         every PDF capability, as plain functions over MuPDF
  worker.ts     message shim over jobs/; holds no PDF logic
  client.ts     main-thread handle on the worker
src/lib/tools/  registry.ts (the catalog) + components for custom UI
src/lib/ui/     FormTool renders any field-driven tool
src/routes/
  +page.svelte        searchable tool directory
  [tool]/+page.svelte ONE generic page that renders every tool
```

[MuPDF](https://mupdf.com/) does nearly all of the work: page manipulation,
rendering, text extraction, true redaction, annotations, form widgets,
encryption, compression and repair. It also reads Markdown, HTML, EPUB, MOBI,
CBZ, XPS, SVG and images, so most "X to PDF" converters are the same code path
with a different input type.

Four rules keep 52 tools from turning into sprawl:

1. **One generic tool route.** Adding a tool means one entry in
   `registry.ts` — never a new page, layout, form or download path.
2. **One job contract.** Nothing outside `src/lib/engine` imports `mupdf`.
3. **Declare, don't build.** A tool lists its fields and an `execute`;
   `FormTool.svelte` renders it. Only genuinely custom interaction (page
   grid, text editor, OCR progress) gets a component.
4. **MuPDF's journal is the undo stack** (`enableJournal()`). Do not build a
   parallel operation log.

### Things that will bite you

Each of these cost real debugging time and is commented at the source:

- **Coordinates.** MuPDF page space runs y _down_ from the top-left, and every
  read API (structured text, search quads, `getBounds`, annotation rects) uses
  it. PDF user space runs y _up_. `draw.ts` is the only place they meet. A
  mistake here does not error — it silently draws in the wrong half of the
  page, which is why tests assert vertical position, not just text presence.
- **Content streams can leave a dangling CTM.** MuPDF's own `DocumentWriter`
  emits `1 0 0 -1 0 h cm` and never balances it. Appending content without
  wrapping the original in `q`/`Q` inherits that flip. `draw.ts` isolates it.
- **An image XObject is the indirect reference, not the resolved object.**
  `doc.newIndirect(n)` is a stream; `.resolve()` gives a dictionary that
  `loadImage` rejects.
- **MuPDF returns null _objects_, not `undefined`.** `?.` does not guard them;
  `isNull()` does.
- **Svelte `$state` proxies cannot be posted to a worker.** Hold worker
  results in `$state.raw`. `client.ts` turns the resulting `DataCloneError`
  into an actionable message.
- **The markdown parser drops the last character** when input does not end in
  a newline. Normalised on the way in.

## Development

```bash
npm install
npm run dev
```

| Command                | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm run test:unit`    | Engine tests, in Node. No browser, no mocks.        |
| `npm run test:e2e`     | Shared UI mechanisms, in Chromium.                  |
| `npm run check:bundle` | Fails if the engine leaks into the initial payload. |
| `npm test`             | All of the above.                                   |
| `npm run build`        | Static site in `build/`, deployable to any CDN.     |

The same `mupdf` package runs in Node, so every job handler is testable
headlessly — the worker is only a message shim. Assert by re-opening produced
bytes, never on byte equality; MuPDF output is not reproducible across
versions.

The e2e suite deliberately does **not** test all 52 tools. It tests the
mechanisms they share: the field renderer, the raw-input path, the password
prompt, a custom component, text previews and zip output.

The MuPDF WASM is ~3.6 MB brotli and is fetched only when a user first drops a
file. `check:bundle` enforces that; the initial payload is ~11 KB gzip. It is
a single-threaded build, so no COOP/COEP headers are needed and it deploys to
any static host as-is.

## Known ceilings

Stated plainly rather than papered over, and repeated in the UI on the tools
they affect:

- **Text editing does not reflow.** Edited lines are redrawn in a base-14
  font at the original position; the surrounding paragraph does not move and a
  much longer replacement overruns. No free engine reflows PDF text.
- **Office fidelity.** `.docx` and `.xlsx` go through an HTML bridge
  (mammoth / SheetJS). Structure survives; exact layout, columns and floating
  images shift.
- **PDF to Word** rebuilds paragraphs from the text layer. Tables, columns and
  images are not reconstructed.
- **PPTX** is not feasible client-side at an acceptable download size. Out of
  scope.
- **Signing** places an image on the page. It is not a cryptographic
  signature; PKCS#7 in the WASM build is unverified.
- **Grayscale and flatten-to-images rasterise**, destroying the text layer.
  Both say so before you run them.
- **OCR downloads a language model** from a public CDN on first use. The
  document itself still never leaves the device, and the tool says this on the
  page.

## Licence

AGPL-3.0-or-later, because MuPDF is AGPL. Section 13 requires offering source
to anyone who uses the software over a network, so the "Get the source code"
link in the footer is a licence obligation — not decoration. Do not remove it.
