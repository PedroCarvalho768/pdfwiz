<script lang="ts">
	let {
		accept,
		multiple = false,
		disabled = false,
		compact = false,
		label,
		onfiles
	}: {
		accept: string[];
		multiple?: boolean;
		disabled?: boolean;
		/** A small button-sized picker, for changing or adding files after load. */
		compact?: boolean;
		label?: string;
		onfiles: (files: File[]) => void;
	} = $props();

	let dragging = $state(false);
	let input: HTMLInputElement;

	function take(list: FileList | null | undefined) {
		const files = Array.from(list ?? []);
		if (files.length) onfiles(multiple ? files : files.slice(0, 1));
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (!disabled) take(event.dataTransfer?.files);
	}

	// The input is sr-only, so the label has to show keyboard focus for it.
	const focusRing =
		'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';
</script>

<!--
	The label wraps a real <input type=file>, so keyboard focus, Enter/Space
	activation and the native picker all work without reimplementing them.
-->
<label
	class={compact
		? `inline-flex cursor-pointer items-center rounded-[var(--radius-control)] border px-4 py-2 text-sm font-medium text-ink transition-colors ${focusRing}
			${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-bg hover:bg-surface'}
			${disabled ? 'pointer-events-none opacity-50' : ''}`
		: `flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors ${focusRing}
			${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'}
			${disabled ? 'pointer-events-none opacity-50' : ''}`}
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<input
		bind:this={input}
		type="file"
		class="sr-only"
		{multiple}
		{disabled}
		accept={accept.join(',')}
		onchange={(e) => {
			take(e.currentTarget.files);
			// Reset so picking the same file twice still fires a change event.
			input.value = '';
		}}
	/>
	{#if compact}
		{label ?? (multiple ? 'Adicionar arquivos' : 'Trocar arquivo')}
	{:else}
		<span class="text-base font-medium text-ink">
			{label ??
				(multiple
					? 'Solte os arquivos aqui ou clique para escolher'
					: 'Solte o arquivo aqui ou clique para escolher')}
		</span>
		<span class="text-sm text-muted">
			Seus arquivos não saem deste dispositivo. Tudo roda no seu navegador.
		</span>
	{/if}
</label>
