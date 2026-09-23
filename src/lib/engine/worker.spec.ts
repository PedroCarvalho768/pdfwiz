/**
 * The worker shim, driven in Node through a stand-in for the worker global.
 * The real job table runs behind it, so this exercises the actual queue.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerIn, WorkerOut } from './contract';
import { multiPagePdf } from './jobs/testing';

const posted: WorkerOut[] = [];
const listeners: ((message: WorkerOut) => void)[] = [];
const scope = {
	onmessage: null as ((event: { data: WorkerIn }) => void) | null,
	postMessage(message: WorkerOut) {
		posted.push(message);
		for (const listener of listeners) listener(message);
	}
};

const send = (message: WorkerIn) => scope.onmessage!({ data: message });
const of = (id: string) => posted.filter((m) => m.id === id);
const settled = (id: string) =>
	vi.waitFor(
		() => {
			const end = of(id).find((m) => m.kind === 'done' || m.kind === 'error');
			if (!end) throw new Error(`job ${id} still running`);
			return end;
		},
		{ timeout: 10_000 }
	);

let handle = '';

beforeAll(async () => {
	vi.stubGlobal('self', scope);
	await import('./worker');
	send({
		kind: 'job',
		id: 'open',
		name: 'open',
		params: { bytes: multiPagePdf(['One', 'Two', 'Three']), magic: 'application/pdf' }
	});
	const done = await settled('open');
	handle = (done as { result: { handle: string } }).result.handle;
});

const render = (id: string) =>
	send({ kind: 'job', id, name: 'render', params: { handle, width: 20 } });

describe('worker queue', () => {
	it('runs jobs one at a time instead of interleaving them at each yield', async () => {
		render('a');
		render('b');
		await settled('b');
		const aDone = posted.findIndex((m) => m.id === 'a' && m.kind === 'done');
		const bFirst = posted.findIndex((m) => m.id === 'b');
		expect(aDone).toBeGreaterThan(-1);
		expect(bFirst).toBeGreaterThan(aDone);
	});

	it('cancels a job that is still waiting in the queue', async () => {
		render('c');
		render('d');
		send({ kind: 'cancel', id: 'd' });
		expect((await settled('c')).kind).toBe('done');
		const d = await settled('d');
		expect(d).toMatchObject({ kind: 'error', code: 'CANCELLED', message: 'Operação cancelada' });
		expect(of('d').some((m) => m.kind === 'chunk')).toBe(false);
	});

	it('cancels a job that is already running', async () => {
		listeners.push((m) => {
			if (m.id === 'e' && m.kind === 'chunk') send({ kind: 'cancel', id: 'e' });
		});
		render('e');
		expect(await settled('e')).toMatchObject({ kind: 'error', code: 'CANCELLED' });
		expect(of('e').filter((m) => m.kind === 'chunk')).toHaveLength(1);
	});

	it('reports an unknown job and a raw engine failure in Portuguese', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		send({ kind: 'job', id: 'u', name: 'noSuchJob', params: {} });
		expect(((await settled('u')) as { message: string }).message).toMatch(/não existe/);

		send({
			kind: 'job',
			id: 'r',
			name: 'save',
			params: { handle, options: 'no-such-option' }
		});
		const raw = (await settled('r')) as { message: string; code: string };
		expect(raw.message).toMatch(/^Não foi possível concluir a operação/);
		expect(raw.code).toBe('ENGINE_INTERNAL');
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
