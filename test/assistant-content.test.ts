import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  renderAssistantContent,
  renderAssistantContentHtml,
} from '../src/web-ui/assistant-content.ts';

const adversarialCases = JSON.parse(
  readFileSync(new URL('./fixtures/xss-prompts.json', import.meta.url), 'utf8'),
) as Array<{ name: string; input: string }>;

const supportedMarkdownSample = [
  '# Heading one',
  '',
  'Paragraph one with **strong** and *emphasis*.',
  '',
  '## Heading two',
  '',
  '- first',
  '- second',
  '',
  '1. ordered first',
  '2. ordered second',
  '',
  '> quoted',
  '',
  '`inline`',
  '',
  '```',
  'block code',
  '```',
  '',
  '[safe link](https://example.com)',
  '',
  '| Column A | Column B |',
  '| :-- | --: |',
  '| Alpha | 1 |',
  '| Beta | 2 |',
  '',
  '---',
  '',
  '![Styleguide reference image](https://placehold.co/640x360/png?text=Squire+Markdown+Image)',
].join('\n');

describe('assistant content renderer', () => {
  it.each(adversarialCases)('strips executable content from $name', ({ input }) => {
    const html = renderAssistantContentHtml(input).toLowerCase();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<meta');
    expect(html).not.toContain('<form');
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:text/html');
    expect(html).not.toContain('style="');
  });

  it('preserves the allowed markdown subset', () => {
    const html = renderAssistantContentHtml(supportedMarkdownSample);

    expect(html).toContain('<h1>Heading one</h1>');
    expect(html).toContain(
      '<p>Paragraph one with <strong>strong</strong> and <em>emphasis</em>.</p>',
    );
    expect(html).toContain('<h2>Heading two</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>ordered first</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<pre><code>block code');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">safe link</a>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:left">Column A</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain('<hr>');
    expect(html).toContain(
      '<img src="https://placehold.co/640x360/png?text=Squire+Markdown+Image" alt="Styleguide reference image" loading="lazy" decoding="async" referrerpolicy="no-referrer">',
    );
  });

  it('treats unsupported markdown syntax as inert text instead of rich HTML', () => {
    const html = renderAssistantContentHtml(
      [
        '<script>alert("nope")</script>',
        '',
        '[unsafe link](http://example.com)',
        '',
        '![alt](http://example.com/image.png)',
      ].join('\n'),
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<a href="http://example.com"');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(&quot;nope&quot;)&lt;/script&gt;');
    expect(html).toContain('[unsafe link](http://example.com)');
    expect(html).toContain('![alt](http://example.com/image.png)');
  });

  it('renders unsafe markdown links as inert literal text without a dangling closing tag', () => {
    const html = renderAssistantContentHtml('[click](javascript:alert(1))');
    expect(html).toBe('<p>[click](javascript:alert(1))</p>\n');
    expect(html).not.toContain('</a>');
  });

  it('returns a trusted fragment for Hono templates', () => {
    const html = String(renderAssistantContent('**Bold** answer.'));
    expect(html).toContain('<p><strong>Bold</strong> answer.</p>');
  });
});
