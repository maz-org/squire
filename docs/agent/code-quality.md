<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Code Quality

1. **Linting and Formatting**
   - Use standard linting and formatting configurations for the programming language
   - All lint errors and warnings must be eliminated before committing
   - Fix all errors/warnings, even if caused by previous work

2. **Document Design Choices**
   - When making a non-obvious design choice, document **why** in a code comment or markdown file — not just in PR descriptions or review replies
   - Future agents and humans reading the code won't see PR discussions; the rationale must live in the codebase
   - Examples: why a field defaults to 0 instead of null, why a particular data source is used, why an approach was chosen over alternatives

3. **Test Integrity**
   - All tests must pass before committing
   - Never delete tests to achieve 100% pass rate
   - Never ignore failing tests, regardless of origin
   - When fixing failing tests, reason about correctness:
     - Is the implementation wrong?
     - Is the test wrong?
   - Never change implementation just to make tests pass without proper analysis
