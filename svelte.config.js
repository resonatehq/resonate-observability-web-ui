import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Static build. The output is plain files — no Node runtime is needed to run
 * this UI, and there is no server-side hop between the browser and the
 * operator's Resonate server.
 *
 * That last point is the reason for the change, not a side effect: the old
 * `/api/proxy/[...path]` route fetched a URL supplied by the client, and
 * mirrored the admin token into a cookie that was neither HttpOnly nor Secure.
 * Both are gone with it.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			// Every route is client-rendered against a server chosen at runtime,
			// so there is nothing to prerender per-path. `fallback` makes the
			// build a true SPA: any deep link boots the app and the router takes
			// over, which is what `/promises/[id]` needs when opened cold.
			fallback: 'index.html',
			precompress: false
		})
	}
};

export default config;
