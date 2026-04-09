<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Code Quality

1. **Linting and Formatting**
   - Use standard linting and formatting configurations for the programming language
   - All lint errors and warnings must be eliminated before committing
   - Fix all errors/warnings, even if caused by previous work
   - Linters in this repo: **eslint** (TS/JS, `npm run lint`), **stylelint**
     (CSS, `npm run lint:css` — `stylelint-config-standard` tuned for Tailwind
     v4 at-rules in `.stylelintrc.json`), **markdownlint-cli2** (Markdown,
     `npm run lint:md`), **prettier** (formatting, `npm run format:check`).
     All four run in CI and via `lint-staged` on pre-commit. CodeRabbit is
     configured to defer to stylelint for CSS findings (see `.coderabbit.yaml`)
     — CI is the single source of truth for CSS style.
   - **Custom layering rules** enforce the application architecture at lint time.
     See [lint-rules.md](lint-rules.md) for the 6 rules that prevent views from
     importing auth modules, repositories from leaking row types, inline HTML
     from bypassing the design system, and authenticated routes from missing
     cache headers. Error messages include `FIX:` instructions so agents can
     self-correct.

2. **Document Design Choices**
   - When making a non-obvious design choice, document **why** in a code comment or markdown file — not just in PR descriptions or review replies
   - Future agents and humans reading the code won't see PR discussions; the rationale must live in the codebase
   - Examples: why a field defaults to 0 instead of null, why a particular data source is used, why an approach was chosen over alternatives

3. **Boy Scout Rule**
   - Leave the code in a better state than you found it ([Robert C. Martin](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html))
   - When you touch a file, small opportunistic cleanups are welcome: a clearer name, a dead import removed, a misleading comment fixed
   - Keep cleanups in scope — don't snowball a bug fix into a refactor. If the cleanup is bigger than the change that brought you there, open a separate PR

4. **Test Integrity**
   - All tests must pass before committing
   - Never delete tests to achieve 100% pass rate
   - Never ignore failing tests, regardless of origin
   - When fixing failing tests, reason about correctness:
     - Is the implementation wrong?
     - Is the test wrong?
   - Never change implementation just to make tests pass without proper analysis
