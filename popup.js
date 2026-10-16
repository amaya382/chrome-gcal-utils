const DEFAULTS = {
  merge: true,
  hide: true,
  solo: true,
  patterns: '',
  priority: '',
  fold: true,
  earlyEnd: 8,
  lateStart: 20,
};
const toggles = ['merge', 'hide', 'solo', 'fold'].map((id) => document.getElementById(id));
const hours = ['earlyEnd', 'lateStart'].map((id) => document.getElementById(id));
const patterns = document.getElementById('patterns');
const priority = document.getElementById('priority');
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
  priority.value = settings.priority;
  for (const input of hours) input.value = settings[input.id];
  showErrors();
});

for (const toggle of toggles) {
  toggle.addEventListener('change', () => chrome.storage.sync.set({ [toggle.id]: toggle.checked }));
}

for (const input of hours) {
  input.addEventListener('change', () => {
    const hour = Math.min(24, Math.max(0, Math.round(Number(input.value) || 0)));
    input.value = hour;
    chrome.storage.sync.set({ [input.id]: hour });
  });
}

function saveOnInput(textarea, onInput = () => {}) {
  let timer = null;
  textarea.addEventListener('input', () => {
    onInput();
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.sync.set({ [textarea.id]: textarea.value }), 300);
  });
}

saveOnInput(patterns, showErrors);
saveOnInput(priority);
