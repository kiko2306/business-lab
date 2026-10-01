import { htmlLang, numberLocale } from './i18n';

// The native date input renders in the document's locale, so plain 'en' gave a
// Portuguese shop `mm/dd/yyyy` two lines under a `dd/MM/yyyy` business date
// (plan.md §806). en-IE is English with European dates and the euro.
describe('locale', () => {
  it('never resolves to a US English locale', () => {
    expect(htmlLang).not.toBe('en');
    expect(htmlLang).not.toBe('en-US');
    expect(numberLocale).not.toBe('en-US');
  });

  it('uses the same locale for the document as for Intl', () => {
    expect(htmlLang).toBe(numberLocale);
  });
});
