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

export interface SearchPromisesParams {
	id?: string;
	state?: string;
	tags?: Record<string, string>;
	limit?: number;
	cursor?: string;
	sortId?: number; // -1 for desc, 1 for asc
}

export async function searchPromises(
	id: string = '*',
	state: string = '',
	limit: number = 50
): globalThis.Promise<Promise[]> {
	const result = await searchPromisesWithCursor({ id, state, limit });
	return result.promises;
}

export async function searchPromisesWithCursor(
	params: SearchPromisesParams
): globalThis.Promise<SearchPromisesResponse> {
	const urlParams = new URLSearchParams({ id: params.id || '*' });
	if (params.state) urlParams.set('state', params.state);
	if (params.limit) urlParams.set('limit', String(params.limit));
	if (params.cursor) urlParams.set('cursor', params.cursor);
	if (params.sortId !== undefined) urlParams.set('sortId', String(params.sortId));
	if (params.tags) {
		for (const [k, v] of Object.entries(params.tags)) {
			urlParams.set(`tags[${k}]`, v);
		}
	}
	return get<SearchPromisesResponse>(`/promises?${urlParams}`);
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
