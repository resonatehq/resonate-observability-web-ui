/**
 * This is a client-rendered SPA, not a prerendered site.
 *
 * The server it talks to is chosen by the operator at runtime and stored in
 * `localStorage`, so there is nothing meaningful to render at build time —
 * every page would have to be re-fetched on hydration anyway.
 */
export const ssr = false;
export const prerender = false;
