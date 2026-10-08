// Jasmine runs specs in random order, and TranslateService.setLocale persists the
// language to localStorage. A spec that switched to Portuguese left every later
// spec reading 'pt' (e.g. "Inicie primeiro authelia" where 'Start authelia first'
// was expected), so the suite failed on some seeds only. A top-level beforeEach
// applies to every spec in the run.
beforeEach(() => {
  localStorage.removeItem('locale');
});
