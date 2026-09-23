import { describe, expect, it } from 'vitest';
import { baseName, zipEntries } from './download';

const file = (filename: string) => ({ filename, mime: 'application/pdf', bytes: new Uint8Array() });

describe('output naming', () => {
	it('strips only extensions this app reads', () => {
		expect(baseName('document.pdf')).toBe('document');
		expect(baseName('Scan.JPEG')).toBe('Scan');
		expect(baseName('Report v1.2')).toBe('Report v1.2');
		expect(baseName('notes.final.docx')).toBe('notes.final');
	});

	it('gives every zip entry a unique name, even against earlier renames', () => {
		const names = Object.keys(zipEntries(['a.pdf', 'a.pdf', 'a-2.pdf', 'a.pdf'].map(file)));
		expect(names).toEqual(['a.pdf', 'a-2.pdf', 'a-2-2.pdf', 'a-3.pdf']);
	});
});
