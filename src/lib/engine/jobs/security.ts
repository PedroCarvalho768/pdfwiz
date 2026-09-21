/** Passwords, permissions, redaction, sanitising, damage and repair. */
import * as mupdf from 'mupdf';
import type { DocHandle, OutputFile } from '../contract';
import { EngineError, allPages, pagesOf, toOutput, type JobContext } from '../shared';

/**
 * PDF permission bits, as defined in the spec's Table 22. The flags are
 * negative permissions in effect: a cleared bit forbids the operation.
 */
export const PERMISSION_BITS = {
	print: 1 << 2,
	modify: 1 << 3,
	copy: 1 << 4,
	annotate: 1 << 5,
	fillForms: 1 << 8,
	accessibility: 1 << 9,
	assemble: 1 << 10,
	printHighQuality: 1 << 11
} as const;

export type PermissionName = keyof typeof PERMISSION_BITS;

/** Reserved high bits must be set; readers reject the value otherwise. */
const PERMISSION_BASE = -1 & ~0xfff;

export function permissionMask(allowed: Partial<Record<PermissionName, boolean>>): number {
	let mask = PERMISSION_BASE | 0b11; // bits 1-2 are reserved and always set
	for (const [name, bit] of Object.entries(PERMISSION_BITS))
		if (allowed[name as PermissionName]) mask |= bit;
	return mask;
}

export type Encryption = 'rc4-128' | 'aes-128' | 'aes-256';

function encryptionOptions(params: {
	encryption?: Encryption;
	userPassword?: string;
	ownerPassword?: string;
	permissions?: Partial<Record<PermissionName, boolean>>;
}): string {
	const parts = [
		'compress',
		'garbage=compact',
		`encrypt=${params.encryption ?? 'aes-256'}`,
		`permissions=${permissionMask(params.permissions ?? {})}`
	];
	// MuPDF treats an empty password as "no password required to open", which
	// is exactly what permissions-only protection means.
	parts.push(`user-password=${params.userPassword ?? ''}`);
	parts.push(`owner-password=${params.ownerPassword || params.userPassword || ''}`);
	return parts.join(',');
}

export const securityJobs = {
	/** Add a password and/or usage restrictions. */
	protect(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			userPassword?: string;
			ownerPassword?: string;
			encryption?: Encryption;
			permissions?: Partial<Record<PermissionName, boolean>>;
			filename?: string;
		}
	): OutputFile {
		if (!params.userPassword && !params.ownerPassword)
			throw new EngineError('Defina uma senha de abertura, uma de proprietário, ou as duas');
		return toOutput(
			ctx.get(params.handle),
			params.filename ?? 'protected.pdf',
			encryptionOptions(params)
		);
	},

	/**
	 * Remove the password. The document must already be open, which means the
	 * password was supplied and accepted when it was loaded — this tool cannot
	 * and does not crack anything.
	 */
	unlock(ctx: JobContext, params: { handle: DocHandle; filename?: string }): OutputFile {
		return toOutput(
			ctx.get(params.handle),
			params.filename ?? 'unlocked.pdf',
			'compress,garbage=compact,encrypt=none'
		);
	},

	/** Report what the current document allows, for the UI to display. */
	permissions(
		ctx: JobContext,
		params: { handle: DocHandle }
	): Record<string, boolean> & { encrypted: boolean } {
		const doc = ctx.get(params.handle);
		const names: mupdf.DocumentPermission[] = [
			'print',
			'copy',
			'edit',
			'annotate',
			'form',
			'accessibility',
			'assemble',
			'print-hq'
		];
		const out: Record<string, boolean> = {};
		for (const name of names) out[name] = doc.hasPermission(name);
		return { ...out, encrypted: (doc.getMetaData('encryption') ?? 'None') !== 'None' };
	},

	/**
	 * Permanently remove content inside the given rectangles.
	 *
	 * This is real redaction: `applyRedactions` deletes the underlying text
	 * and image data rather than drawing a black box over it. A covering
	 * rectangle that leaves the text extractable is a security bug, and the
	 * test suite asserts against exactly that.
	 */
	redact(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			/** Rectangles in PDF points, grouped by page index. */
			areas: { page: number; rect: [number, number, number, number] }[];
			/** Also remove any image the rectangle touches. */
			removeImages?: boolean;
			blackBoxes?: boolean;
			filename?: string;
		}
	): OutputFile {
		if (params.areas.length === 0) throw new EngineError('Marque pelo menos uma área para tarjar');
		const doc = ctx.get(params.handle);

		const byPage = new Map<number, [number, number, number, number][]>();
		for (const area of params.areas) {
			pagesOf(doc, [area.page]);
			byPage.set(area.page, [...(byPage.get(area.page) ?? []), area.rect]);
		}

		for (const [index, rects] of byPage) {
			const page = doc.loadPage(index);
			for (const rect of rects) {
				const annotation = page.createAnnotation('Redact');
				annotation.setRect(rect);
				annotation.update();
			}
			page.applyRedactions(
				params.blackBoxes ?? true,
				params.removeImages ? mupdf.PDFPage.REDACT_IMAGE_REMOVE : mupdf.PDFPage.REDACT_IMAGE_PIXELS
			);
		}
		return toOutput(doc, params.filename ?? 'redacted.pdf');
	},

	/**
	 * Strip the parts of a PDF that carry risk or leak history: embedded
	 * JavaScript, attached files, document metadata and open actions.
	 */
	sanitize(
		ctx: JobContext,
		params: {
			handle: DocHandle;
			javascript?: boolean;
			attachments?: boolean;
			metadata?: boolean;
			links?: boolean;
			filename?: string;
		}
	): OutputFile {
		const { javascript = true, attachments = true, metadata = true, links = false } = params;
		const doc = ctx.get(params.handle);
		const root = doc.getTrailer().get('Root');

		// MuPDF returns a null PDFObject rather than undefined, so optional
		// chaining does not protect these lookups — isNull() does.
		const names = root.get('Names');
		const hasNames = !names.isNull() && names.isDictionary();

		if (javascript) {
			if (hasNames) names.delete('JavaScript');
			root.delete('OpenAction');
			root.delete('AA');
		}

		if (attachments) {
			for (const name of Object.keys(doc.getEmbeddedFiles())) doc.deleteEmbeddedFile(name);
			if (hasNames) names.delete('EmbeddedFiles');
		}

		if (metadata) {
			for (const key of [
				'info:Title',
				'info:Author',
				'info:Subject',
				'info:Keywords',
				'info:Creator',
				'info:Producer'
			])
				doc.setMetaData(key, '');
			// The XMP stream duplicates all of the above and must go too.
			root.delete('Metadata');
		}

		if (links) {
			for (const index of allPages(doc)) {
				const page = doc.loadPage(index);
				for (const annotation of page.getAnnotations())
					if (annotation.getType() === 'Link') page.deleteAnnotation(annotation);
			}
		}

		return toOutput(doc, params.filename ?? 'sanitized.pdf');
	},

	/**
	 * Rewrite a damaged file. MuPDF rebuilds a broken cross-reference table
	 * when it opens a document, so saving it back out is the repair — the
	 * result reports whether anything actually needed fixing.
	 */
	repair(
		ctx: JobContext,
		params: { handle: DocHandle; filename?: string }
	): { file: OutputFile; wasRepaired: boolean } {
		const doc = ctx.get(params.handle);
		return {
			file: toOutput(doc, params.filename ?? 'repaired.pdf', 'garbage=compact,compress'),
			wasRepaired: doc.wasRepaired()
		};
	},

	/**
	 * Deliberately damage a file so that readers refuse to open it.
	 *
	 * MuPDF rebuilds a broken xref table on sight, so merely truncating the
	 * trailer is not enough — the header and the object bodies have to go too,
	 * or the "corrupt" file would still open fine in half the readers.
	 */
	corrupt(
		ctx: JobContext,
		params: { handle: DocHandle; strength?: number; filename?: string }
	): OutputFile {
		const doc = ctx.get(params.handle);
		const bytes = doc.saveToBuffer('compress').asUint8Array().slice();
		if (bytes.length < 64)
			throw new EngineError('Este arquivo é pequeno demais para ser danificado de forma útil');

		const strength = Math.min(Math.max(params.strength ?? 20, 1), 100) / 100;

		// 1. Break the header, so the file is not recognised as a PDF at all.
		for (let i = 0; i < 8; i++) bytes[i] = 0;

		// 2. Scramble a deterministic spread of the body, defeating recovery.
		const hits = Math.max(64, Math.floor(bytes.length * strength));
		const step = Math.max(1, Math.floor(bytes.length / hits));
		for (let i = 16; i < bytes.length; i += step) bytes[i] = (bytes[i] + 0x5a) & 0xff;

		// 3. Drop the trailer, removing the xref offset a reader starts from.
		const kept = bytes.slice(0, Math.max(32, Math.floor(bytes.length * 0.97)));
		return { filename: params.filename ?? 'corrupted.pdf', mime: 'application/pdf', bytes: kept };
	}
};
