---
type: ADR
id: "0008"
title: "Tailwind CLI for production CSS (not the JIT CDN runtime)"
status: superseded
superseded_by: "0011"
date: 2026-04-08
---

> **Superseded by [ADR 0011](0011-on-demand-asset-pipeline.md) (SQR-71).**
> The Tailwind CLI build step was replaced with in-process compilation
> via `@tailwindcss/node` at request time. The framing in this ADR — CDN
> JIT runtime vs. statically-built CSS file — still stands; what changed
> is *when* the build runs (request-time, in-process, cached) instead of
> *deploy time, out-of-process, committed to disk*. The dev ergonomics
> motivation is documented in ADR 0011.

## Context

The Phase 1 Web UI is server-rendered Hono JSX + HTMX with Tailwind for styling. `docs/ARCHITECTURE.md` originally specified "Tailwind CSS via CDN", which on Tailwind's own docs refers to `cdn.tailwindcss.com` — a ~350 KB JavaScript JIT runtime that inspects the DOM in the browser and generates CSS on the fly. Tailwind's docs explicitly call out the CDN as development-only.

The Phase 1 use case is a phone at the gaming table, often on spotty cellular. First paint time matters. We also care about CSP — the Web UI will set a strict `Content-Security-Policy` header (tracked in SQR-61) that should not need `'unsafe-inline'` or third-party script sources. A JIT runtime loaded from `cdn.tailwindcss.com` would pressure both concerns: extra bytes over the network, and either loosened CSP or a third-party allowlist entry.

The project is deployed behind Cloudflare (SQR-58), so "served from a CDN" is not a differentiator — any static asset we serve goes through Cloudflare's edge anyway.

## Decision

**Build CSS at deploy time with the Tailwind CLI, commit no generated CSS, serve the output as a static asset from Hono.** The build command is `tailwindcss -i src/web-ui/styles.css -o public/app.css`, run from the Dockerfile. Hono serves `public/app.css` as a plain static file and Cloudflare edge-caches it.

Do **not** use `cdn.tailwindcss.com` at runtime. Do **not** vendor a pre-built Tailwind CSS file into the repo (regenerated on every deploy).

## Options considered

- **Tailwind CLI, built at deploy time** (chosen): ~10–30 KB of static CSS containing only the classes actually referenced in `src/web-ui/**`, served as a plain file. Fast first paint, CSP-friendly (no inline runtime script), no third-party domain. Adds one build step to the Dockerfile.
- **`cdn.tailwindcss.com` JIT runtime**: simplest to wire up, zero build step, but ships the full ~350 KB runtime JavaScript blob, recomputes styles in the browser (worse first paint, more CPU on mobile), and is labeled dev-only by Tailwind's own docs. Would also require loosening CSP or allowlisting the domain.
- **Vendored pre-built CSS committed to the repo**: avoids the build step at deploy time, but creates a manual regeneration ritual that's easy to forget and bloats git history. Rejected because the deploy pipeline already runs commands — one more is free.
- **Full bundler (Vite/esbuild) for CSS + future JS**: overkill. Contradicts the "no bundler, no client-side build step" stance in ARCHITECTURE.md §Stack. We have no JavaScript to bundle; adding a bundler just to produce CSS is not worth the complexity.

## Consequences

- Dockerfile gains a CSS build step. Deploy pipeline must have Node + npm/pnpm available during build, which it already does.
- Adding a new Tailwind class in JSX requires the build to re-run before it's visible. In dev, `tailwindcss --watch` handles this; in prod, every deploy runs the build.
- CSP (SQR-61) can stay strict — `style-src 'self'` works without carve-outs.
- Future `src/web-ui/**` work must remember that only classes *actually present in source* ship — dynamically-constructed class names (`` `text-${color}-500` ``) will be stripped unless they're safelisted. This is a known Tailwind foot-gun; document it inline when it bites.
- Re-evaluate this decision if: Tailwind's CLI stops supporting static CSS generation, the Dockerfile build time becomes a problem at scale, or Phase 3 introduces a real JavaScript bundling need (at which point the CSS step folds into the bundler naturally).

## Advice

Decision surfaced in the 2026-04-08 Web UI plan-eng-review walkthrough. Brian pushed back on the initial framing ("static file from app vs static file from CDN — both are over the network") and the decision was re-made with the correct framing: the CDN is a JIT runtime JavaScript blob, not a static CSS file. Tailwind CLI chosen after that correction.
