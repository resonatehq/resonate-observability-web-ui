<script lang="ts">
	interface Props {
		label: string;
		value: string | number;
	}

	let { label, value }: Props = $props();
</script>

<div class="metric-card">
	<div class="metric-value">{value}</div>
	<div class="metric-label">{label}</div>
</div>

<style>
	.metric-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
	}

	.metric-value {
		font-size: 2rem;
		font-weight: 700;
		font-family: var(--font-mono);
		line-height: 1;
		margin-bottom: 0.375rem;
	}

	.metric-label {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
</style>
