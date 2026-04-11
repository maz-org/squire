import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
});

markdown.disable(['image', 'heading', 'lheading', 'table', 'hr']);

markdown.validateLink = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

markdown.renderer.rules.code_inline = (tokens: Token[], idx: number) =>
  `<code>${markdown.utils.escapeHtml(tokens[idx]?.content ?? '')}</code>`;

markdown.renderer.rules.fence = (tokens: Token[], idx: number) =>
  `<pre><code>${markdown.utils.escapeHtml(tokens[idx]?.content ?? '')}</code></pre>`;

markdown.renderer.rules.link_open = (tokens: Token[], idx: number) => {
  const href = tokens[idx]?.attrGet('href');
  if (!href || !markdown.validateLink(href)) {
    if (tokens[idx]) {
      tokens[idx].meta = { ...(tokens[idx].meta ?? {}), suppressed: true };
    }
    for (let closeIdx = idx + 1; closeIdx < tokens.length; closeIdx += 1) {
      if (
        tokens[closeIdx]?.type === 'link_close' &&
        tokens[closeIdx]?.level === tokens[idx]?.level
      ) {
        tokens[closeIdx].meta = { ...(tokens[closeIdx].meta ?? {}), suppressed: true };
        break;
      }
    }
    return '';
  }
  return `<a href="${markdown.utils.escapeHtml(href)}" rel="noopener noreferrer">`;
};

markdown.renderer.rules.link_close = (tokens: Token[], idx: number) =>
  tokens[idx]?.meta?.suppressed ? '' : '</a>';

export function renderAssistantContentHtml(content: string): string {
  return markdown.render(content);
}

export function renderAssistantContent(content: string): HtmlEscapedString {
  return raw(renderAssistantContentHtml(content)) as HtmlEscapedString;
}
