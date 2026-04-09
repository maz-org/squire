import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-inline-html-response.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

ruleTester.run('no-inline-html-response', rule, {
  valid: [
    // Function call result — allowed (e.g. renderAuthErrorPage())
    { code: 'c.html(renderAuthErrorPage({ message: "oops" }))' },
    // Await expression wrapping a function call — allowed
    { code: 'c.html(await renderHomePage({ session }))' },
    // Variable reference — allowed (pre-rendered HTML)
    { code: 'c.html(cachedPage)' },
    // Not a .html() call at all
    { code: 'c.json({ ok: true })' },
  ],
  invalid: [
    // Template literal — inline HTML
    {
      code: 'c.html(`<h1>Hello</h1>`)',
      errors: [{ messageId: 'noInlineHtml' }],
    },
    // String literal — inline HTML
    {
      code: 'c.html("<p>Error</p>")',
      errors: [{ messageId: 'noInlineHtml' }],
    },
    // Tagged template expression — still inline HTML (e.g. html`<p>...</p>`)
    {
      code: 'c.html(html`<div>Styled</div>`)',
      errors: [{ messageId: 'noInlineHtml' }],
    },
  ],
});
