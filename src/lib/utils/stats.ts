import type { PromiseRecord } from '$lib/api/client';

export interface PromiseStats {
	total: number;
	pending: number;
	resolved: number;
	rejected: number;
	rejectedCanceled: number;
	rejectedTimedOut: number;
	/** Resolved promises per minute (based on last hour) */
	throughputPerMin: number;
	/** Rejection rate as percentage (0-100) */
	errorRate: number;
}

/**
 * Computes aggregate statistics from a list of promises.
 */
export function computeStats(promises: PromiseRecord[]): PromiseStats {
	const stats: PromiseStats = {
		total: promises.length,
		pending: 0,
		resolved: 0,
		rejected: 0,
		rejectedCanceled: 0,
		rejectedTimedOut: 0,
		throughputPerMin: 0,
		errorRate: 0
	};

	const now = Date.now();
	const oneHourAgo = now - 60 * 60 * 1000;
	let resolvedLastHour = 0;

	for (const p of promises) {
		switch (p.state) {
			case 'pending':
				stats.pending++;
				break;
			case 'resolved':
				stats.resolved++;
				if (p.settledAt != null && p.settledAt >= oneHourAgo) {
					resolvedLastHour++;
				}
				break;
			case 'rejected':
				stats.rejected++;
				break;
			// Canceled and timed-out promises count toward the failure total
			// *and* keep their own tally, so the dashboard can say which kind
			// of failure it is rather than just how many there were.
			case 'rejected_canceled':
				stats.rejected++;
				stats.rejectedCanceled++;
				break;
			case 'rejected_timedout':
				stats.rejected++;
				stats.rejectedTimedOut++;
				break;
		}
	}

	// Compute throughput (resolved per minute in last hour)
	stats.throughputPerMin = resolvedLastHour / 60;

	// Compute error rate
	const completed = stats.resolved + stats.rejected;
	if (completed > 0) {
		stats.errorRate = (stats.rejected / completed) * 100;
	}

	return stats;
}

/**
 * Returns promises that failed (rejected states).
 */
export function getRecentFailures(
	promises: PromiseRecord[],
	limit: number = 10
): PromiseRecord[] {
	return promises
		.filter(
			(p) =>
				p.state === 'rejected' ||
				p.state === 'rejected_canceled' ||
				p.state === 'rejected_timedout'
		)
		.sort((a, b) => (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt))
		.slice(0, limit);
}

/**
 * Returns promises that are currently pending (active workflows).
 */
export function getActivePending(
	promises: PromiseRecord[],
	limit: number = 5
): PromiseRecord[] {
	return promises
		.filter((p) => p.state === 'pending')
		.sort((a, b) => a.createdAt - b.createdAt) // Oldest first — most stuck
		.slice(0, limit);
}
