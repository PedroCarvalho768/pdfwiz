/**
 * The tool catalog.
 *
 * Adding a tool means adding one entry here. There is no per-tool route,
 * layout, form rendering or download plumbing — `routes/[tool]/+page.svelte`
 * and `FormTool.svelte` handle all of them.
 */
import { magicFor, run } from '$lib/engine/client';
import { formatBytes } from '$lib/download';
import { release } from './release';
import type { OutputFile } from '$lib/engine/contract';
import {
	GROUP_ORDER,
	IMAGES,
	PDF_ONLY,
	METADATA_LABELS,
	READABLE,
	type Tool,
	type ToolGroup,
	type ToolRunContext
} from './types';

// ---------------------------------------------------------------------------
// Shared field fragments
// ---------------------------------------------------------------------------

const pagesField = (help = 'Deixe em branco para todas as páginas.') =>
	({ kind: 'pages', key: 'pages', label: 'Páginas', help }) as const;

const FONT_OPTIONS = [
	'Helvetica',
	'Helvetica-Bold',
	'Helvetica-Oblique',
	'Times-Roman',
	'Times-Bold',
	'Times-Italic',
	'Courier',
	'Courier-Bold'
].map((value) => ({ value, label: value }));

const ANCHOR_OPTIONS = [
	['top-left', 'Superior esquerda'],
	['top-center', 'Superior centro'],
	['top-right', 'Superior direita'],
	['middle-left', 'Meio esquerda'],
	['center', 'Centro'],
	['middle-right', 'Meio direita'],
	['bottom-left', 'Inferior esquerda'],
	['bottom-center', 'Inferior centro'],
	['bottom-right', 'Inferior direita']
].map(([value, label]) => ({ value, label }));

const SIZE_OPTIONS = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'].map((value) => ({
	value,
	label: value
}));

const str = (ctx: ToolRunContext, key: string) => String(ctx.values[key] ?? '');
const num = (ctx: ToolRunContext, key: string) => Number(ctx.values[key] ?? 0);
const bool = (ctx: ToolRunContext, key: string) => Boolean(ctx.values[key]);

/**
 * Open a secondary file (a stamp, a logo) in the engine for the duration of
 * `use`, closing it afterwards whether or not `use` succeeds.
 */
async function withExtra<T>(file: File, use: (handle: string) => Promise<T>): Promise<T> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const info = await run('open', { bytes, magic: magicFor(file) }, { transfer: [bytes.buffer] });
	try {
		return await use(info.handle);
	} finally {
		release(info.handle);
	}
}

/** Turn HTML produced on the main thread into a PDF via the engine. */
async function htmlToPdf(html: string, filename: string): Promise<OutputFile[]> {
	const info = await run('open', {
		bytes: new TextEncoder().encode(html),
		magic: 'text/html'
	});
	try {
		return [await run('save', { handle: info.handle, filename })];
	} finally {
		release(info.handle);
	}
}

/** Text going into generated HTML. Sheet names are user data. */
const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const percent = (before: number, after: number) =>
	`De ${formatBytes(before)} para ${formatBytes(after)} (${
		after < before ? `${Math.round((1 - after / before) * 100)}% menor` : 'sem redução'
	})`;

/** pt-BR names for MuPDF's permission keys, as the inspector lists them. */
const PERMISSION_LABELS: Record<string, string> = {
	print: 'imprimir',
	copy: 'copiar texto',
	edit: 'editar',
	annotate: 'anotar',
	form: 'preencher formulários',
	accessibility: 'leitores de tela',
	assemble: 'montar páginas',
	'print-hq': 'imprimir em alta qualidade'
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const tools: Tool[] = [
	// ---------------------------------------------------------------- Organize
	{
		id: 'merge-pdf',
		title: 'Juntar PDF',
		blurb: 'Junte vários documentos em um só, na ordem que você quiser.',
		group: 'Organizar',
		input: 'multiple',
		accept: READABLE,
		keywords: ['juntar', 'combinar', 'unir'],
		component: () => import('./MergeTool.svelte')
	},
	{
		id: 'split-pdf',
		title: 'Dividir PDF',
		blurb: 'Separe um documento em vários arquivos por intervalo de páginas.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['dividir', 'separar'],
		component: () => import('./SplitTool.svelte')
	},
	{
		id: 'organize-pdf',
		title: 'Organizar páginas',
		blurb: 'Reordene, gire e apague páginas numa grade visual.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['organizar', 'reordenar', 'apagar paginas', 'apagar páginas'],
		component: () => import('./OrganizeTool.svelte')
	},
	{
		id: 'rotate-pdf',
		title: 'Girar PDF',
		blurb: 'Gire as páginas em 90, 180 ou 270 graus.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['girar', 'rodar', 'rotacionar'],
		fields: [
			{
				kind: 'select',
				key: 'degrees',
				label: 'Rotação',
				default: '90',
				options: [
					{ value: '90', label: '90° horário' },
					{ value: '180', label: '180°' },
					{ value: '270', label: '90° anti-horário' }
				]
			},
			pagesField()
		],
		execute: async (ctx) => [
			await run('rotate', {
				handle: ctx.docs[0].handle,
				degrees: num(ctx, 'degrees'),
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-girado.pdf`
			})
		]
	},
	{
		id: 'extract-pages',
		title: 'Extrair páginas',
		blurb: 'Fique só com as páginas que você escolher, num novo arquivo.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['extrair paginas', 'extrair páginas', 'selecionar'],
		fields: [
			{
				kind: 'pages',
				key: 'pages',
				label: 'Páginas a manter',
				help: 'Por exemplo, 1-3,7.',
				required: true
			}
		],
		execute: async (ctx) =>
			run('extract', {
				handle: ctx.docs[0].handle,
				selections: [{ pages: ctx.pages('pages')!, filename: `${ctx.stem}-extraído.pdf` }]
			})
	},
	{
		id: 'remove-pages',
		title: 'Excluir páginas',
		blurb: 'Remova as páginas que você indicar e mantenha o resto.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['remover paginas', 'remover páginas', 'excluir', 'apagar'],
		fields: [
			{
				kind: 'pages',
				key: 'pages',
				label: 'Páginas a excluir',
				help: 'Por exemplo, 2,5-6.',
				required: true
			}
		],
		execute: async (ctx) => {
			const remove = new Set(ctx.pages('pages') ?? []);
			const keep = ctx.docs[0].pages.map((p) => p.index).filter((i) => !remove.has(i));
			if (keep.length === 0) throw new Error('Isso apagaria todas as páginas');
			return run('extract', {
				handle: ctx.docs[0].handle,
				selections: [{ pages: keep, filename: `${ctx.stem}-aparado.pdf` }]
			});
		}
	},
	{
		id: 'reverse-pdf',
		title: 'Inverter a ordem',
		blurb: 'Vire o documento de trás para frente.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['inverter', 'ordem'],
		execute: async (ctx) => [
			await run('reverse', { handle: ctx.docs[0].handle, filename: `${ctx.stem}-invertido.pdf` })
		]
	},
	{
		id: 'duplicate-pdf',
		title: 'Repetir páginas',
		blurb: 'Repita o documento inteiro ou só algumas páginas.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['duplicar', 'copiar', 'repetir'],
		fields: [
			{ kind: 'number', key: 'times', label: 'Número de cópias', min: 1, max: 100, default: 2 },
			pagesField()
		],
		execute: async (ctx) => [
			await run('duplicate', {
				handle: ctx.docs[0].handle,
				times: num(ctx, 'times'),
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-repetido.pdf`
			})
		]
	},
	{
		id: 'crop-pdf',
		title: 'Recortar margens',
		blurb: 'Corte as margens por porcentagem em cada lado.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['cortar', 'aparar', 'margens'],
		fields: [
			{ kind: 'number', key: 'top', label: 'Superior %', min: 0, max: 49, default: 5 },
			{ kind: 'number', key: 'right', label: 'Direita %', min: 0, max: 49, default: 5 },
			{ kind: 'number', key: 'bottom', label: 'Inferior %', min: 0, max: 49, default: 5 },
			{ kind: 'number', key: 'left', label: 'Esquerda %', min: 0, max: 49, default: 5 },
			pagesField()
		],
		execute: async (ctx) => [
			await run('crop', {
				handle: ctx.docs[0].handle,
				top: num(ctx, 'top'),
				right: num(ctx, 'right'),
				bottom: num(ctx, 'bottom'),
				left: num(ctx, 'left'),
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-recortado.pdf`
			})
		]
	},
	{
		id: 'resize-pdf',
		title: 'Redimensionar páginas',
		blurb: 'Ajuste todas as páginas a um tamanho de papel padrão.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['redimensionar', 'tamanho', 'a4'],
		fields: [
			{
				kind: 'select',
				key: 'size',
				label: 'Tamanho do papel',
				options: SIZE_OPTIONS,
				default: 'A4'
			},
			{ kind: 'checkbox', key: 'landscape', label: 'Paisagem' }
		],
		execute: async (ctx) => [
			await run('resize', {
				handle: ctx.docs[0].handle,
				size: str(ctx, 'size'),
				landscape: bool(ctx, 'landscape'),
				filename: `${ctx.stem}-redimensionado.pdf`
			})
		]
	},
	{
		id: 'n-up-pdf',
		title: 'Várias páginas por folha',
		blurb: 'Coloque duas, quatro ou mais páginas lado a lado na mesma folha.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['n-up', 'varias paginas', 'várias páginas', 'economizar papel'],
		fields: [
			{ kind: 'number', key: 'columns', label: 'Colunas', min: 1, max: 6, default: 2 },
			{ kind: 'number', key: 'rows', label: 'Linhas', min: 1, max: 6, default: 1 },
			{
				kind: 'select',
				key: 'size',
				label: 'Tamanho da folha',
				options: SIZE_OPTIONS,
				default: 'A4'
			},
			{ kind: 'checkbox', key: 'landscape', label: 'Paisagem', default: true },
			{
				kind: 'number',
				key: 'gap',
				label: 'Espaço entre páginas (pontos)',
				min: 0,
				max: 60,
				default: 8
			}
		],
		execute: async (ctx) => [
			await run('nup', {
				handle: ctx.docs[0].handle,
				columns: num(ctx, 'columns'),
				rows: num(ctx, 'rows'),
				size: str(ctx, 'size'),
				landscape: bool(ctx, 'landscape'),
				gap: num(ctx, 'gap'),
				filename: `${ctx.stem}-n-por-folha.pdf`
			})
		]
	},
	{
		id: 'booklet-pdf',
		title: 'Montar livreto',
		blurb: 'Monte as páginas para imprimir, dobrar e grampear no meio.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['livreto', 'brochura', 'encadernar'],
		fields: [
			{
				kind: 'select',
				key: 'size',
				label: 'Tamanho da folha',
				options: SIZE_OPTIONS,
				default: 'A4'
			}
		],
		execute: async (ctx) => [
			await run('booklet', {
				handle: ctx.docs[0].handle,
				size: str(ctx, 'size'),
				filename: `${ctx.stem}-livreto.pdf`
			})
		]
	},
	{
		id: 'interleave-pdf',
		title: 'Intercalar dois arquivos',
		blurb: 'Alterne as páginas de dois arquivos, para digitalização frente e verso.',
		group: 'Organizar',
		input: 'multiple',
		accept: READABLE,
		keywords: ['intercalar', 'frente e verso', 'digitalizacao'],
		fields: [
			{
				kind: 'checkbox',
				key: 'reverseSecond',
				label: 'Inverter o segundo arquivo',
				help: 'Marque quando os versos foram digitalizados na ordem inversa.'
			}
		],
		execute: async (ctx) => {
			if (ctx.docs.length !== 2) throw new Error('Intercalar exige exatamente dois arquivos');
			return [
				await run('interleave', {
					handles: [ctx.docs[0].handle, ctx.docs[1].handle],
					reverseSecond: bool(ctx, 'reverseSecond'),
					filename: `${ctx.stem}-intercalado.pdf`
				})
			];
		}
	},
	{
		id: 'overlay-pdf',
		title: 'Sobrepor PDFs',
		blurb: 'Desenhe um documento sobre o outro: papel timbrado, bordas, carimbos.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['sobrepor', 'carimbo', 'papel timbrado'],
		fields: [
			{ kind: 'file', key: 'stamp', label: 'Documento que vai por cima', accept: READABLE },
			{ kind: 'checkbox', key: 'behind', label: 'Colocar atrás da página' }
		],
		execute: async (ctx) => {
			const stamp = ctx.files.stamp;
			if (!stamp) throw new Error('Escolha o documento que vai por cima');
			return withExtra(stamp, async (stampHandle) => [
				await run('overlay', {
					handle: ctx.docs[0].handle,
					stampHandle,
					behind: bool(ctx, 'behind'),
					filename: `${ctx.stem}-sobreposto.pdf`
				})
			]);
		}
	},
	{
		id: 'insert-blank-pages',
		title: 'Inserir páginas em branco',
		blurb: 'Insira páginas vazias nas posições que você escolher.',
		group: 'Organizar',
		input: 'single',
		accept: READABLE,
		keywords: ['pagina em branco', 'página em branco', 'inserir'],
		fields: [
			{
				kind: 'pages',
				key: 'at',
				label: 'Inserir antes destas páginas',
				help: 'Por exemplo, 1,4 insere uma página em branco antes das páginas 1 e 4. Use o número seguinte ao da última página para inserir no final.',
				required: true,
				allowEnd: true
			}
		],
		execute: async (ctx) => [
			await run('insertBlank', {
				handle: ctx.docs[0].handle,
				at: ctx.pages('at') ?? [],
				filename: `${ctx.stem}-com-brancos.pdf`
			})
		]
	},

	// -------------------------------------------------------------------- Edit
	{
		id: 'edit-pdf-text',
		title: 'Editar texto',
		blurb: 'Mude as palavras que já estão na página.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['editar texto', 'alterar', 'corrigir'],
		note: 'As linhas editadas são redesenhadas numa fonte padrão e não refluem, então um texto bem maior pode invadir a linha seguinte. Nenhum motor gratuito faz refluxo de texto em PDF.',
		component: () => import('./EditTextTool.svelte')
	},
	{
		id: 'watermark-pdf',
		title: "Marca d'água",
		blurb: 'Escreva um texto na diagonal em todas as páginas.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['marca dagua', 'confidencial'],
		fields: [
			{ kind: 'text', key: 'text', label: "Texto da marca d'água", default: 'CONFIDENCIAL' },
			{ kind: 'number', key: 'size', label: 'Tamanho da fonte', min: 8, max: 200, default: 48 },
			{ kind: 'color', key: 'color', label: 'Cor', default: '#ff0000' },
			{ kind: 'number', key: 'opacity', label: 'Opacidade %', min: 5, max: 100, default: 25 },
			{ kind: 'number', key: 'rotate', label: 'Ângulo', min: -90, max: 90, default: 45 },
			{
				kind: 'select',
				key: 'font',
				label: 'Fonte',
				options: FONT_OPTIONS,
				default: 'Helvetica-Bold'
			},
			pagesField()
		],
		execute: async (ctx) => [
			await run('watermark', {
				handle: ctx.docs[0].handle,
				text: str(ctx, 'text'),
				size: num(ctx, 'size'),
				color: str(ctx, 'color'),
				opacity: num(ctx, 'opacity') / 100,
				rotate: num(ctx, 'rotate'),
				font: str(ctx, 'font') as never,
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-marca-dagua.pdf`
			})
		]
	},
	{
		id: 'add-page-numbers',
		title: 'Numerar páginas',
		blurb: 'Numere as páginas em qualquer canto da folha.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['numerar paginas', 'numerar páginas', 'numeracao'],
		fields: [
			{
				kind: 'text',
				key: 'template',
				label: 'Formato',
				default: '{n}',
				help: '{n} é o número da página e {total} o total. Por exemplo, Página {n} de {total}.'
			},
			{
				kind: 'select',
				key: 'anchor',
				label: 'Posição',
				options: ANCHOR_OPTIONS,
				default: 'bottom-center'
			},
			{ kind: 'number', key: 'startAt', label: 'Começar em', min: 0, max: 9999, default: 1 },
			{ kind: 'number', key: 'size', label: 'Tamanho da fonte', min: 6, max: 48, default: 11 },
			{ kind: 'color', key: 'color', label: 'Cor', default: '#000000' },
			{ kind: 'select', key: 'font', label: 'Fonte', options: FONT_OPTIONS, default: 'Helvetica' },
			{ kind: 'number', key: 'margin', label: 'Margem (pontos)', min: 0, max: 150, default: 28 },
			pagesField()
		],
		execute: async (ctx) => [
			await run('pageNumbers', {
				handle: ctx.docs[0].handle,
				template: str(ctx, 'template'),
				anchor: str(ctx, 'anchor') as never,
				startAt: num(ctx, 'startAt'),
				size: num(ctx, 'size'),
				color: str(ctx, 'color'),
				font: str(ctx, 'font') as never,
				margin: num(ctx, 'margin'),
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-numerado.pdf`
			})
		]
	},
	{
		id: 'header-footer-pdf',
		title: 'Cabeçalho ou rodapé',
		blurb: 'Coloque um texto fixo na margem de todas as páginas.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['cabecalho', 'rodape'],
		fields: [
			{ kind: 'text', key: 'text', label: 'Texto' },
			{
				kind: 'select',
				key: 'anchor',
				label: 'Posição',
				options: ANCHOR_OPTIONS,
				default: 'top-center'
			},
			{ kind: 'number', key: 'size', label: 'Tamanho da fonte', min: 6, max: 48, default: 10 },
			{ kind: 'color', key: 'color', label: 'Cor', default: '#444444' },
			{ kind: 'select', key: 'font', label: 'Fonte', options: FONT_OPTIONS, default: 'Helvetica' },
			{ kind: 'number', key: 'margin', label: 'Margem (pontos)', min: 0, max: 150, default: 24 },
			pagesField()
		],
		execute: async (ctx) => [
			await run('headerFooter', {
				handle: ctx.docs[0].handle,
				text: str(ctx, 'text'),
				anchor: str(ctx, 'anchor') as never,
				size: num(ctx, 'size'),
				color: str(ctx, 'color'),
				font: str(ctx, 'font') as never,
				margin: num(ctx, 'margin'),
				pages: ctx.pages('pages'),
				filename: `${ctx.stem}-cabeçalho.pdf`
			})
		]
	},
	{
		id: 'stamp-image-pdf',
		title: 'Carimbo ou assinatura',
		blurb: 'Posicione uma logo, um carimbo ou uma assinatura na página.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['assinar', 'assinatura', 'logo', 'carimbo'],
		note: 'Isto coloca uma imagem na página. Não é uma assinatura digital com certificado.',
		fields: [
			{ kind: 'file', key: 'image', label: 'Imagem', accept: IMAGES },
			{ kind: 'number', key: 'page', label: 'Número da página', min: 1, max: 99999, default: 1 },
			{
				kind: 'number',
				key: 'x',
				label: 'X a partir da esquerda (pontos)',
				min: 0,
				max: 5000,
				default: 60
			},
			{
				kind: 'number',
				key: 'y',
				label: 'Y a partir do topo (pontos)',
				min: 0,
				max: 5000,
				default: 60
			},
			{ kind: 'number', key: 'width', label: 'Largura (pontos)', min: 5, max: 2000, default: 160 },
			{ kind: 'number', key: 'height', label: 'Altura (pontos)', min: 5, max: 2000, default: 60 },
			{ kind: 'number', key: 'opacity', label: 'Opacidade %', min: 5, max: 100, default: 100 }
		],
		execute: async (ctx) => {
			const image = ctx.files.image;
			if (!image) throw new Error('Escolha uma imagem para carimbar');
			return [
				await run('addImage', {
					handle: ctx.docs[0].handle,
					bytes: new Uint8Array(await image.arrayBuffer()),
					placements: [
						{
							page: num(ctx, 'page') - 1,
							x: num(ctx, 'x'),
							y: num(ctx, 'y'),
							width: num(ctx, 'width'),
							height: num(ctx, 'height'),
							opacity: num(ctx, 'opacity') / 100
						}
					],
					filename: `${ctx.stem}-carimbado.pdf`
				})
			];
		}
	},
	{
		id: 'fill-pdf-form',
		title: 'Preencher formulário',
		blurb: 'Preencha os campos do formulário e, se quiser, trave os valores.',
		group: 'Editar',
		input: 'single',
		accept: PDF_ONLY,
		keywords: ['formulario', 'preencher'],
		component: () => import('./FormFillTool.svelte')
	},
	{
		id: 'flatten-pdf',
		title: 'Achatar PDF',
		blurb: 'Transforme anotações e campos de formulário em conteúdo fixo.',
		group: 'Editar',
		input: 'single',
		accept: READABLE,
		keywords: ['achatar', 'planificar', 'bloquear campos'],
		fields: [
			{ kind: 'checkbox', key: 'annotations', label: 'Achatar anotações', default: true },
			{ kind: 'checkbox', key: 'forms', label: 'Achatar campos de formulário', default: true }
		],
		execute: async (ctx) => [
			await run('flatten', {
				handle: ctx.docs[0].handle,
				annotations: bool(ctx, 'annotations'),
				forms: bool(ctx, 'forms'),
				filename: `${ctx.stem}-achatado.pdf`
			})
		]
	},

	// ----------------------------------------------------------- Convert to PDF
	{
		id: 'images-to-pdf',
		title: 'Imagens para PDF',
		blurb: 'Transforme fotos JPG, PNG ou TIFF em um único documento.',
		group: 'Converter para PDF',
		input: 'multiple',
		accept: IMAGES,
		keywords: ['imagem para pdf', 'jpg para pdf', 'foto'],
		execute: async (ctx) => {
			if (ctx.docs.length === 1)
				return [await run('save', { handle: ctx.docs[0].handle, filename: `${ctx.stem}.pdf` })];
			return [
				await run('merge', {
					handles: ctx.docs.map((d) => d.handle),
					filename: `${ctx.stem}.pdf`
				})
			];
		}
	},
	{
		id: 'markdown-to-pdf',
		title: 'Markdown para PDF',
		blurb: 'Transforme um arquivo .md em documento diagramado.',
		group: 'Converter para PDF',
		input: 'single',
		accept: ['.md', '.markdown', '.txt'],
		keywords: ['markdown', 'md para pdf'],
		execute: async (ctx) => [
			await run('save', { handle: ctx.docs[0].handle, filename: `${ctx.stem}.pdf` })
		]
	},
	{
		id: 'html-to-pdf',
		title: 'HTML para PDF',
		blurb: 'Converta uma página web salva em documento.',
		group: 'Converter para PDF',
		input: 'single',
		accept: ['.html', '.htm', '.xhtml'],
		keywords: ['html', 'pagina web', 'página web'],
		note: 'Renderiza o arquivo HTML sozinho. Folhas de estilo, scripts e imagens externas não são baixados.',
		execute: async (ctx) => [
			await run('save', { handle: ctx.docs[0].handle, filename: `${ctx.stem}.pdf` })
		]
	},
	{
		id: 'ebook-to-pdf',
		title: 'E-book para PDF',
		blurb: 'Converta arquivos EPUB, MOBI, FB2, CBZ ou XPS.',
		group: 'Converter para PDF',
		input: 'single',
		accept: ['.epub', '.mobi', '.fb2', '.cbz', '.xps'],
		keywords: ['epub', 'ebook', 'livro', 'quadrinhos'],
		execute: async (ctx) => [
			await run('save', { handle: ctx.docs[0].handle, filename: `${ctx.stem}.pdf` })
		]
	},
	{
		id: 'word-to-pdf',
		title: 'Word para PDF',
		blurb: 'Converta um documento .docx.',
		group: 'Converter para PDF',
		input: 'single',
		accept: ['.docx'],
		keywords: ['word', 'docx', 'documento'],
		raw: true,
		note: 'Passa por HTML, então títulos, listas, tabelas e ênfase sobrevivem, mas o layout exato, as colunas e as imagens flutuantes vão se deslocar.',
		execute: async (ctx) => {
			const file = ctx.sources[0];
			const mammoth = await import('mammoth');
			const { value } = await mammoth.convertToHtml({
				arrayBuffer: await file.arrayBuffer()
			});
			return htmlToPdf(`<!doctype html><meta charset="utf-8">${value}`, `${ctx.stem}.pdf`);
		}
	},
	{
		id: 'excel-to-pdf',
		title: 'Excel para PDF',
		blurb: 'Converta uma planilha, com uma tabela por aba.',
		group: 'Converter para PDF',
		input: 'single',
		accept: ['.xlsx', '.xls', '.csv'],
		keywords: ['excel', 'planilha', 'xlsx', 'csv'],
		raw: true,
		note: 'Exporta o valor das células como tabelas. Gráficos, imagens e formatação condicional não vão junto.',
		execute: async (ctx) => {
			const file = ctx.sources[0];
			const XLSX = await import('xlsx');
			const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
			const sections = book.SheetNames.map(
				(name) =>
					`<h2>${escapeHtml(name)}</h2>${XLSX.utils.sheet_to_html(book.Sheets[name], { header: '', footer: '' })}`
			).join('\n');
			return htmlToPdf(
				`<!doctype html><meta charset="utf-8"><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:3px;font-size:10px}</style>${sections}`,
				`${ctx.stem}.pdf`
			);
		}
	},

	// --------------------------------------------------------- Convert from PDF
	{
		id: 'pdf-to-jpg',
		rasterizes: true,
		title: 'PDF para JPG',
		blurb: 'Salve cada página como uma imagem JPEG.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['pdf para jpg', 'imagem'],
		fields: [
			{ kind: 'number', key: 'dpi', label: 'Resolução (dpi)', min: 36, max: 600, default: 150 },
			{ kind: 'number', key: 'quality', label: 'Qualidade %', min: 30, max: 100, default: 85 },
			{ kind: 'checkbox', key: 'grayscale', label: 'Tons de cinza' },
			pagesField()
		],
		execute: async (ctx) =>
			run('toImages', {
				handle: ctx.docs[0].handle,
				format: 'jpeg',
				dpi: num(ctx, 'dpi'),
				quality: num(ctx, 'quality'),
				grayscale: bool(ctx, 'grayscale'),
				pages: ctx.pages('pages'),
				stem: ctx.stem
			})
	},
	{
		id: 'pdf-to-png',
		rasterizes: true,
		title: 'PDF para PNG',
		blurb: 'Salve cada página como uma imagem PNG sem perda.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['pdf para png', 'imagem'],
		fields: [
			{ kind: 'number', key: 'dpi', label: 'Resolução (dpi)', min: 36, max: 600, default: 150 },
			{ kind: 'checkbox', key: 'grayscale', label: 'Tons de cinza' },
			pagesField()
		],
		execute: async (ctx) =>
			run('toImages', {
				handle: ctx.docs[0].handle,
				format: 'png',
				dpi: num(ctx, 'dpi'),
				grayscale: bool(ctx, 'grayscale'),
				pages: ctx.pages('pages'),
				stem: ctx.stem
			})
	},
	{
		id: 'pdf-to-text',
		title: 'PDF para texto',
		blurb: 'Extraia o texto num arquivo .txt simples.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['pdf para texto', 'txt', 'extrair texto'],
		fields: [pagesField()],
		execute: async (ctx) => {
			const file = await run('toText', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages'),
				stem: ctx.stem
			});
			return { files: [file], preview: new TextDecoder().decode(file.bytes) };
		}
	},
	{
		id: 'pdf-to-markdown',
		title: 'PDF para Markdown',
		blurb: 'Converta o texto e os títulos para um arquivo .md.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['markdown', 'md'],
		note: 'A estrutura é deduzida da camada de texto do PDF, então títulos e listas são um palpite, não um sumário fiel.',
		fields: [pagesField()],
		execute: async (ctx) => {
			const html = await run('toHtml', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages'),
				stem: ctx.stem
			});
			const Turndown = (await import('turndown')).default;
			const markdown = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(
				new TextDecoder().decode(html.bytes)
			);
			return {
				files: [
					{
						filename: `${ctx.stem}.md`,
						mime: 'text/markdown',
						bytes: new TextEncoder().encode(markdown)
					}
				],
				preview: markdown
			};
		}
	},
	{
		id: 'pdf-to-word',
		title: 'PDF para Word',
		blurb: 'Gere um .docx editável a partir do texto do documento.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['pdf para word', 'docx', 'editavel'],
		note: 'Reconstrói o texto em parágrafos com o tamanho de fonte original. Layout exato, colunas, tabelas e imagens não são recriados.',
		fields: [pagesField()],
		execute: async (ctx) => {
			const pages = await run('toStructured', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages')
			});
			const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel } =
				await import('docx');

			const children: InstanceType<typeof Paragraph>[] = [];
			pages.forEach((page, pageIndex) => {
				const data = page.data as {
					blocks?: { type: string; lines?: { text: string; font?: { size?: number } }[] }[];
				};
				for (const block of data.blocks ?? []) {
					if (block.type !== 'text') continue;
					for (const line of block.lines ?? []) {
						if (!line.text?.trim()) continue;
						const size = line.font?.size ?? 11;
						children.push(
							new Paragraph({
								// Larger type almost always means a heading.
								heading: size >= 18 ? HeadingLevel.HEADING_1 : undefined,
								children: [new TextRun({ text: line.text, size: Math.round(size * 2) })]
							})
						);
					}
				}
				if (pageIndex < pages.length - 1)
					children.push(new Paragraph({ children: [new PageBreak()] }));
			});

			const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
			return [
				{
					filename: `${ctx.stem}.docx`,
					mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					bytes: new Uint8Array(await blob.arrayBuffer())
				}
			];
		}
	},
	{
		id: 'pdf-to-html',
		title: 'PDF para HTML',
		blurb: 'Exporte uma página web que preserva a posição do texto.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['html', 'web'],
		fields: [pagesField()],
		execute: async (ctx) => [
			await run('toHtml', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages'),
				stem: ctx.stem,
				title: ctx.stem
			})
		]
	},
	{
		id: 'pdf-to-svg',
		title: 'PDF para SVG',
		blurb: 'Exporte cada página como vetor escalável.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['svg', 'vetor'],
		fields: [pagesField()],
		execute: async (ctx) =>
			run('toSvg', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages'),
				stem: ctx.stem
			})
	},
	{
		id: 'pdf-to-json',
		title: 'PDF para JSON',
		blurb: 'Exporte o texto estruturado com fontes e coordenadas.',
		group: 'Converter de PDF',
		input: 'single',
		accept: READABLE,
		keywords: ['json', 'dados', 'estruturado'],
		fields: [pagesField()],
		execute: async (ctx) => {
			const pages = await run('toStructured', {
				handle: ctx.docs[0].handle,
				pages: ctx.pages('pages')
			});
			const json = JSON.stringify(pages, null, 2);
			return {
				files: [
					{
						filename: `${ctx.stem}.json`,
						mime: 'application/json',
						bytes: new TextEncoder().encode(json)
					}
				],
				preview: json.slice(0, 20000)
			};
		}
	},

	// ---------------------------------------------------------------- Security
	{
		id: 'protect-pdf',
		title: 'Proteger com senha',
		blurb: 'Criptografe o arquivo e escolha o que os leitores podem fazer.',
		group: 'Segurança',
		input: 'single',
		accept: READABLE,
		keywords: ['criptografar', 'senha', 'proteger', 'encriptar'],
		fields: [
			{
				kind: 'password',
				key: 'userPassword',
				label: 'Senha para abrir',
				help: 'Deixe em branco para qualquer pessoa abrir, mas ainda assim limitar o que ela pode fazer.'
			},
			{
				kind: 'password',
				key: 'ownerPassword',
				label: 'Senha de proprietário',
				help: 'Quem tem esta senha pode tirar as restrições abaixo. Se ficar em branco, uma senha aleatória é gerada e ninguém consegue tirá-las depois.'
			},
			{
				kind: 'select',
				key: 'encryption',
				label: 'Criptografia',
				default: 'aes-256',
				options: [
					{ value: 'aes-256', label: 'AES-256 (mais forte)' },
					{ value: 'aes-128', label: 'AES-128' },
					{ value: 'rc4-128', label: 'RC4-128 (leitores antigos)' }
				]
			},
			{ kind: 'checkbox', key: 'print', label: 'Permitir imprimir', default: true },
			{ kind: 'checkbox', key: 'copy', label: 'Permitir copiar texto', default: false },
			{ kind: 'checkbox', key: 'modify', label: 'Permitir editar', default: false },
			{ kind: 'checkbox', key: 'annotate', label: 'Permitir anotar', default: false },
			{
				kind: 'checkbox',
				key: 'fillForms',
				label: 'Permitir preencher formulários',
				default: true
			},
			{ kind: 'checkbox', key: 'accessibility', label: 'Permitir leitores de tela', default: true }
		],
		execute: async (ctx) => [
			await run('protect', {
				handle: ctx.docs[0].handle,
				userPassword: str(ctx, 'userPassword'),
				ownerPassword: str(ctx, 'ownerPassword'),
				encryption: str(ctx, 'encryption') as never,
				permissions: {
					print: bool(ctx, 'print'),
					copy: bool(ctx, 'copy'),
					modify: bool(ctx, 'modify'),
					annotate: bool(ctx, 'annotate'),
					fillForms: bool(ctx, 'fillForms'),
					accessibility: bool(ctx, 'accessibility'),
					assemble: bool(ctx, 'modify'),
					printHighQuality: bool(ctx, 'print')
				},
				filename: `${ctx.stem}-protegido.pdf`
			})
		]
	},
	{
		id: 'unlock-pdf',
		title: 'Tirar a senha',
		blurb: 'Salve uma cópia sem criptografia de um arquivo que você já consegue abrir.',
		group: 'Segurança',
		input: 'single',
		accept: PDF_ONLY,
		keywords: ['tirar senha', 'remover senha', 'desbloquear', 'descriptografar'],
		note: 'Você precisa saber a senha: ela é pedida ao abrir o arquivo. Esta ferramenta não quebra criptografia.',
		execute: async (ctx) => [
			await run('unlock', { handle: ctx.docs[0].handle, filename: `${ctx.stem}-sem-senha.pdf` })
		]
	},
	{
		id: 'redact-pdf',
		title: 'Tarjar texto',
		blurb: 'Encontre um nome, CPF ou conta, confira cada ocorrência e apague de vez.',
		group: 'Segurança',
		input: 'single',
		accept: READABLE,
		keywords: ['censurar', 'tarjar', 'ocultar', 'redigir', 'cpf', 'anonimizar'],
		note: 'O texto é apagado de verdade, não apenas coberto: não pode ser recuperado nem copiado do resultado. Por isso nada é tarjado sem você conferir a lista antes.',
		component: () => import('./RedactTool.svelte')
	},
	{
		id: 'sanitize-pdf',
		title: 'Limpar o arquivo',
		blurb: 'Remova scripts, anexos e metadados escondidos.',
		group: 'Segurança',
		input: 'single',
		accept: READABLE,
		keywords: ['limpar', 'higienizar', 'metadados', 'javascript'],
		fields: [
			{
				kind: 'checkbox',
				key: 'javascript',
				label: 'Remover JavaScript e ações de abertura',
				default: true
			},
			{ kind: 'checkbox', key: 'attachments', label: 'Remover arquivos embutidos', default: true },
			{
				kind: 'checkbox',
				key: 'metadata',
				label: 'Remover autor e outros metadados',
				default: true
			},
			{ kind: 'checkbox', key: 'links', label: 'Remover links externos', default: false }
		],
		execute: async (ctx) => [
			await run('sanitize', {
				handle: ctx.docs[0].handle,
				javascript: bool(ctx, 'javascript'),
				attachments: bool(ctx, 'attachments'),
				metadata: bool(ctx, 'metadata'),
				links: bool(ctx, 'links'),
				filename: `${ctx.stem}-limpo.pdf`
			})
		]
	},
	{
		id: 'repair-pdf',
		title: 'Reparar PDF',
		blurb: 'Reconstrua um arquivo danificado para que ele abra de novo.',
		group: 'Segurança',
		input: 'single',
		accept: PDF_ONLY,
		keywords: ['reparar', 'consertar', 'arquivo danificado'],
		execute: async (ctx) => {
			const result = await run('repair', {
				handle: ctx.docs[0].handle,
				filename: `${ctx.stem}-reparado.pdf`
			});
			return {
				files: [result.file],
				summary: result.wasRepaired
					? 'Este arquivo estava danificado e foi reconstruído.'
					: 'Nenhum dano encontrado. Mesmo assim o arquivo foi reescrito de forma limpa.'
			};
		}
	},
	{
		id: 'corrupt-pdf',
		title: 'Corromper PDF',
		blurb: 'Danifique um arquivo de propósito para que ele não abra.',
		group: 'Segurança',
		input: 'single',
		accept: READABLE,
		keywords: ['corromper', 'danificar', 'quebrar arquivo'],
		note: 'O estrago não tem volta aqui, então guarde o original. Qualquer pessoa consegue ver que o arquivo está quebrado, mas não por quê.',
		fields: [{ kind: 'number', key: 'strength', label: 'Dano %', min: 1, max: 100, default: 20 }],
		execute: async (ctx) => [
			await run('corrupt', {
				handle: ctx.docs[0].handle,
				strength: num(ctx, 'strength'),
				filename: `${ctx.stem}-corrompido.pdf`
			})
		]
	},

	// ---------------------------------------------------------------- Optimize
	{
		id: 'compress-pdf',
		title: 'Comprimir PDF',
		blurb: 'Reduza o tamanho do arquivo recodificando as imagens.',
		group: 'Otimizar',
		input: 'single',
		accept: READABLE,
		keywords: ['comprimir', 'reduzir tamanho', 'diminuir'],
		fields: [
			{
				kind: 'select',
				key: 'level',
				label: 'Nível',
				default: 'balanced',
				options: [
					{ value: 'lossless', label: 'Sem perdas, só limpa e comprime' },
					{ value: 'balanced', label: 'Equilibrada, reamostra as imagens' },
					{ value: 'aggressive', label: 'Agressiva, menor arquivo' }
				]
			}
		],
		execute: async (ctx) => {
			const result = await run('compress', {
				handle: ctx.docs[0].handle,
				level: str(ctx, 'level') as never,
				filename: `${ctx.stem}-comprimido.pdf`
			});
			return {
				files: [result.file],
				summary: `${percent(result.before, result.after)}${
					result.imagesRecompressed ? `, ${result.imagesRecompressed} imagens recodificadas` : ''
				}${
					result.imagesSkipped
						? `, ${plural(result.imagesSkipped, 'imagem ficou', 'imagens ficaram')} sem alteração (formato não suportado)`
						: ''
				}`
			};
		}
	},
	{
		id: 'grayscale-pdf',
		rasterizes: true,
		title: 'Converter para cinza',
		blurb: 'Tire todas as cores, para imprimir mais barato.',
		group: 'Otimizar',
		input: 'single',
		accept: READABLE,
		keywords: ['preto e branco', 'escala de cinza', 'tons de cinza'],
		note: 'As páginas são redesenhadas como imagem, então a camada de texto se perde e o resultado deixa de ser pesquisável.',
		fields: [
			{ kind: 'number', key: 'dpi', label: 'Resolução (dpi)', min: 36, max: 600, default: 150 }
		],
		execute: async (ctx) => [
			await run('grayscale', {
				handle: ctx.docs[0].handle,
				dpi: num(ctx, 'dpi'),
				filename: `${ctx.stem}-cinza.pdf`
			})
		]
	},
	{
		id: 'rasterize-pdf',
		rasterizes: true,
		title: 'Achatar em imagens',
		blurb: 'Redesenhe cada página como imagem para que o texto não possa ser copiado.',
		group: 'Otimizar',
		input: 'single',
		accept: READABLE,
		keywords: ['rasterizar', 'imagem', 'nao copiavel', 'não copiável'],
		note: 'Isto destrói a camada de texto de propósito. O resultado não pode ser pesquisado, selecionado nem lido por um leitor de tela.',
		fields: [
			{ kind: 'number', key: 'dpi', label: 'Resolução (dpi)', min: 36, max: 600, default: 150 }
		],
		execute: async (ctx) => [
			await run('rasterize', {
				handle: ctx.docs[0].handle,
				dpi: num(ctx, 'dpi'),
				filename: `${ctx.stem}-em-imagens.pdf`
			})
		]
	},
	{
		id: 'clean-pdf',
		title: 'Enxugar o arquivo',
		blurb: 'Descarte objetos sem uso e enxugue as fontes, sem perder qualidade.',
		group: 'Otimizar',
		input: 'single',
		accept: READABLE,
		keywords: ['limpar', 'otimizar', 'fontes'],
		execute: async (ctx) => {
			const result = await run('clean', {
				handle: ctx.docs[0].handle,
				filename: `${ctx.stem}-enxuto.pdf`
			});
			return { files: [result.file], summary: percent(result.before, result.after) };
		}
	},

	// ----------------------------------------------------------------- Extract
	{
		id: 'ocr-pdf',
		rasterizes: true,
		title: 'OCR em PDF digitalizado',
		blurb: 'Reconheça o texto de um documento digitalizado e torne o arquivo pesquisável.',
		group: 'Extrair',
		input: 'single',
		accept: READABLE,
		keywords: ['ocr', 'reconhecer texto', 'digitalizado', 'escaneado'],
		component: () => import('./OcrTool.svelte')
	},
	{
		id: 'extract-images',
		title: 'Extrair imagens',
		blurb: 'Retire todas as imagens embutidas no documento.',
		group: 'Extrair',
		input: 'single',
		accept: READABLE,
		keywords: ['extrair imagens', 'fotos'],
		fields: [
			{
				kind: 'number',
				key: 'minSize',
				label: 'Ignorar imagens menores que (px)',
				min: 1,
				max: 2000,
				default: 32
			}
		],
		execute: async (ctx) => {
			const files = await run('extractImages', {
				handle: ctx.docs[0].handle,
				minSize: num(ctx, 'minSize'),
				stem: ctx.stem
			});
			if (files.length === 0)
				throw new Error('Nenhuma imagem embutida foi encontrada neste documento');
			return files;
		}
	},
	{
		id: 'extract-attachments',
		title: 'Extrair anexos',
		blurb: 'Baixe os arquivos embutidos dentro do PDF.',
		group: 'Extrair',
		input: 'single',
		accept: PDF_ONLY,
		keywords: ['anexos', 'arquivos embutidos'],
		execute: async (ctx) => {
			const files = await run('attachments', { handle: ctx.docs[0].handle });
			if (files.length === 0) throw new Error('Este documento não tem anexos');
			return files;
		}
	},
	{
		id: 'pdf-metadata',
		title: 'Editar metadados',
		blurb: 'Leia e altere título, autor e palavras-chave.',
		group: 'Extrair',
		input: 'single',
		accept: READABLE,
		keywords: ['metadados', 'propriedades', 'autor', 'titulo'],
		component: () => import('./MetadataTool.svelte')
	},
	{
		id: 'pdf-info',
		title: 'Inspecionar PDF',
		blurb: 'Tamanho das páginas, fontes, permissões, anexos e riscos.',
		group: 'Extrair',
		input: 'single',
		accept: READABLE,
		keywords: ['informacoes', 'propriedades', 'analisar'],
		execute: async (ctx) => {
			const report = await run('report', { handle: ctx.docs[0].handle });
			const sizes = new Set(
				report.pageSizes.map((p) => `${Math.round(p.width)}x${Math.round(p.height)}pt`)
			);
			const details: Record<string, string> = {
				Formato: `${report.format} ${report.version ? `(v${report.version / 10})` : ''}`.trim(),
				Páginas: String(report.pageCount),
				'Tamanho das páginas': [...sizes].join(', '),
				Criptografado: report.encrypted ? 'Sim' : 'Não',
				'Precisou de reparo': report.repaired ? 'Sim' : 'Não',
				Anotações: String(report.counts.annotations),
				'Campos de formulário': String(report.counts.formFields),
				Imagens: String(report.counts.images),
				Anexos: String(report.counts.attachments),
				Camadas: String(report.counts.layers),
				'Contém JavaScript': report.hasJavaScript ? 'Sim, considere limpar o arquivo' : 'Não',
				Permitido:
					Object.entries(report.permissions)
						.filter(([, allowed]) => allowed)
						.map(([name]) => PERMISSION_LABELS[name] ?? name)
						.join(', ') || 'nada'
			};
			for (const [key, value] of Object.entries(report.metadata))
				if (value) details[METADATA_LABELS[key] ?? key] = value;

			return {
				files: [
					{
						filename: `${ctx.stem}-relatório.json`,
						mime: 'application/json',
						bytes: new TextEncoder().encode(JSON.stringify(report, null, 2))
					}
				],
				summary: `${plural(report.pageCount, 'página', 'páginas')}, ${formatBytes(ctx.docs[0].byteLength)}`,
				details
			};
		}
	},
	{
		id: 'pdf-bookmarks',
		title: 'Extrair marcadores',
		blurb: 'Liste os marcadores do documento em texto.',
		group: 'Extrair',
		input: 'single',
		accept: READABLE,
		keywords: ['marcadores', 'indice', 'sumario'],
		execute: async (ctx) => {
			const outline = await run('outline', { handle: ctx.docs[0].handle });
			if (outline.length === 0) throw new Error('Este documento não tem marcadores');
			const text = outline
				.map(
					(e) => `${'  '.repeat(e.depth)}${e.title}${e.page === null ? '' : `  (p${e.page + 1})`}`
				)
				.join('\n');
			return {
				files: [
					{
						filename: `${ctx.stem}-marcadores.txt`,
						mime: 'text/plain',
						bytes: new TextEncoder().encode(text)
					}
				],
				preview: text
			};
		}
	}
];

export const byId = (id: string): Tool | undefined => tools.find((tool) => tool.id === id);

export const groups = (): ToolGroup[] =>
	GROUP_ORDER.filter((group) => tools.some((tool) => tool.group === group));

export const inGroup = (group: ToolGroup) => tools.filter((tool) => tool.group === group);

/** Substring match over title, blurb and keywords, for the directory filter. */
export function searchTools(query: string): Tool[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return tools;
	return tools.filter((tool) =>
		[tool.title, tool.blurb, tool.id, ...(tool.keywords ?? [])]
			.join(' ')
			.toLowerCase()
			.includes(needle)
	);
}
