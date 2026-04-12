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

// Built-in hosts are limited to common Gloomhaven/Frosthaven asset sources we
// observed in the wild.
const DEFAULT_ALLOWED_MARKDOWN_IMAGE_HOSTS = [
  'raw.githubusercontent.com',
  'any2cards.github.io',
  'gloomhaven-secretariat.de',
  'us.gloomhaven-secretariat.de',
] as const;

markdown.validateLink = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

function getAllowedMarkdownImageHosts(): Set<string> {
  const raw = process.env.SQUIRE_ALLOWED_MARKDOWN_IMAGE_HOSTS;
  const hosts = raw
    ? raw
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean)
    : [...DEFAULT_ALLOWED_MARKDOWN_IMAGE_HOSTS];

  return new Set(hosts);
}

function isAllowedMarkdownImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      getAllowedMarkdownImageHosts().has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function tableAlignmentClass(style: string | null | undefined): string | null {
  switch (style?.trim().toLowerCase()) {
    case 'text-align:left':
      return 'squire-markdown__align-left';
    case 'text-align:center':
      return 'squire-markdown__align-center';
    case 'text-align:right':
      return 'squire-markdown__align-right';
    default:
      return null;
  }
}

function stripInlineStyleAttr(token: Token): void {
  if (!token.attrs) return;
  token.attrs = token.attrs.filter(([name]) => name !== 'style');
  if (token.attrs.length === 0) {
    token.attrs = null;
  }
}

function appendTokenClass(token: Token, className: string): void {
  const existing = token.attrGet('class');
  token.attrSet('class', existing ? `${existing} ${className}` : className);
}

function renderAlignedTableCell(tagName: 'th' | 'td', tokens: Token[], idx: number): string {
  const token = tokens[idx];
  if (!token) return `<${tagName}>`;

  const alignmentClass = tableAlignmentClass(token.attrGet('style'));
  if (alignmentClass) {
    stripInlineStyleAttr(token);
    appendTokenClass(token, alignmentClass);
  }

  return `<${tagName}${markdown.renderer.renderAttrs(token)}>`;
}

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

markdown.renderer.rules.th_open = (tokens: Token[], idx: number) =>
  renderAlignedTableCell('th', tokens, idx);

markdown.renderer.rules.td_open = (tokens: Token[], idx: number) =>
  renderAlignedTableCell('td', tokens, idx);

markdown.renderer.rules.image = (tokens: Token[], idx: number) => {
  const token = tokens[idx];
  const src = token?.attrGet('src');
  if (!src || !isAllowedMarkdownImageUrl(src)) {
    return markdown.utils.escapeHtml(`![${token?.content ?? ''}](${src ?? ''})`);
  }

  const alt = markdown.utils.escapeHtml(token?.content ?? '');
  const title = token?.attrGet('title');
  const titleAttr = title ? ` title="${markdown.utils.escapeHtml(title)}"` : '';

  return `<img src="${markdown.utils.escapeHtml(src)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
};

export function renderAssistantContentHtml(content: string): string {
  return markdown.render(content);
}

export function renderAssistantContent(content: string): HtmlEscapedString {
  return raw(renderAssistantContentHtml(content)) as HtmlEscapedString;
}
