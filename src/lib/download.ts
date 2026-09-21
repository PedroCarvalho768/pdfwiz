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
export function downloadAll(files: OutputFile[], zipName = 'pdfwiz.zip') {
	if (files.length === 1) {
		downloadFile(files[0]);
		return;
	}
	const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
	files.forEach((file, index) => {
		// Duplicate names would silently overwrite each other inside the zip.
		const name = entries[file.filename]
			? file.filename.replace(/(\.[^.]+)?$/, `-${index + 1}$1`)
			: file.filename;
		entries[name] = [file.bytes, { level: 0 }];
	});
	save(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), zipName);
}

/** "document.pdf" -> "document" */
export const baseName = (filename: string) => filename.replace(/\.[^./\\]+$/, '');

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
