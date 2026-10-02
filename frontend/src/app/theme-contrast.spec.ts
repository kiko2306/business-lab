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

/**
 * Non-text contrast (WCAG 1.4.11): the edge of a control and its focus ring
 * have to read at 3:1 against what they sit on. Bootstrap's defaults do not on
 * this palette — an unchecked checkbox or an input measured 1.3–1.5:1 in dark
 * and light, the focus halo (a translucent 4px shadow) 1.3–2.2:1 — found by
 * measuring the Users page in a real render (plan.md §813.6). Measured here on
 * the page canvas and on a card, both modes, so the next control type added to
 * the list is held to the same line instead of waiting for a fourth audit.
 */
const CONTROLS: Record<string, string> = {
  'text input': '<input class="form-control" type="text">',
  'search input': '<input class="form-control form-control-sm" type="search">',
  select: '<select class="form-select"><option>a</option></select>',
  'unchecked checkbox': '<input class="form-check-input" type="checkbox">',
  'unchecked radio': '<input class="form-check-input" type="radio">',
};
const FOCUSABLE: Record<string, string> = {
  ...CONTROLS,
  'primary button': '<button class="btn btn-primary">x</button>',
  'danger button': '<button class="btn btn-danger">x</button>',
  'outline-secondary button': '<button class="btn btn-outline-secondary">x</button>',
  'outline-danger button': '<button class="btn btn-outline-danger">x</button>',
  link: '<a href="#" class="link-primary">x</a>',
};

describe('theme non-text contrast on the dashboard (plan.md §813.6)', () => {
  let host: HTMLElement;
  afterEach(() => {
    host?.remove();
    document.documentElement.removeAttribute('data-bs-theme');
  });

  const mount = (theme: 'light' | 'dark', surface: 'canvas' | 'card', markup: string) => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    host = document.createElement('div');
    host.innerHTML = surface === 'card' ? `<div class="card"><div class="card-body">${markup}</div></div>` : markup;
    document.body.appendChild(host);
  };

  for (const theme of ['light', 'dark'] as const) {
    for (const surface of ['canvas', 'card'] as const) {
      it(`draws control edges at 3:1 on the ${surface} in ${theme} mode`, () => {
        mount(theme, surface, Object.values(CONTROLS).join(''));
        const failures: string[] = [];
        const names = Object.keys(CONTROLS);
        Array.from(host.querySelectorAll('input, select')).forEach((el, i) => {
          const style = getComputedStyle(el);
          const edge = style.borderTopColor;
          const outside = ratio(edge, painted(el.parentElement!));
          // A checkbox's fill is its own background; an input's too.
          const inside = ratio(edge, style.backgroundColor);
          const worst = Math.min(outside, inside);
          if (worst < 3) failures.push(`${names[i]} — ${worst.toFixed(2)}:1`);
        });
        expect(failures).toEqual([]);
      });

      it(`draws a focus ring at 3:1 on the ${surface} in ${theme} mode`, () => {
        mount(theme, surface, Object.values(FOCUSABLE).join(''));
        const failures: string[] = [];
        const names = Object.keys(FOCUSABLE);
        Array.from(host.querySelectorAll('input, select, button, a')).forEach((el, i) => {
          (el as HTMLElement).focus();
          if (!el.matches(':focus-visible')) {
            failures.push(`${names[i]} — did not match :focus-visible, so the ring was not measured`);
            return;
          }
          const style = getComputedStyle(el);
          if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) < 2) {
            failures.push(`${names[i]} — no solid outline of 2px+ (${style.outlineStyle} ${style.outlineWidth})`);
            return;
          }
          const r = ratio(style.outlineColor, painted(el.parentElement!));
          if (r < 3) failures.push(`${names[i]} — outline ${r.toFixed(2)}:1`);
        });
        expect(failures).toEqual([]);
      });
    }
  }
});
