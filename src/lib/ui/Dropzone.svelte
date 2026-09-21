<script lang="ts">
	let {
		accept,
		multiple = false,
		disabled = false,
		onfiles
	}: {
		accept: string[];
		multiple?: boolean;
		disabled?: boolean;
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
</script>

<!--
	The label wraps a real <input type=file>, so keyboard focus, Enter/Space
	activation and the native picker all work without reimplementing them.
-->
<label
	class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors
		{dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'}
		{disabled ? 'pointer-events-none opacity-50' : ''}"
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
	<span class="text-base font-medium text-ink">
		Drop {multiple ? 'files' : 'a file'} here, or click to choose
	</span>
	<span class="text-sm text-muted">
		Seus arquivos não saem deste dispositivo. Tudo roda no seu navegador.
	</span>
</label>
