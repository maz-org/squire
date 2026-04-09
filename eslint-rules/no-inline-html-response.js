/**
 * Rule: no-inline-html-response
 *
 * Flags calls to c.html() where the argument is a template literal or
 * string literal (inline HTML) rather than a function call returning
 * HtmlEscapedString. All HTML rendering must go through the layout shell
 * or a dedicated page renderer to ensure design system compliance.
 *
 * Found by: SQR-38 design review. Auth error pages shipped with raw
 * inline HTML (system fonts, white background) outside DESIGN.md.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow inline HTML string/template arguments to c.html(). Use layout shell or page renderers.',
    },
    messages: {
      noInlineHtml:
        'Inline HTML string passed to c.html(). FIX: Create a renderer function in src/web-ui/ that calls layoutShell() from src/web-ui/layout.ts, then call that renderer here. All HTML must go through the layout shell to use the design system (DESIGN.md). See src/web-ui/auth-error-page.ts for an example.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Match: c.html(<something>) or any_var.html(<something>)
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'html'
        ) {
          return;
        }

        // Check the first argument
        const firstArg = node.arguments[0];
        if (!firstArg) return;

        // Flag template literals, string literals, and tagged templates (inline HTML).
        // html`<p>...</p>` is a TaggedTemplateExpression — still inline HTML.
        // Allow: function calls (renderAuthErrorPage, layoutShell, etc.)
        // Allow: await expressions wrapping function calls
        if (
          firstArg.type === 'TemplateLiteral' ||
          firstArg.type === 'Literal' ||
          firstArg.type === 'TaggedTemplateExpression'
        ) {
          context.report({ node: firstArg, messageId: 'noInlineHtml' });
        }
      },
    };
  },
};
