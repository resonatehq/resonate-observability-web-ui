import {
	searchPromises,
	searchSchedules,
	ApiError,
	type PromiseRecord,
	type ScheduleRecord
} from '$lib/api/client';
import { computeStats, getRecentFailures, getActivePending, type PromiseStats } from '$lib/utils/stats';

class DashboardStore {
	promises: PromiseRecord[] = $state([]);
	schedules: ScheduleRecord[] = $state([]);
	stats: PromiseStats = $state({
		total: 0,
		pending: 0,
		resolved: 0,
		rejected: 0,
		rejectedCanceled: 0,
		rejectedTimedOut: 0,
		throughputPerMin: 0,
		errorRate: 0
	});
	recentFailures: PromiseRecord[] = $state([]);
	activePending: PromiseRecord[] = $state([]);
	loading = $state(true);
	error = $state<ApiError | null>(null);
	/**
	 * How many promises the figures below were computed from.
	 *
	 * Every number on the dashboard is counted client-side over one page of
	 * search results, because `/metrics` exposes API traffic rather than
	 * promise counts by state. The UI says "sampled from N" rather than
	 * implying a server-wide total.
	 */
	sampleSize = $state(0);
	/** True when the server had more promises than this sample covers. */
	sampleTruncated = $state(false);

	private pollInterval: ReturnType<typeof setInterval> | null = null;

	async load() {
		this.loading = true;
		this.error = null;
		try {
			// One page only. There is no sort parameter, so this is the first
			// 100 promises by ID — not the most recent 100, whatever the old
			// `sortId: -1` implied.
			const promiseResult = await searchPromises({ limit: 100 });
			this.promises = promiseResult.promises;
			this.sampleSize = promiseResult.promises.length;
			this.sampleTruncated = !!promiseResult.cursor;

			const scheduleResult = await searchSchedules({ limit: 100 });
			this.schedules = scheduleResult.schedules;

			// Compute stats
			this.stats = computeStats(this.promises);
			this.recentFailures = getRecentFailures(this.promises, 10);
			this.activePending = getActivePending(this.promises, 5);
		} catch (e) {
			this.error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
		} finally {
			this.loading = false;
		}
	}

	startPolling(intervalMs: number = 5000) {
		this.stopPolling();
		this.load(); // Initial load
		this.pollInterval = setInterval(() => {
			// Only poll if document is visible
			if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
				this.load();
			}
		}, intervalMs);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}

export const dashboardStore = new DashboardStore();
