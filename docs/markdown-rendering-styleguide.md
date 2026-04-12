# Markdown Rendering Styleguide

Squire does **not** support arbitrary Markdown. It supports a deliberate,
security-bounded subset rendered through a reusable markdown surface.

This file is the human-readable contract for that subset.

If you change the renderer in
[src/web-ui/assistant-content.ts](../src/web-ui/assistant-content.ts)
or the answer styling in
[src/web-ui/styles.css](../src/web-ui/styles.css),
update this doc and the coverage in
[test/assistant-content.test.ts](../test/assistant-content.test.ts)
and
[test/web-ui-layout.test.ts](../test/web-ui-layout.test.ts).

## Shared DOM Contract

The reusable markdown surface is:

```html
<div class="squire-markdown">
  <!-- sanitized markdown HTML -->
</div>
```

Q&A answers layer answer-specific chrome on top of that:

```html
<article class="squire-turn squire-answer">
  <div class="squire-answer__content squire-markdown">
    <!-- sanitized markdown HTML -->
  </div>
</article>
```

That applies to:

- streamed-final answers after SSE `done`
- persisted current-conversation answers
- persisted selected prior answers

The point is simple: one answer artifact, not one polished streaming state and
two fallback-looking reload states.

Just as important: markdown typography stays reusable outside Q&A. Internal
pages like the styleguide should not inherit chat-only chrome such as the
recent-questions rail, consulted footer, input dock, or drop cap treatment.

## Supported Markdown Subset

- Paragraphs: render as `<p>` with Geist body copy, parchment text, and 1em
  paragraph rhythm.
- Headings: render as `<h1>` through `<h6>` in Fraunces with a restrained
  ledger hierarchy, not documentation-site chrome.
- Strong emphasis: render as `<strong>` with slightly heavier body emphasis,
  not a new color.
- Emphasis: render as `<em>` using the existing small-caps amber
  rule-term highlight.
- Unordered lists: render as `<ul><li>` with standard disc markers and
  tightened ledger spacing.
- Ordered lists: render as `<ol><li>` with decimal markers and the same list
  rhythm as unordered lists.
- Blockquotes: render as `<blockquote>` with a left rule and dimmer parchment
  text, still inside answer prose.
- Inline code: render as `<code>` with a compact monospace chip, subtle
  surface fill, and rule border.
- Fenced code blocks: render as `<pre><code>` with an inset panel, rounded
  corners, and horizontal scroll.
- Safe HTTPS links: render as `<a href="https://...">` with a sepia underline
  and wax hover/focus state.
- Tables: render as `<table>` inside a scroll wrapper with a bordered ledger
  treatment, header row, and horizontal scroll on narrow screens.
- Horizontal rules: render as a muted rule-line divider inside the answer
  flow.
- Allowlisted HTTPS images: render as `<img src="https://...">` only when the
  host is explicitly allowlisted for markdown images. Built-in defaults cover
  common community-hosted GH/FH assets on `raw.githubusercontent.com`,
  `any2cards.github.io`, `gloomhaven-secretariat.de`, and
  `us.gloomhaven-secretariat.de`, with lazy loading, rounded corners, and the
  existing ledger framing.

## Special-Case Content

- Inline citations (`.cite`): keep the same sepia-underlined family as links,
  but retain the richer tap-toggle behavior from the ledger answer design.
- Blockquote emphasis: quoted passages should wrap and read like quotations,
  not inherit the amber small-caps rule-term highlighter.
- First paragraph: stays eligible for the Fraunces wax-red drop cap only when
  a `.squire-answer .squire-markdown` surface itself starts with a paragraph,
  and that paragraph does not start with strong, emphasis, code, or link
  content.
- Tool status rows: not markdown. They live outside
  `.squire-answer__content` as transient streaming chrome.

## Unsupported Syntax

These constructs are intentionally outside the supported subset:

- raw HTML
- non-HTTPS links
- non-HTTPS images
- non-allowlisted HTTPS images

Unsupported syntax should stay inert. In practice that means:

- raw HTML is stripped
- unsafe links stay literal markdown text
- unsafe image markdown stays literal text instead of rendering an `<img>`

## Sample Reference

This is the specimen string the renderer and stylesheet should continue to
handle cleanly:

````md
# Heading one

Paragraph one with **strong** and _emphasis_.

## Heading two

- first
- second

1. ordered first
2. ordered second

> quoted

`inline`

```
block code
```

[safe link](https://example.com)

| Column A | Column B |
| :------- | -------: |
| Alpha    |        1 |
| Beta     |        2 |

---

![Worldhaven Frosthaven divider](https://any2cards.github.io/worldhaven/images/art/frosthaven/card-dividers/fh-available-pets.png)
````

## Design Intent

The renderer is not trying to look like generic Markdown documentation.
It should still feel like a Squire ledger answer:

- warm dark surface
- Fraunces hero and drop cap remain the signature moments
- Geist does the reading work
- emphasis is semantic, not decorative
- links and citations look intentional, not browser-default blue
- code styling stays quiet enough that rules answers still read like prose
  first
