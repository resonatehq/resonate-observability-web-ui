import {
	searchPromisesWithCursor,
	searchSchedules,
	type Promise,
	type Schedule
} from '$lib/api/client';
import { computeStats, getRecentFailures, getActivePending, type PromiseStats } from '$lib/utils/stats';

class DashboardStore {
	promises: Promise[] = $state([]);
	schedules: Schedule[] = $state([]);
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
	recentFailures: Promise[] = $state([]);
	activePending: Promise[] = $state([]);
	loading = $state(true);
	error: string | null = $state(null);

	private pollInterval: ReturnType<typeof setInterval> | null = null;

	async load() {
		this.loading = true;
		this.error = null;
		try {
			// Fetch recent promises (last 500 for stats)
			const promiseResult = await searchPromisesWithCursor({
				id: '*',
				limit: 500,
				sortId: -1 // Most recent first
			});
			this.promises = promiseResult.promises;

			// Fetch schedules count
			const scheduleList = await searchSchedules('*', 100);
			this.schedules = scheduleList;

			// Compute stats
			this.stats = computeStats(this.promises);
			this.recentFailures = getRecentFailures(this.promises, 10);
			this.activePending = getActivePending(this.promises, 5);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
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
