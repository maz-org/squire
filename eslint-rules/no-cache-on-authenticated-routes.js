/**
 * Rule: no-cache-on-authenticated-routes
 *
 * Flags route handlers that use requireSession() middleware but don't
 * set Cache-Control: no-store in the handler body. Personalized content
 * behind auth must not be cached by proxies or CDNs.
 *
 * Found by: CodeRabbit review on PR #211. /auth/me returned per-user
 * PII with no cache directives.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Routes using requireSession() must set Cache-Control: no-store to prevent caching personalized content.',
    },
    messages: {
      missingCacheControl:
        "This route uses requireSession() but does not set Cache-Control: no-store. FIX: Add c.header('Cache-Control', 'no-store') and c.header('Vary', 'Cookie') at the top of the handler body, before returning the response. All authenticated routes return personalized content that proxies/CDNs must not cache.",
    },
    schema: [],
  },
  create(context) {
    // AST walk to find c.header('Cache-Control', 'no-store') calls.
    // Verifies both the header name AND the value, not just a string match.
    function checkForCacheControl(node, ctx) {
      const source = ctx.sourceCode.getText(node);
      // Quick pre-check to avoid expensive AST walk on nodes that clearly don't have it
      if (!source.includes('Cache-Control')) return false;

      let found = false;
      function visit(n) {
        if (found || !n || typeof n !== 'object') return;
        if (
          n.type === 'CallExpression' &&
          n.callee?.type === 'MemberExpression' &&
          n.callee?.property?.name === 'header' &&
          n.arguments?.length >= 2
        ) {
          const nameArg = n.arguments[0];
          const valueArg = n.arguments[1];
          if (
            nameArg?.type === 'Literal' &&
            nameArg?.value === 'Cache-Control' &&
            valueArg?.type === 'Literal' &&
            valueArg?.value === 'no-store'
          ) {
            found = true;
            return;
          }
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue;
          const child = n[key];
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child.type === 'string') visit(child);
        }
      }
      visit(node);
      return found;
    }

    return {
      CallExpression(node) {
        // Match: app.get('/path', requireSession(), async (c) => { ... })
        // or app.post, app.use, etc.
        if (node.callee.type !== 'MemberExpression' || node.callee.property.type !== 'Identifier') {
          return;
        }

        const method = node.callee.property.name;
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          return;
        }

        // Check if any argument is a call to requireSession()
        const hasRequireSession = node.arguments.some(
          (arg) =>
            arg.type === 'CallExpression' &&
            arg.callee.type === 'Identifier' &&
            arg.callee.name === 'requireSession',
        );

        if (!hasRequireSession) return;

        // Find the handler function (last argument that's a function)
        const handler = [...node.arguments]
          .reverse()
          .find(
            (arg) => arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression',
          );

        if (!handler || !handler.body) return;

        // AST walk: find c.header('Cache-Control', 'no-store') calls
        const hasCacheControl = checkForCacheControl(handler.body, context);

        if (!hasCacheControl) {
          context.report({
            node: node.arguments[0], // report on the route path
            messageId: 'missingCacheControl',
          });
        }
      },
    };
  },
};
