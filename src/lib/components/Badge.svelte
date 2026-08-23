<script lang="ts">
	import type { PromiseState } from '$lib/api/client';
	import { stateBadgeClass, stateDescription, stateLabel } from '$lib/utils/state';

	interface Props {
		state: PromiseState;
		size?: 'sm' | 'lg';
	}

	let { state, size }: Props = $props();
</script>

<span
	class="badge {stateBadgeClass(state)}"
	class:badge-lg={size === 'lg'}
	title={stateDescription(state)}>{stateLabel(state)}</span
>
