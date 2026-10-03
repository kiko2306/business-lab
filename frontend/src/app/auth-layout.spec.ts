import { renderInFrame } from './testing/page-frame';

// plan.md §827 fix 5: `.auth-page > .row { width: 100% }` cancelled the row's
// negative gutters, so the card sat 12px left of centre at 1280 and, at 390,
// the inputs were 36px from the left edge and 60px from the right. The markup
// below mirrors auth-shell.component.html; keep the two in step.
const MARKUP = `
  <main class="auth-page container py-5">
    <div class="row justify-content-center">
      <div class="col-12 col-md-9 col-lg-8 col-xl-7">
        <section class="card border-0 shadow auth-card" id="card"><div class="card-body p-4 p-lg-5">
          <input class="form-control" id="field" />
        </div></section>
      </div>
    </div>
  </main>`;

describe('the auth card is centred (plan.md §827)', () => {
  let frame: HTMLIFrameElement;
  afterEach(() => frame?.remove());

  for (const width of [390, 768, 1280, 1920]) {
    it(`has equal space either side at ${width}px`, async () => {
      let doc: Document;
      ({ frame, doc } = await renderInFrame(width, MARKUP));

      const card = doc.getElementById('card')!.getBoundingClientRect();
      const viewport = doc.documentElement.clientWidth;
      expect(Math.abs(card.left - (viewport - card.right))).toBeLessThanOrEqual(1);
    });
  }

  it('keeps the inputs equally far from both edges on a phone', async () => {
    let doc: Document;
    ({ frame, doc } = await renderInFrame(390, MARKUP));

    const field = doc.getElementById('field')!.getBoundingClientRect();
    expect(Math.abs(field.left - (doc.documentElement.clientWidth - field.right))).toBeLessThanOrEqual(1);
  });
});
