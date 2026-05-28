# Security Review: Squire Architecture

Conceptual red team review of the Squire agent-native architecture.
Performed 2026-03-29. Reconciled with SPEC v3.0 / ARCHITECTURE v1.0 on
2026-04-07 — issue references migrated from GitHub Issues to Linear
(see [SPEC.md](SPEC.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for the
authoritative product and tech specs).

## HIGH Risk

### 1. Prompt Injection via Knowledge Agent

The knowledge agent assembles context from multiple sources (rulebook
passages, card data, conversation history, campaign state) and sends it
to Claude. Every input path is a prompt injection surface.

**Attack scenarios:**

- User crafts a question that manipulates the system prompt ("ignore
  your instructions...")
- Conversation history injection — if raw history is passed to
  `/api/ask`, a user can embed messages that look like system
  instructions when concatenated
- Indirect injection via poisoned card data — possible if the GHS
  upstream repo is compromised
- Search result steering — crafted queries that surface specific
  passages to manipulate the LLM's context window

**Mitigations:**

- Clearly delimit user input vs system context in prompts (XML tags,
  not just prose boundaries)
- Persist generic assistant-visible failure turns instead of raw error
  text, and exclude those error turns from future history passed back
  into the model
- Never include the system prompt or tool schemas in LLM output
- Input length limits on questions and history
- Anomaly detection via LangSmith traces (e.g., responses that contain
  code, URLs, or instructions)
- Rate limit per-user to bound abuse

### 2. OAuth Implementation

The auth module is the entire trust boundary for external clients. It is
planned as a custom implementation inside the Hono server.

**Attack scenarios:**

- Dynamic client registration abuse — anyone can register, creating a
  DoS vector or enabling phishing (register a client named "Squire
  Official" with a malicious redirect URI)
- Redirect URI open redirector — if validation is loose (prefix match
  instead of exact), auth codes can be intercepted
- PKCE implementation flaws — if `code_verifier` is not validated
  against `code_challenge`, the flow is vulnerable to auth code
  interception
- Token theft — long-lived tokens stored unencrypted in Postgres
- Consent UI CSRF — attacker tricks user into authorizing a malicious
  client

**Mitigations:**

- Implement the MCP SDK's `OAuthServerProvider` interface (`SquireOAuthProvider`
  in `src/auth/provider.ts`) so the security-critical surface — PKCE rules,
  one-time auth-code semantics, OAuth 2.0 error shapes, exact-match
  redirect-URI checks, hashing-at-rest invariants — is the SDK's well-trodden
  contract rather than a hand-rolled state machine. The thin Hono adapter in
  `src/server.ts` only handles request parsing and JSON serialization. **The
  SDK's `mcpAuthRouter` Express helper was evaluated and rejected for
  architectural reasons, not security ones:** mounting it would force Squire
  to ship a second HTTP framework alongside Hono just to host four
  endpoints, an innovation-token cost the value (~80 lines of form parsing
  and error formatting) cannot justify. The valuable part of "use the SDK"
  is the provider contract, which we wrap directly. Tracking issue: SQR-69.
- Exact-match redirect URI validation, no wildcards
- For the web channel, local dev may derive the Google callback from the
  current `localhost` origin, but only for `localhost` / `127.0.0.1`;
  non-local hosts still use the configured redirect URI
- Rate limit client registration (10/hour per trusted client IP) through the
  Redis/Valkey-backed app limiter from SQR-52 / ADR 0018
- Rate limit Google OAuth web login initiation and callback routes
  (`/auth/google/start` at 10/minute and `/auth/google/callback` at 20/minute
  per trusted client IP) through the same Redis/Valkey-backed limiter; denials
  are structured logs, not `oauth_audit_log` rows
- **Long-lived access tokens (30-day default)** stored as SHA-256 hashes at rest.
  Long-lived tokens are a deliberate developer-experience choice for MCP and API
  clients — short-lived tokens with refresh rotation force every client (Claude
  Code, Claude Desktop, other agent harnesses) to implement refresh flows
  correctly and re-authenticate every 15 minutes, and any client whose OAuth SDK
  doesn't handle refresh cleanly produces 401s mid-session. Revisit if the threat
  model changes — multi-tenant deployment, compliance requirements, or detected
  abuse.
- Hash both `oauth_tokens` and `oauth_authorization_codes` at rest (SHA-256 hex
  as primary key — the raw secret is only ever in flight). This is stronger than
  reversible encryption: a DB read leak does not expose live bearer secrets.
- Enforce auth code expiry (~60s) on consumption (`WHERE expires_at > now()`).
- CSRF protection on the consent page (User Accounts project)
- Audit log auth lifecycle state changes (registrations, grants, token
  issuance, verifies, revocations) to the `oauth_audit_log` table. Operational
  denials such as rate-limit hits are structured security log events, not
  database audit rows.

### 3. Campaign Data Isolation (Horizontal Privilege Escalation)

With multiplayer campaigns, the system must prevent User A from accessing
User B's data.

**Attack scenarios:**

- User guesses/enumerates `campaignId` values in `/api/ask` requests to
  read other campaigns' state
- User accesses another player's private data (personal quest, battle
  goals — these are secret in Frosthaven)
- Even with proper API-level access control, the LLM might leak private
  data — if the knowledge agent loads all players' data into context,
  the LLM could mention another player's personal quest in a response
- A player mutates shared campaign state (prosperity, unlocked items)
  without authorization from the party

**Mitigations:**

- Verify campaign membership on every request via the player entity
- Scope the knowledge agent's context to only the requesting player's
  data + shared campaign state — never load other players' private
  fields
- Player-level permissions on campaign mutations (or require consensus)
- Audit logging for all campaign state changes
- Integration tests that verify data isolation (User A cannot see User
  B's personal quest)

### 4. Secrets Management

API keys and signing keys are high-value targets.

**Attack scenarios:**

- `ANTHROPIC_API_KEY` exposed via .env leak, server compromise, or
  accidental commit — grants full API access under the project's
  account
- OAuth signing keys compromised — attacker forges valid tokens, full
  account takeover for any user
- Postgres credentials in environment variables — database compromise
  leads to all user data
- LangSmith keys — expose all query/response traces and eval datasets

**Mitigations:**

- Verify .env is in .gitignore
- Use a secrets manager in production (not .env files)
- Separate keys for dev/staging/production
- Rotate API keys on a schedule
- OAuth signing keys encrypted at rest; consider HSM for production
- Least-privilege database credentials (read-only where possible)

## MEDIUM Risk

### 5. LLM Cost Exhaustion

`/api/ask` calls the Claude API on every request. An authenticated
attacker could run up significant costs.

**Attack scenarios:**

- Automated loop calling `/api/ask` with valid auth — each call costs
  embedding + Claude API
- Amplification via long conversation histories — passing large
  `history` arrays increases token consumption
- MCP tool abuse — `search_rules` triggers Voyage embedding per call,
  increasing provider spend

**Mitigations:**

- Redis/Valkey-backed app rate limits for interactive surfaces, with tighter
  limits on expensive routes such as `/api/ask`, `/mcp`, and
  `/api/search/rules`
- Daily cost budget with circuit breaker (reject requests when budget
  exceeded)
- Cap `history` array length in `/api/ask`
- Embedding result cache (same query leads to same embedding)
- Monitor API spend with alerts

### 6. MCP Bearer-Auth Boundary

The `/mcp` endpoint is a public agent-facing API surface protected by OAuth 2.1
bearer auth. Production traffic must pass the CloudFront origin lock before
reaching Fly, and requests pass through the Redis/Valkey-backed app limiter
before the Streamable HTTP transport starts.

**Attack scenarios:**

- A client obtains or steals a valid long-lived bearer token and calls MCP tools
- A direct-origin caller attempts to bypass CloudFront and WAF
- Invalid-token or unauthenticated floods can still hit the HTTP auth surface
- High-rate valid clients can create many MCP transports and tool calls
- Future campaign tools accidentally expose private campaign/player data through
  the same MCP transport

**Mitigations:**

- Keep `/mcp` behind bearer auth and the production origin lock
- Rate limit `/mcp` to 120 requests per minute per token user when present,
  otherwise per OAuth client id
- Rate limit unauthenticated or malformed `/mcp` requests by trusted client IP
  fallback, then by a shared `unknown` bucket
- Return HTTP 429 before the Streamable HTTP transport starts and emit
  structured, PII-safe rate-limit logs
- Hash bearer tokens at rest and audit token lifecycle events through the OAuth
  provider
- Keep local development on localhost unless deliberately testing the remote MCP
  transport
- Before adding campaign/player tools, design and test campaign data isolation
  first (see §3)

### 7. Web UI XSS via LLM Output

The web UI renders LLM responses with HTMX. If responses contain
HTML/JS and are rendered unsanitized, prompt injection becomes XSS.

**Current state (SQR-61 shipped):**

- HTML responses now carry a shared Content Security Policy:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' https://fonts.googleapis.com`
  - `img-src 'self' data: https:`
  - `connect-src 'self'`
  - `font-src 'self' https://fonts.gstatic.com`
  - `object-src 'none'`
  - `base-uri 'none'`
  - `frame-ancestors 'none'`
  - `form-action 'self'`
- Live assistant streaming stays plain text in the browser via `textContent`.
- Final assistant rendering is server-owned: the browser swaps in one sanitized
  HTML fragment only at SSE completion.
- Persisted assistant messages are re-rendered through the same shared
  sanitizing renderer on reload.
- Markdown images are not arbitrary remote fetches: the renderer only emits
  `<img>` tags for allowlisted HTTPS hosts tied to common GH/FH asset sources
  like `raw.githubusercontent.com`, `any2cards.github.io`, and the public
  Gloomhaven Secretariat hosts.
- Adversarial regression tests cover hostile `<script>`, `<img onerror>`,
  `javascript:` links, stored reloads, and streamed completion payloads.

**Attack scenarios:**

- Attacker crafts a prompt injection that causes the LLM to output
  `<script>` tags
- Stored XSS — if conversation history is persisted and re-rendered,
  malicious content in a previous response executes on reload
- Markdown rendering with embedded HTML

**Mitigations:**

- Escape all LLM output before rendering (treat as untrusted text, not
  HTML)
- Content Security Policy headers (no inline scripts)
- If rendering markdown, use a sanitizing renderer that strips HTML
  tags
- HttpOnly, Secure, SameSite=Lax cookies
- User-owned conversation lookups return indistinguishable `404`s, so a
  guessed conversation ID does not disclose whether the resource exists

**Residual risk / follow-up work:**

- The web UI still allows Google Fonts domains in CSP (`fonts.googleapis.com`,
  `fonts.gstatic.com`) rather than serving fonts from `self`.
- Safe markdown is preserved, so the sanitizing renderer remains a security
  boundary and must keep adversarial test coverage as it evolves.

### 8. Supply Chain / Data Pipeline

**Attack scenarios:**

- Compromised GHS repo injects malicious data into card imports
- Compromised npm dependency (Hono, MCP SDK, etc.) exfiltrates API keys
  or injects backdoors
- Poisoned vector store — if the `embeddings` pgvector table is
  tampered with (or the PDF reindex workflow is compromised),
  adversarial embeddings surface for targeted queries

**Mitigations:**

- Pin GHS to a specific commit, review diffs before updating
- npm audit + Dependabot (already configured)
- Dependency Review runs on pull requests via
  `.github/workflows/dependency-review.yml`. The workflow blocks
  high and critical runtime vulnerabilities introduced by dependency changes;
  low and moderate findings stay non-blocking until alert noise is better
  understood.
- Dependabot auto-triage uses GitHub's preset `Dismiss low impact issues for
development-scoped dependencies`. The repository is public, so GitHub enables
  this preset by default for npm development-scope alerts; do not add custom
  auto-dismiss rules for runtime dependencies unless repeated false positives
  justify a narrower follow-up rule. Review auto-dismissed Dependabot alerts in
  GitHub via **Security** -> **Dependabot** -> **Closed** -> **Closed as:
  Auto-dismissed**, or with:
  `gh api 'repos/maz-org/squire/dependabot/alerts?state=auto_dismissed&per_page=100'`.
- Security Alert Linear Sync runs daily and on manual dispatch via
  `.github/workflows/security-alert-linear-sync.yml`. It polls open
  Dependabot, CodeQL code scanning, and secret scanning alerts, routes
  high/critical findings into the Squire Linear security automation project,
  applies the Linear `Security` label, and de-duplicates issues with a stable
  `github-security:<repo>:<type>:<number>` marker in the issue body. Manual dry
  runs are available with `SECURITY_ALERT_DRY_RUN=1 npm run security:alerts:dry-run`;
  validate the Linear key, team, project, and label without creating issues via
  `npm run security:alerts:validate-config`. Live writes require `LINEAR_API_KEY`,
  and the workflow uses read-only `GITHUB_TOKEN` permissions for repository
  metadata, CodeQL, and Dependabot alerts. Secret scanning alert reads require
  a `SECURITY_ALERTS_GITHUB_TOKEN` secret from a GitHub App or personal access
  token with secret-scanning alert read access.
- CodeQL code scanning runs on PRs, `main`, and a weekly schedule via
  `.github/workflows/codeql.yml` for JavaScript/TypeScript and GitHub Actions
  workflow analysis. The repository is public, so GitHub Copilot Autofix for
  supported CodeQL alerts is plan-eligible; verify the repo/org setting after
  the first CodeQL alerts exist.
- Integrity checksums on extracted data and on the `embeddings` pgvector
  table contents (or on canonical reindex artifacts)
- Do not run the extraction pipeline in production — import
  pre-verified data

### 9. Denial of Service

**Attack scenarios:**

- Flood `/api/search/rules` — each request runs Voyage embedding
  (provider-bound)
- Flood `/mcp` with a valid bearer token — each request creates a new McpServer + transport
  (memory-bound)
- Large `topK` values (capped at 100, but 100 results times concurrent
  requests strains memory)
- `list_cards` with no filter returns all records of a type

**Mitigations:**

- Redis/Valkey-backed app rate limits per trusted IP, OAuth client, and token
  user where available
- Connection limits
- Response size limits
- Consider caching for embeddings and frequent queries
- Move MCP to stateful mode to reuse server instances

## LOW Risk

### 10. Information Disclosure

- `/api/health` reveals coarse dependency readiness (`db`, `vector`, `embedder`)
- MCP server reports `name: 'squire', version: '0.1.0'`
  (fingerprinting)
- `/api/card-types` reveals the data schema (game data, not sensitive)
- LangSmith traces could be exposed if misconfigured

**Mitigations:**

- Restrict LangSmith access
- Do not expose stack traces in production (already handled by global
  error handler)
- Consider stripping version from MCP server info in production

## Priority Recommendations

1. Keep CodeQL code scanning healthy: confirm the first default-branch run
   succeeds, verify Copilot Autofix availability for supported alerts, and keep
   alert triage flowing into Linear
2. Design campaign data isolation before building campaign state — the
   player entity must enforce access boundaries, and the knowledge
   agent must scope its context to prevent LLM-mediated data leaks
3. Keep expanding the Redis/Valkey-backed app limiter from SQR-52 across the
   remaining interactive surfaces; WAF remains the coarse outer layer
4. Establish a prompt injection test suite — adversarial test cases in
   the E2E suite that try to extract the system prompt, manipulate
   responses, or cause the LLM to output HTML

## Changelog

- **2026-05-19:** Replaced stale pre-auth `/mcp` wording with the current
  bearer-auth and origin-lock boundary (SQR-87).
- **2026-05-17:** Recorded Dependabot auto-triage preset behavior and review
  path for low-impact development dependency alerts (SQR-168).
- **2026-05-17:** Clarified that app rate limits use Redis/Valkey token
  buckets and structured denial logs rather than `oauth_audit_log` rows
  (SQR-52, ADR 0018).
- **2026-05-16:** Added GitHub security alert routing into Linear for high/critical Dependabot, CodeQL, and secret scanning alerts (SQR-167).
- **2026-05-16:** Added Dependency Review PR workflow to block high/critical runtime vulnerability introductions (SQR-165).
- **2026-05-16:** Added CodeQL code scanning workflow and noted Copilot Autofix eligibility/verification path (SQR-164).
- **2026-04-07:** Reconciled with SPEC v3.0 / ARCHITECTURE v1.0 split. Migrated GitHub Issue references (#12, #55–#59) to Linear projects (User Accounts SQR-37/38/39/40, Security Hardening). Added header note pointing at the new product and tech specs.
- **2026-04-07:** Renamed from `docs/security-review.md` to `docs/SECURITY.md` as part of the ALL_CAPS docs consolidation.
- **2026-04-06:** Updated to reflect retirement of OCR pipeline and Worldhaven dependency (commit `34a26a1`).
- **2026-03-29:** Initial security review added alongside the Postgres storage model (PR #121).
