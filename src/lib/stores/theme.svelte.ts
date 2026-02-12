/**
 * Theme store for light/dark mode management.
 */

export type Theme = 'light' | 'dark';

class ThemeStore {
	theme: Theme = $state('dark');

	constructor() {
		if (typeof window !== 'undefined') {
			// Load from localStorage or default to dark
			const stored = localStorage.getItem('resonate-theme') as Theme | null;
			this.theme = stored ?? 'dark';
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
