/**
 * Tool declarations.
 *
 * Most tools are pure configuration: a list of form fields plus an `execute`
 * function. `FormTool.svelte` renders any of them, so adding a tool costs one
 * entry here and no new components, routes or download plumbing. Only tools
 * needing genuinely custom interaction (a page grid, a text editor, a
 * signature pad) supply a `component`.
 */
import type { Component } from 'svelte';
import type { DocInfo, OutputFile } from '$lib/engine/contract';

export type ToolGroup =
	| 'Organizar'
	| 'Converter para PDF'
	| 'Converter de PDF'
	| 'Editar'
	| 'Segurança'
	| 'Otimizar'
	| 'Extrair';

export const GROUP_ORDER: ToolGroup[] = [
	'Organizar',
	'Editar',
	'Converter para PDF',
	'Converter de PDF',
	'Segurança',
	'Otimizar',
	'Extrair'
];

export type Field =
	| {
			kind: 'text';
			key: string;
			label: string;
			placeholder?: string;
			default?: string;
			help?: string;
	  }
	| {
			kind: 'textarea';
			key: string;
			label: string;
			placeholder?: string;
			default?: string;
			help?: string;
	  }
	| { kind: 'password'; key: string; label: string; placeholder?: string; help?: string }
	| {
			kind: 'number';
			key: string;
			label: string;
			min?: number;
			max?: number;
			step?: number;
			default?: number;
			help?: string;
	  }
	| {
			kind: 'select';
			key: string;
			label: string;
			options: { value: string; label: string }[];
			default?: string;
			help?: string;
	  }
	| { kind: 'checkbox'; key: string; label: string; default?: boolean; help?: string }
	| { kind: 'color'; key: string; label: string; default?: string; help?: string }
	/** A page selection like "1-3,7", validated live against the document. */
	| { kind: 'pages'; key: string; label: string; help?: string }
	/** A second file — a stamp, a logo, a signature image. */
	| { kind: 'file'; key: string; label: string; accept: string[]; help?: string };

export type FieldValues = Record<string, string | number | boolean>;

export interface ToolResult {
	files: OutputFile[];
	/** One line shown above the downloads, e.g. "42% smaller". */
	summary?: string;
	/** Key/value rows shown as a small table — for inspectors and reports. */
	details?: Record<string, string>;
	/** Long text shown in a scrollable box, e.g. extracted text. */
	preview?: string;
}

export interface ToolRunContext {
	/**
	 * Documents already parsed by the engine. Empty for `raw` tools, whose
	 * input the engine cannot read until it has been converted.
	 */
	docs: DocInfo[];
	/** The files the user dropped, untouched. */
	sources: File[];
	values: FieldValues;
	/** Files picked through `file` fields, keyed by field key. */
	files: Record<string, File>;
	/** The first document's name without its extension, for output naming. */
	stem: string;
	/** Resolve a `pages` field to 0-based indices; undefined means all pages. */
	pages: (key: string) => number[] | undefined;
}

/** Props a custom tool component receives. */
export interface ToolProps {
	docs: DocInfo[];
	busy: boolean;
	run: (task: () => Promise<ToolResult | OutputFile[]>) => void;
}

export interface Tool {
	/** URL slug, e.g. /merge-pdf */
	id: string;
	title: string;
	/** One line, used on the directory card and as the page meta description. */
	blurb: string;
	group: ToolGroup;
	/** How many documents the tool takes. */
	input: 'single' | 'multiple';
	/** Extensions offered in the file picker. */
	accept: string[];
	/** Extra search terms for the directory filter, including Portuguese. */
	keywords?: string[];
	/** An honest caveat shown in the UI — what this tool cannot do. */
	note?: string;
	/**
	 * Skip opening the input in the engine. Office formats have to be
	 * converted to HTML on the main thread first — handing them straight to
	 * MuPDF would just fail.
	 */
	raw?: boolean;
	fields?: Field[];
	execute?: (ctx: ToolRunContext) => Promise<ToolResult | OutputFile[]>;
	component?: () => Promise<{ default: Component<ToolProps> }>;
}

/** Every format MuPDF can read, so every tool that starts from "a document". */
export const READABLE = [
	'.pdf',
	'.md',
	'.markdown',
	'.txt',
	'.html',
	'.htm',
	'.xhtml',
	'.epub',
	'.mobi',
	'.fb2',
	'.cbz',
	'.xps',
	'.svg',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.bmp',
	'.webp',
	'.tif',
	'.tiff'
];

export const PDF_ONLY = ['.pdf'];
export const IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff'];

/** Default values declared by a tool's fields. */
export function defaultValues(fields: Field[] = []): FieldValues {
	const out: FieldValues = {};
	for (const field of fields) {
		if (field.kind === 'checkbox') out[field.key] = field.default ?? false;
		else if (field.kind === 'number') out[field.key] = field.default ?? 0;
		else if (field.kind === 'file') continue;
		else out[field.key] = ('default' in field ? field.default : undefined) ?? '';
	}
	return out;
}
