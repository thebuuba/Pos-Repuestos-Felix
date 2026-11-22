// Runs in the document head, before styles or React paint the first screen.
(() => {
  let theme = 'light';
  try { if (localStorage.getItem('felix-theme') === 'dark') theme = 'dark'; } catch { /* Storage may be unavailable. */ }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
})();
