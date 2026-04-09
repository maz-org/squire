# Custom Lint Rules

ESLint rules that enforce the application layering described in
[ARCHITECTURE.md](../ARCHITECTURE.md) § Application Layering. These catch
violations at build time that code review and testing can miss.

## Rules

### 1. no-view-auth-import (import restriction)

**Scope:** `src/web-ui/**/*.ts`

Views must not import from auth modules (`src/auth/*`), the database layer
(`src/db.ts`, `src/db/schema/*`), or repository implementations
(`*-repository.ts`). The only allowed import from the repository layer is
`src/db/repositories/types.ts` (domain types). Views are pure data in, HTML out.

**Why:** SQR-38 design review caught auth error pages importing from
session-middleware. The view layer should receive a `Session` object, not
reach into the auth or persistence layers.

### 2. no-repository-upward-import (import restriction)

**Scope:** `src/db/repositories/**/*.ts`

Repositories must not import from auth modules (except `audit.ts` for the
`DbOrTx` type), view modules (`src/web-ui/*`), or route handlers
(`src/server.ts`). Dependencies flow down only.

### 3. no-drizzle-in-domain-types (import restriction)

**Scope:** `src/db/repositories/types.ts`

The domain types file must not import from `drizzle-orm` or `src/db/schema/*`.
Domain types are the public contract between the repository layer and the rest
of the app. They must be ORM-independent.

### 4. no-exported-row-types (custom AST rule)

**Scope:** `src/db/repositories/*-repository.ts`

Repository files must not export type aliases or interfaces whose names contain
"Row", "$inferSelect", or "$inferInsert". Row types are internal to the
persistence boundary. Callers should use the domain types from `types.ts`.

### 5. no-inline-html-response (custom AST rule)

**Scope:** `src/server.ts`

Calls to `c.html()` with a template literal or string literal argument are
flagged. All HTML rendering must go through `layoutShell()`,
`renderAuthErrorPage()`, or another dedicated page renderer that uses the
design system from DESIGN.md.

**Why:** SQR-38 shipped auth error pages with raw inline HTML (system fonts,
white background, blue button) completely outside the design system. This rule
prevents that class of bug.

### 6. no-cache-on-authenticated-routes (custom AST rule)

**Scope:** `src/server.ts`

Routes using `requireSession()` middleware must call
`c.header('Cache-Control', 'no-store')` in the handler body. Personalized
content behind auth must not be cached by proxies or CDNs.

**Why:** CodeRabbit caught on PR #211 that `/auth/me` returned per-user PII
with no cache directives. A CDN could have served one user's email to another.

## Implementation

Rules 1-3 use ESLint's built-in `no-restricted-imports` with file-scoped
overrides in `eslint.config.js`.

Rules 4-6 are custom AST rules in `eslint-rules/`. They use ESLint's
`RuleModule` API with `CallExpression` and `ExportNamedDeclaration` visitors.

## Testing a rule

To verify a rule catches a violation:

1. Confirm the codebase is clean: `npm run lint`
2. Add a deliberate violation to the scoped file
3. Run `npx eslint <file>` and verify the expected error message
4. Revert: `git checkout -- <file>`
