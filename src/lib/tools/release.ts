import { run } from '$lib/engine/client';

/**
 * Free documents cached in the engine worker. Every handle a caller opens
 * must end up here, or its WASM heap is held until the tab closes.
 *
 * A failed close only leaks memory and there is nothing the user can do
 * about it, so it is logged rather than surfaced.
 */
export function release(...handles: (string | undefined)[]) {
	for (const handle of handles) {
		if (!handle) continue;
		run('close', { handle }).catch((err) => console.error(`Could not close ${handle}`, err));
	}
}
