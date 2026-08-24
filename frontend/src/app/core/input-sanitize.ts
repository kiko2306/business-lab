export function sanitizePastedText(raw: string, maxLength: number, trim = true): string {
  const sanitized = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);

  return trim ? sanitized.trim() : sanitized;
}
