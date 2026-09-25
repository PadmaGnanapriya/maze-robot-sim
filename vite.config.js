import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set by the GitHub Pages workflow: the public URL of the site (for link previews)
// and the repository (for the GitHub link in the top bar).
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
const repo = process.env.GITHUB_REPOSITORY;
const repoUrl = process.env.VITE_REPO_URL || (repo ? `https://github.com/${repo}` : '');

// GitHub Pages serves static files with no way to set response headers, so the only way
// to ship a CSP here is a <meta http-equiv> tag - which is why this is a build-only plugin
// (`apply: 'build'`) rather than baked into index.html directly: Vite's dev server injects
// its own inline HMR client script, which a real CSP would block. `frame-ancestors` isn't
// listed because browsers ignore it entirely in the <meta> form (HTTP-header-only); if this
// is ever served from something that can set headers, prefer a real header and add it there.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self'",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  // relative asset paths work at https://<user>.github.io/<any-repo-name>/
  base: './',
  plugins: [
    react(),
    { name: 'site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', siteUrl) },
    {
      name: 'csp-meta', apply: 'build',
      transformIndexHtml: html => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  ],
  define: { 'import.meta.env.VITE_REPO_URL': JSON.stringify(repoUrl) },
  build: {
    chunkSizeWarningLimit: 1200,
    // Vite's modulepreload polyfill is an inline <script>, which the CSP above (script-src
    // 'self', no 'unsafe-inline') would block outright - this build currently emits a single
    // JS chunk so Vite doesn't inject it, but disable it explicitly so that stays true even
    // if the build ever splits into multiple chunks (the polyfill only matters for browsers
    // without native modulepreload support, which can't run this app's WebGL anyway).
    modulePreload: { polyfill: false },
  },
});
