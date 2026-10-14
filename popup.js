const DEFAULTS = { merge: true, hide: true, solo: true, patterns: '' };
const toggles = ['merge', 'hide', 'solo'].map((id) => document.getElementById(id));
const patterns = document.getElementById('patterns');
const errors = document.getElementById('errors');

function showErrors() {
  errors.replaceChildren(
    ...GCalUtilsCore.compilePatterns(patterns.value).errors.map(({ source, message }) => {
      const li = document.createElement('li');
      li.textContent = `${source}: ${message}`;
      return li;
    }),
  );
}

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const toggle of toggles) toggle.checked = settings[toggle.id];
  patterns.value = settings.patterns;
  showErrors();
});

for (const toggle of toggles) {
  toggle.addEventListener('change', () => chrome.storage.sync.set({ [toggle.id]: toggle.checked }));
}

let timer = null;
patterns.addEventListener('input', () => {
  showErrors();
  clearTimeout(timer);
  timer = setTimeout(() => chrome.storage.sync.set({ patterns: patterns.value }), 300);
});
