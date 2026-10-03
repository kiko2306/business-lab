/**
 * Touch targets on a phone, measured (plan.md §813.6, §824).
 *
 * The Users page measured every button <=31px and 87 checkboxes at 16px. The
 * rule is phone-only: a desktop pointer keeps today's density. A media query
 * cannot be flipped from inside Karma's one window, so the page's own
 * stylesheets are copied into a 390px and a 1280px iframe, where the query
 * evaluates for real.
 */
import { renderInFrame } from './testing/page-frame';

const MARKUP = `
  <button class="btn btn-primary" id="btn">Save</button>
  <button class="btn btn-outline-secondary btn-sm" id="btn-sm">Copy</button>
  <button class="btn btn-outline-danger btn-sm d-block" id="btn-block">Delete</button>
  <input class="form-control" id="field" />
  <input class="form-control form-control-sm" id="field-sm" />
  <div class="form-check" id="row">
    <input class="form-check-input" type="checkbox" id="box" />
    <label class="form-check-label" for="box" id="label">Admin</label>
  </div>
  <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="sw" /><label class="form-check-label" for="sw">On</label></div>`;

const render = (width: number) => renderInFrame(width, MARKUP);

const box = (doc: Document, id: string) => doc.getElementById(id)!.getBoundingClientRect();

describe('touch targets (plan.md §813.6)', () => {
  let frame: HTMLIFrameElement;
  afterEach(() => frame?.remove());

  describe('on a 390px phone', () => {
    let doc: Document;
    beforeEach(async () => ({ frame, doc } = await render(390)));

    for (const id of ['btn', 'btn-sm', 'btn-block']) {
      it(`makes #${id} at least 44px tall`, () => {
        expect(box(doc, id).height).toBeGreaterThanOrEqual(44);
      });
    }

    for (const id of ['field', 'field-sm']) {
      it(`makes the text field #${id} at least 44px tall`, () => {
        expect(box(doc, id).height).toBeGreaterThanOrEqual(44);
      });
    }

    it('keeps button text centred in the taller button', () => {
      const button = doc.getElementById('btn-sm')!;
      const range = doc.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      expect(Math.abs(text.top - b.top - (b.bottom - text.bottom))).toBeLessThan(3);
    });

    it('gives a checkbox a 44px row whose label toggles it, and a 24px box', () => {
      expect(box(doc, 'row').height).toBeGreaterThanOrEqual(44);
      const l = box(doc, 'label');
      const hit = doc.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
      expect(hit?.id).toBe('label');
      expect(l.height).toBeGreaterThanOrEqual(44);
      expect(box(doc, 'box').width).toBeGreaterThanOrEqual(24);
    });

    it('leaves a switch as it was', () => {
      expect(box(doc, 'sw').width).toBeGreaterThan(box(doc, 'sw').height);
    });
  });

  describe('on a 1280px desktop', () => {
    let doc: Document;
    beforeEach(async () => ({ frame, doc } = await render(1280)));

    it('keeps today\'s density: small buttons stay small, checkboxes stay 16px', () => {
      expect(box(doc, 'btn-sm').height).toBeLessThan(40);
      expect(box(doc, 'field-sm').height).toBeLessThan(40);
      expect(box(doc, 'box').width).toBeLessThanOrEqual(17);
    });
  });
});
