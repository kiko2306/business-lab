// Runs synchronously from <head>, before first paint, so a light-mode visitor
// never sees the dark default flash. An external file rather than an inline
// <script>: the CSP (nginx.conf) is script-src 'self'. An explicit choice made
// with the header toggle wins; otherwise follow the OS.
try {
  var t = localStorage.getItem('theme');
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-bs-theme', t);
} catch (e) {}
