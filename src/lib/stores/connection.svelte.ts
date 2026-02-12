const URL_KEY = 'resonate-server-url';
const TOKEN_KEY = 'resonate-server-token';
const DEFAULT_URL = 'http://localhost:8001';

function setCookie(name: string, value: string) {
	document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000;SameSite=Strict`;
}

function deleteCookie(name: string) {
	document.cookie = `${name}=;path=/;max-age=0`;
}

function syncCookies(url: string, token: string) {
	if (typeof document === 'undefined') return;
	setCookie(URL_KEY, url);
	if (token) {
		setCookie(TOKEN_KEY, token);
	} else {
		deleteCookie(TOKEN_KEY);
	}
}

function createConnectionStore() {
	let url = $state(
		(typeof localStorage !== 'undefined' && localStorage.getItem(URL_KEY)) || DEFAULT_URL
	);
	let token = $state(
		(typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || ''
	);

	// Sync to cookies on init so the server proxy can read them
	syncCookies(url, token);

	return {
		get url() {
			return url;
		},
		set url(value: string) {
			url = value;
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(URL_KEY, value);
			}
			syncCookies(value, token);
		},
		get token() {
			return token;
		},
		set token(value: string) {
			token = value;
			if (typeof localStorage !== 'undefined') {
				if (value) {
					localStorage.setItem(TOKEN_KEY, value);
				} else {
					localStorage.removeItem(TOKEN_KEY);
				}
			}
			syncCookies(url, value);
		},
		get hasToken() {
			return token.length > 0;
		}
	};
}

export const connectionStore = createConnectionStore();
