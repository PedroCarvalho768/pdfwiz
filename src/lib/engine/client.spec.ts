/** The main-thread client, against a stand-in Worker. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerIn, WorkerOut } from './contract';

class FakeWorker {
	static instances: FakeWorker[] = [];
	onmessage: ((event: { data: WorkerOut }) => void) | null = null;
	onerror: ((event: { message: string }) => void) | null = null;
	posted: WorkerIn[] = [];
	terminated = false;
	failPost = false;
	constructor() {
		FakeWorker.instances.push(this);
	}
	postMessage(message: WorkerIn) {
		if (this.failPost) throw new DOMException('could not be cloned', 'DataCloneError');
		this.posted.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	reply(message: WorkerOut) {
		this.onmessage!({ data: message });
	}
}

let client: typeof import('./client');
const latest = () => FakeWorker.instances.at(-1)!;
const lastJobId = () =>
	latest()
		.posted.filter((m) => m.kind === 'job')
		.at(-1)!.id;

beforeAll(async () => {
	vi.stubGlobal('Worker', FakeWorker);
	client = await import('./client');
});

describe('client', () => {
	it('drops a crashed worker so the next job starts a fresh one', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const job = client.run('close', { handle: 'doc-0' });
		const crashed = latest();
		crashed.onerror!({ message: 'RuntimeError: unreachable' });
		await expect(job).rejects.toThrow(/parou inesperadamente/);
		expect(crashed.terminated).toBe(true);

		void client.run('close', { handle: 'doc-0' });
		expect(latest()).not.toBe(crashed);
		spy.mockRestore();
	});

	it('removes the abort listener once the job settles', async () => {
		const controller = new AbortController();
		const job = client.run('close', { handle: 'doc-0' }, { signal: controller.signal });
		latest().reply({ kind: 'done', id: lastJobId(), result: null });
		await job;
		controller.abort();
		expect(latest().posted.some((m) => m.kind === 'cancel')).toBe(false);
	});

	it('still cancels a running job', async () => {
		const controller = new AbortController();
		const job = client.run('close', { handle: 'doc-0' }, { signal: controller.signal });
		const id = lastJobId();
		controller.abort();
		expect(latest().posted).toContainEqual({ kind: 'cancel', id });
		latest().reply({ kind: 'error', id, message: 'Operação cancelada', code: 'CANCELLED' });
		await expect(job).rejects.toThrow('Operação cancelada');
	});

	it('shows users Portuguese, and developers the detail, when params cannot be cloned', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		latest().failPost = true;
		await expect(client.run('close', { handle: 'doc-0' })).rejects.toThrow(
			/Não foi possível enviar os dados/
		);
		expect(String(spy.mock.calls[0][0])).toContain('$state.raw');
		latest().failPost = false;
		spy.mockRestore();
	});

	it('rejects an already-aborted signal in Portuguese', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			client.run('close', { handle: 'doc-0' }, { signal: controller.signal })
		).rejects.toThrow('Operação cancelada');
	});

	it('falls back to PDF when the browser reports no type', () => {
		expect(client.magicFor(new File([], 'scan.unknown', { type: '' }))).toBe('application/pdf');
		expect(client.magicFor(new File([], 'notes.md', { type: '' }))).toBe('text/markdown');
		expect(client.magicFor(new File([], 'x.bin', { type: 'image/png' }))).toBe('image/png');
	});
});
