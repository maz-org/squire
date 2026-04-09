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

        if (!handler || !handler.body || handler.body.type !== 'BlockStatement') return;

        // Check if the handler body contains c.header('Cache-Control', ...)
        const source = context.sourceCode.getText(handler.body);
        const hasCacheControl =
          source.includes("'Cache-Control'") || source.includes('"Cache-Control"');

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
