/**
 * Theme store for light/dark mode management.
 */

export type Theme = 'light' | 'dark';

class ThemeStore {
	/**
	 * Light by default, per the brand's light-by-default rule. Dark is fully
	 * supported and remembered per-browser, but it is the choice, not the
	 * starting point — and it was previously the only mode anyone had checked
	 * for contrast.
	 */
	theme: Theme = $state('light');

	constructor() {
		if (typeof window !== 'undefined') {
			// Load from localStorage or fall back to the brand default
			const stored = localStorage.getItem('resonate-theme') as Theme | null;
			this.theme = stored ?? 'light';
			this.applyTheme(this.theme);
		}
	}

	toggle() {
		this.theme = this.theme === 'dark' ? 'light' : 'dark';
		this.save();
	}

	setTheme(theme: Theme) {
		this.theme = theme;
		this.save();
	}

	private save() {
		if (typeof window !== 'undefined') {
			localStorage.setItem('resonate-theme', this.theme);
			this.applyTheme(this.theme);
		}
	}

	private applyTheme(theme: Theme) {
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme);
		}
	}
}

export const themeStore = new ThemeStore();
