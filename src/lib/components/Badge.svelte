<script lang="ts">
	interface Props {
		state: string;
		size?: 'sm' | 'lg';
	}

	let { state, size }: Props = $props();

	function colorClass(s: string): string {
		switch (s) {
			case 'RESOLVED':
				return 'badge-green';
			case 'REJECTED':
			case 'REJECTED_CANCELED':
			case 'REJECTED_TIMEDOUT':
				return 'badge-red';
			case 'PENDING':
				return 'badge-yellow';
			default:
				return 'badge-gray';
		}
	}
</script>

<span class="badge {colorClass(state)}" class:badge-lg={size === 'lg'}>{state}</span>
