/** @type {import('tailwindcss').Config} */
// Tailwind v4 auto-detects content via @source in styles.css, but we keep
// an explicit config file for content globs and theme.extend.colors that
// reference the CSS custom properties defined in src/web-ui/styles.css.
// See docs/adr/0008-tailwind-cli-for-production-css.md and DESIGN.md.
export default {
  content: ['./src/web-ui/**/*.{tsx,ts,html}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        parchment: 'var(--parchment)',
        'parchment-dim': 'var(--parchment-dim)',
        sepia: 'var(--sepia)',
        'sepia-dim': 'var(--sepia-dim)',
        rule: 'var(--rule)',
        wax: 'var(--wax)',
        'wax-dim': 'var(--wax-dim)',
        sage: 'var(--sage)',
        amber: 'var(--amber)',
        error: 'var(--error)',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
      },
    },
  },
};
