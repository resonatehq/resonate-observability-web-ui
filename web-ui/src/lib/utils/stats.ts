import type { Promise } from '$lib/api/client';

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
export function computeStats(promises: Promise[]): PromiseStats {
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
			case 'PENDING':
				stats.pending++;
				break;
			case 'RESOLVED':
				stats.resolved++;
				// Count resolved in last hour for throughput
				if (p.completedOn && p.completedOn >= oneHourAgo) {
					resolvedLastHour++;
				}
				break;
			case 'REJECTED':
				stats.rejected++;
				break;
			case 'REJECTED_CANCELED':
				stats.rejected++;
				stats.rejectedCanceled++;
				break;
			case 'REJECTED_TIMEDOUT':
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
export function getRecentFailures(promises: Promise[], limit: number = 10): Promise[] {
	return promises
		.filter(
			(p) =>
				p.state === 'REJECTED' ||
				p.state === 'REJECTED_CANCELED' ||
				p.state === 'REJECTED_TIMEDOUT'
		)
		.sort((a, b) => {
			const timeA = a.completedOn ?? a.createdOn ?? 0;
			const timeB = b.completedOn ?? b.createdOn ?? 0;
			return timeB - timeA; // Descending
		})
		.slice(0, limit);
}

/**
 * Returns promises that are currently pending (active workflows).
 */
export function getActivePending(promises: Promise[], limit: number = 5): Promise[] {
	return promises
		.filter((p) => p.state === 'PENDING')
		.sort((a, b) => {
			const timeA = a.createdOn ?? 0;
			const timeB = b.createdOn ?? 0;
			return timeA - timeB; // Oldest first
		})
		.slice(0, limit);
}
