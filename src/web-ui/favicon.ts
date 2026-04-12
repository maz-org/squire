const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Squire">
  <rect x="4" y="4" width="56" height="56" rx="8" fill="#c73e1d" />
  <text
    x="32"
    y="44"
    text-anchor="middle"
    fill="#f5ebd9"
    font-family="Georgia, serif"
    font-size="42"
    font-weight="700"
  >
    S
  </text>
</svg>`;

export function getFaviconSvg(): string {
  return FAVICON_SVG;
}
