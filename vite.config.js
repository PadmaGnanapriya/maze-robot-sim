import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set by the GitHub Pages workflow: the public URL of the site (for link previews)
// and the repository (for the GitHub link in the top bar).
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
const repo = process.env.GITHUB_REPOSITORY;
const repoUrl = process.env.VITE_REPO_URL || (repo ? `https://github.com/${repo}` : '');

export default defineConfig({
  // relative asset paths work at https://<user>.github.io/<any-repo-name>/
  base: './',
  plugins: [
    react(),
    { name: 'site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', siteUrl) },
  ],
  define: { 'import.meta.env.VITE_REPO_URL': JSON.stringify(repoUrl) },
  build: { chunkSizeWarningLimit: 1200 },
});
