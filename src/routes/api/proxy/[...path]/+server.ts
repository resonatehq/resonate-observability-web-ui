import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const serverUrl = cookies.get('resonate-server-url') || 'http://localhost:8001';
	const token = cookies.get('resonate-server-token') || '';

	const target = `${serverUrl.replace(/\/+$/, '')}/${params.path}?${url.searchParams}`;

	const headers: HeadersInit = {};
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	try {
		const resp = await fetch(target, { headers });
		return new Response(resp.body, {
			status: resp.status,
			headers: {
				'Content-Type': resp.headers.get('Content-Type') || 'application/json'
			}
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: String(e) }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
