export interface Promise {
	id: string;
	state: string;
	param?: Value;
	value?: Value;
	timeout: number;
	tags?: Record<string, string>;
	createdOn?: number;
	completedOn?: number;
	idempotencyKeyForCreate?: string;
	idempotencyKeyForComplete?: string;
}

export interface Value {
	headers?: Record<string, string>;
	data?: string;
}

export interface Schedule {
	id: string;
	description?: string;
	cron: string;
	tags?: Record<string, string>;
	promiseId: string;
	lastRunTime?: number;
	nextRunTime?: number;
	createdOn?: number;
}

interface SearchPromisesResponse {
	promises: Promise[];
	cursor?: string;
}

interface SearchSchedulesResponse {
	schedules: Schedule[];
	cursor?: string;
}

// All requests go through the SvelteKit server proxy at /api/proxy/
// to avoid CORS issues. The proxy reads the target URL and auth token from cookies.
async function get<T>(path: string): globalThis.Promise<T> {
	const proxyPath = `/api/proxy${path}`;
	const resp = await fetch(proxyPath);
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`API returned ${resp.status}: ${body}`);
	}
	return resp.json();
}

export async function searchPromises(
	id: string = '*',
	state: string = '',
	limit: number = 50
): globalThis.Promise<Promise[]> {
	const params = new URLSearchParams({ id: id || '*' });
	if (state) params.set('state', state);
	if (limit) params.set('limit', String(limit));
	const resp = await get<SearchPromisesResponse>(`/promises?${params}`);
	return resp.promises ?? [];
}

export async function getPromise(id: string): globalThis.Promise<Promise> {
	return get<Promise>(`/promises/${encodeURIComponent(id)}`);
}

export async function searchSchedules(
	id: string = '*',
	limit: number = 50
): globalThis.Promise<Schedule[]> {
	const params = new URLSearchParams({ id: id || '*' });
	if (limit) params.set('limit', String(limit));
	const resp = await get<SearchSchedulesResponse>(`/schedules?${params}`);
	return resp.schedules ?? [];
}

export async function getSchedule(id: string): globalThis.Promise<Schedule> {
	return get<Schedule>(`/schedules/${encodeURIComponent(id)}`);
}
