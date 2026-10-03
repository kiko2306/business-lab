/**
 * Renders markup at a real viewport width, with the page's own stylesheets.
 *
 * A media query or a width-dependent layout cannot be flipped from inside
 * Karma's one window, so the page's stylesheets are copied into an iframe of
 * the wanted width, where they evaluate for real (plan.md §824, §832).
 */
function rulesOf(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules)
    .map((rule) => (rule instanceof CSSImportRule && rule.styleSheet ? rulesOf(rule.styleSheet) : rule.cssText))
    .join('\n');
}

export async function renderInFrame(width: number, markup: string): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
  const css = Array.from(document.styleSheets).map(rulesOf).join('\n');
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:700px;border:0;position:fixed;top:0;left:0`;
  frame.srcdoc = `<!doctype html><html data-bs-theme="light"><head><style>${css}</style></head><body>${markup}</body></html>`;
  await new Promise<void>((done) => {
    frame.onload = () => done();
    document.body.appendChild(frame);
  });
  return { frame, doc: frame.contentDocument! };
}
