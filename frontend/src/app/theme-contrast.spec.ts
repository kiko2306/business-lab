/**
 * The theme's semantic classes, measured where the dashboard uses them.
 *
 * Bootstrap does not recolour outline buttons or `.text-success/-danger` per
 * colour mode, so a class that reads fine on white can be ~3:1 on the dark card
 * (found measuring Tally, plan.md §806.6, which shares this theme). The
 * dashboard uses these 100+ times and had no measurement. Computed colour over
 * the resolved painted background, both modes, on both surfaces it paints:
 * the page canvas and a card.
 */
function lum(colour: string): number {
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  const f = (c: number) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function painted(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
  }
  return 'rgb(255, 255, 255)';
}

// Every hue Bootstrap defines for each of the three utility families, not the
// handful the dashboard happens to use today. The first version listed what I
// had counted in the templates, and the next audit found `text-secondary` and
// `link-primary` — one use each, both ~3:1 in dark — because they were not on
// the list (plan.md §811). Enumerating the family is what stops a fourth audit
// finding a fourth class.
const HUES = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];
const CLASSES = [
  ...HUES.map((h) => `btn btn-sm btn-outline-${h}`),
  ...HUES.map((h) => `text-${h}`),
  ...HUES.map((h) => `link-${h}`),
];

describe('theme contrast on the dashboard (plan.md §807, §811)', () => {
  let host: HTMLElement;
  afterEach(() => {
    host?.remove();
    document.documentElement.removeAttribute('data-bs-theme');
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const surface of ['canvas', 'card'] as const) {
      it(`keeps the semantic classes readable on the ${surface} in ${theme} mode`, () => {
        document.documentElement.setAttribute('data-bs-theme', theme);
        host = document.createElement('div');
        host.innerHTML =
          surface === 'card'
            ? `<div class="card"><div class="card-body">${CLASSES.map((c) => (c.startsWith('link-') ? `<a href="#" class="${c}">x</a>` : `<span class="${c}">x</span>`)).join('')}</div></div>`
            : CLASSES.map((c) => (c.startsWith('link-') ? `<a href="#" class="${c}">x</a>` : `<span class="${c}">x</span>`)).join('');
        document.body.appendChild(host);

        const failures: string[] = [];
        for (const el of Array.from(host.querySelectorAll('span, a'))) {
          const r = ratio(getComputedStyle(el).color, painted(el));
          if (r < 4.5) failures.push(`${el.className} — ${r.toFixed(2)}:1`);
        }
        expect(failures).toEqual([]);
      });
    }
  }
});
