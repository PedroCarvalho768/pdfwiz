import { zipSync } from 'fflate';
import type { OutputFile } from './engine/contract';

function save(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking immediately can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadFile(file: OutputFile) {
	save(new Blob([file.bytes as BlobPart], { type: file.mime }), file.filename);
}

/**
 * Browsers block rapid repeat downloads, so anything past a single file goes
 * out as one zip. PDFs are already deflated internally, so the entries are
 * stored rather than recompressed — same bytes, far less CPU.
 */
export function downloadAll(files: OutputFile[], zipName = 'kyme-pdf.zip') {
	if (files.length === 1) {
		downloadFile(files[0]);
		return;
	}
	save(new Blob([zipSync(zipEntries(files)) as BlobPart], { type: 'application/zip' }), zipName);
}

/**
 * Zip entries keyed by a name unique across the whole archive. Duplicate
 * names would silently overwrite each other, and one "-2" suffix is not
 * enough: "a.pdf, a.pdf, a-2.pdf" collides again on the rename.
 */
export function zipEntries(files: OutputFile[]) {
	const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
	for (const file of files) {
		let name = file.filename;
		for (let n = 2; name in entries; n++) name = file.filename.replace(/(\.[^.]+)?$/, `-${n}$1`);
		entries[name] = [file.bytes, { level: 0 }];
	}
	return entries;
}

/** Extensions this app accepts. Only these are stripped for output names. */
const KNOWN_EXTENSION =
	/\.(pdf|md|markdown|txt|html?|xhtml|epub|mobi|fb2|cbz|xps|svg|png|jpe?g|gif|bmp|webp|tiff?|docx|xlsx|xls|csv)$/i;

/** "document.pdf" -> "document", but "Report v1.2" stays "Report v1.2". */
export const baseName = (filename: string) => filename.replace(KNOWN_EXTENSION, '');

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
