/**
 * The interface is pt-BR. Two ways that silently rots: an English string
 * left behind, and Portuguese typed without its accents ("nao", "posicao").
 * Neither breaks anything a type checker or a click test can see, so this
 * scans every user-facing string: the catalog's copy, and the text and
 * string literals of every UI source file outside the engine.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tools } from './registry';

/** Common pt-BR words as they look with the accents dropped. */
const UNACCENTED = new Set(
	(
		'nao voce voces sao estao entao conteudo conteudos posicao posicoes pagina paginas ' +
		'ocorrencia ocorrencias informacao informacoes numero numeros titulo titulos codigo ' +
		'codigos tambem ate ja so vao opcao opcoes versao versoes padrao padroes minimo maximo ' +
		'possivel impossivel disponivel automatico automatica automaticamente unico unica ' +
		'proximo proxima ultimo ultima invalido invalida obrigatorio alteracao alteracoes ' +
		'configuracao configuracoes digitalizacao protecao criacao conversao compressao ' +
		'resolucao rotacao selecao funcao acao acoes permissao permissoes restricao restricoes ' +
		'razao voltara ja atraves facil dificil rapido util inutil necessario necessaria ' +
		'propria proprio seguranca orgao faca apos alem porem tres ' +
		'medio media ultimos memoria historico analise area areas'
	)
		.split(/\s+/)
		.filter(Boolean)
);

/** English words that have no business in a pt-BR interface. */
const ENGLISH = new Set(
	(
		'the your you click drop files here page pages enter password leave empty every could ' +
		'not this that with from choose select loading failed please save download upload ' +
		'only into which have has will would should there their what when where and or to ' +
		'of is are it be was been can cannot any found returned ' +
		'document documents field fields add remove delete undo reset ' +
		'processing done ready error open close back next previous yes'
	)
		.split(/\s+/)
		.filter(Boolean)
);

// Words that collide with valid Portuguese or with values the UI must pass
// through verbatim (PDF names, on-states, font names).
const ENGLISH_ALLOWED = new Set(['no', 'a', 'e', 'yes']);

const words = (text: string) => text.match(/\p{L}+/gu) ?? [];

function hits(text: string) {
	const found: string[] = [];
	for (const word of words(text)) {
		const lower = word.toLowerCase();
		if (UNACCENTED.has(lower)) found.push(`sem acento: ${word}`);
		// Only lowercase or capitalised tokens: camelCase and ALLCAPS are code.
		if (ENGLISH.has(lower) && !ENGLISH_ALLOWED.has(lower) && /^[A-Z]?[a-z]+$/.test(word))
			found.push(`inglês: ${word}`);
	}
	return found;
}

// ponytail: redact-pdf is being redesigned on another branch, which owns its
// copy ("ocorrencias", "e apagado"). Remove this exemption when it lands.
const PENDING_REDESIGN = new Set(['redact-pdf']);

/** Every string the catalog shows: titles, blurbs, notes, field copy. */
function catalogCopy(): [string, string][] {
	const out: [string, string][] = [];
	for (const tool of tools) {
		if (PENDING_REDESIGN.has(tool.id)) continue;
		const at = (part: string) => `${tool.id} ${part}`;
		out.push([at('title'), tool.title], [at('blurb'), tool.blurb], [at('group'), tool.group]);
		if (tool.note) out.push([at('note'), tool.note]);
		for (const field of tool.fields ?? []) {
			out.push([at(`${field.key}.label`), field.label]);
			if (field.help) out.push([at(`${field.key}.help`), field.help]);
			if ('placeholder' in field && field.placeholder)
				out.push([at(`${field.key}.placeholder`), field.placeholder]);
			if ('default' in field && typeof field.default === 'string')
				out.push([at(`${field.key}.default`), field.default]);
			if (field.kind === 'select')
				for (const option of field.options) out.push([at(`${field.key}.option`), option.label]);
		}
	}
	return out;
}

/** Tailwind class lists: most tokens carry a variant or a dash. */
function isClassList(text: string) {
	const tokens = text.trim().split(/\s+/);
	return tokens.filter((token) => /[-:[]/.test(token)).length * 2 >= tokens.length;
}

const ROOT = join(process.cwd(), 'src');
const ENGINE = join(ROOT, 'lib', 'engine');

function sourceFiles(dir = ROOT): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (path === ENGINE) return [];
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(name) && !/\.(spec|test)\.ts$/.test(name) ? [path] : [];
	});
}

/**
 * The prose in a source file: string literals, plus markup text for Svelte.
 * Comments, imports and the directory's search keywords (which deliberately
 * include accent-free spellings people type) are dropped first.
 */
function proseOf(source: string, svelte: boolean): string[] {
	let code = source
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
		.replace(/^\s*import\s.*$/gm, ' ')
		// Developer diagnostics, not interface copy.
		.replace(/console\.\w+\([^)]*\)/g, ' ')
		.replace(/keywords:\s*\[[^\]]*\]/g, ' ');
	for (const id of PENDING_REDESIGN)
		code = code.replace(new RegExp(`id: '${id}',[\\s\\S]*?\\n\\t\\},`), ' ');
	// Template interpolations, innermost first so nested literals go too. The
	// placeholder is neither a letter nor a space, so `${stem}-rotated.pdf`
	// still reads as one code-like token.
	for (let previous = ''; previous !== code;) {
		previous = code;
		code = code.replace(/\$\{[^{}]*\}/g, '·');
	}

	const literals = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)]
		// Svelte attribute expressions inside a quoted value are code too.
		.map((m) => m[0].slice(1, -1).replace(/\{[^{}]*\}/g, '·'))
		// A literal with no space and no capital is a key, an id or a path.
		.filter((text) => /\s/.test(text) || /^\p{Lu}/u.test(text))
		.filter((text) => !isClassList(text));

	if (!svelte) return literals;

	let markup = code
		.replace(/<script[\s\S]*?<\/script>/g, ' ')
		.replace(/<style[\s\S]*?<\/style>/g, ' ');
	// Innermost expressions first, so arrow functions (`=>`) are gone before
	// the tag pattern sees them.
	for (let previous = ''; previous !== markup;) {
		previous = markup;
		markup = markup.replace(/\{[^{}]*\}/g, ' ');
	}
	return [...literals, markup.replace(/<[^>]*>/g, ' ')];
}

describe('pt-BR copy', () => {
	it('the catalog has no English leftovers or missing accents', () => {
		const problems = catalogCopy().flatMap(([where, text]) =>
			hits(text).map((hit) => `${where}: ${hit} in "${text}"`)
		);
		expect(problems).toEqual([]);
	});

	it('UI source files have no English leftovers or missing accents', () => {
		const problems = sourceFiles().flatMap((file) => {
			const where = relative(ROOT, file);
			return proseOf(readFileSync(file, 'utf8'), file.endsWith('.svelte')).flatMap((text) =>
				hits(text).map((hit) => `${where}: ${hit} in "${text.trim().slice(0, 80)}"`)
			);
		});
		expect(problems).toEqual([]);
	});

	it('the detectors catch what they are for', () => {
		expect(hits('Nao e possivel abrir a pagina')).toEqual([
			'sem acento: Nao',
			'sem acento: possivel',
			'sem acento: pagina'
		]);
		expect(hits('Drop files here, or click to choose')).toHaveLength(7);
		expect(hits('Não é possível abrir a página')).toEqual([]);

		const prose = proseOf(
			`<script>throw new Error('Nao foi');</script>\n<span class="text-sm">Drop {n} files</span>`,
			true
		).join(' ');
		expect(hits(prose)).toEqual(['sem acento: Nao', 'inglês: Drop', 'inglês: files']);
	});
});
