/**
 * Where to find the operator's Resonate server, what token to present to it,
 * and — separately — what Google Cloud Run identity token to present at the
 * edge in front of it.
 *
 * The Resonate token and the Cloud Run token are two different mechanisms at
 * two different layers: the former is this app's own auth, sent inside the
 * envelope body; the latter is Google's, sent as an HTTP header, and is only
 * relevant when the server sits behind Cloud Run IAM. A server can require
 * either, both, or neither.
 *
 * Both live in `localStorage` only. The previous version also mirrored them
 * into cookies so a server-side proxy route could read them; that proxy is
 * gone, and with it a cookie that was neither `HttpOnly` nor `Secure`.
 *
 * The tokens are still stored in plaintext, which is appropriate for a local
 * operator tool and is not appropriate for a UI served on a shared network.
 * Settings says so out loud.
 */

const URL_KEY = 'resonate-server-url';
const TOKEN_KEY = 'resonate-server-token';
const CLOUD_RUN_TOKEN_KEY = 'resonate-cloudrun-token';

/** The server's own default (`--server-port 8001`). */
const DEFAULT_URL = 'http://localhost:8001';

function read(key: string, fallback = ''): string {
	if (typeof localStorage === 'undefined') return fallback;
	return localStorage.getItem(key) || fallback;
}

function write(key: string, value: string) {
	if (typeof localStorage === 'undefined') return;
	if (value) localStorage.setItem(key, value);
	else localStorage.removeItem(key);
}

function createConnectionStore() {
	let url = $state(read(URL_KEY, DEFAULT_URL));
	let token = $state(read(TOKEN_KEY));
	let cloudRunToken = $state(read(CLOUD_RUN_TOKEN_KEY));

	return {
		get url() {
			return url;
		},
		set url(value: string) {
			url = value;
			write(URL_KEY, value);
		},
		get token() {
			return token;
		},
		set token(value: string) {
			token = value;
			write(TOKEN_KEY, value);
		},
		get hasToken() {
			return token.length > 0;
		},
		get cloudRunToken() {
			return cloudRunToken;
		},
		set cloudRunToken(value: string) {
			cloudRunToken = value;
			write(CLOUD_RUN_TOKEN_KEY, value);
		},
		get hasCloudRunToken() {
			return cloudRunToken.length > 0;
		}
	};
}

export const connectionStore = createConnectionStore();
