import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Security policy for the built web app (spec §20). The session lives in the browser, so the page
 * may only run its own scripts and talk to the API, file storage (signed links) and error tracking.
 * `no-referrer` keeps share-link tokens (/s/<token>) out of requests for photos and links.
 * Hosting should also send these as headers, with `frame-ancestors 'none'` (not possible in a meta tag).
 */
function securityPolicy(env: Record<string, string>): Plugin {
  const origin = (url: string | undefined, fallback: string) => {
    try {
      return new URL(url || fallback).origin
    } catch {
      return new URL(fallback).origin
    }
  }
  const api = origin(env.VITE_API_URL, 'http://localhost:3000')
  const storage = origin(env.VITE_STORAGE_URL, 'http://localhost:8333')
  const sentry = env.VITE_SENTRY_DSN ? origin(env.VITE_SENTRY_DSN.replace(/\/\/[^@]+@/, '//'), 'https://sentry.io') : ''
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // The design system injects its stylesheet; fonts come from Google Fonts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${storage}`,
    `connect-src 'self' ${api} ${storage} ${sentry}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'jengalink-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), securityPolicy(loadEnv(mode, process.cwd()))],
}))
