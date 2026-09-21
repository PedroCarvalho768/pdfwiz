/**
 * Bundle budget. The whole product rests on the engine staying lazy: a
 * visitor who never drops a file must never download the ~10 MB MuPDF WASM.
 *
 * That property is invisible in code review and easy to lose to a stray
 * top-level import, so it is asserted here and run in CI.
 */
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUILD = 'build';
const ENTRY_BUDGET_KB = 120;

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else out.push(path);
	}
	return out;
}

const files = walk(BUILD);
const failures = [];

// 1. The engine belongs to the worker graph and nowhere else.
const strayWasm = files.filter(
	(f) => f.endsWith('.wasm') && !relative(BUILD, f).replaceAll('\\', '/').includes('workers/')
);
if (strayWasm.length)
	failures.push(
		`WASM outside the worker chunk: ${strayWasm.map((f) => relative(BUILD, f)).join(', ')}`
	);

// 2. No eagerly loaded chunk may mention the engine module.
const eager = files.filter((f) => {
	const rel = relative(BUILD, f).replaceAll('\\', '/');
	return f.endsWith('.js') && (rel.includes('/entry/') || rel.includes('/nodes/'));
});
for (const file of eager) {
	if (readFileSync(file, 'utf8').includes('mupdf-wasm'))
		failures.push(`${relative(BUILD, file)} references the engine; it must stay behind the worker`);
}

// 3. Keep the first paint small.
const entryBytes = eager.reduce((sum, f) => sum + gzipSync(readFileSync(f)).byteLength, 0);
const entryKb = entryBytes / 1024;
if (entryKb > ENTRY_BUDGET_KB)
	failures.push(
		`Initial JS is ${entryKb.toFixed(1)} KB gzip, over the ${ENTRY_BUDGET_KB} KB budget`
	);

if (failures.length) {
	console.error('Bundle budget failed:');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(
	`Bundle budget OK — ${entryKb.toFixed(1)} KB gzip initial JS (budget ${ENTRY_BUDGET_KB} KB), engine stays lazy.`
);
