const browserApi = globalThis.browser || globalThis.chrome;
const storage = {
  async get(defaults) {
    const result = browserApi.storage.local.get(defaults);
    return result && typeof result.then === 'function' ? result : new Promise(resolve => browserApi.storage.local.get(defaults, resolve));
  },
  async set(values) {
    const result = browserApi.storage.local.set(values);
    return result && typeof result.then === 'function' ? result : new Promise(resolve => browserApi.storage.local.set(values, resolve));
  }
};

const COLORS = [
  { id: 'red', cssColor: '#e34b4b', symbol: '●' }, { id: 'blue', cssColor: '#3578d4', symbol: '◆' },
  { id: 'green', cssColor: '#2ba66a', symbol: '▲' }, { id: 'yellow', cssColor: '#d89d09', symbol: '■' },
  { id: 'purple', cssColor: '#8e58bb', symbol: '✦' }, { id: 'pink', cssColor: '#db5d94', symbol: '♥' },
  { id: 'orange', cssColor: '#ed7c2e', symbol: '●' }, { id: 'teal', cssColor: '#159eae', symbol: '✚' }
];
const ENDLESS_CYCLE_MS = 20000;
const ENDLESS_PROGRESS_COLORS = [['#635bff', '#8b82ff'], ['#db5d94', '#f08ab5'], ['#3578d4', '#6ca3ec'], ['#2ba66a', '#62c992'], ['#ed7c2e', '#f4a467']];
const FINISH_LABELS = { en: 'Finish game', fa: 'پایان بازی', ar: 'إنهاء اللعبة', es: 'Terminar juego', fr: 'Terminer la partie', de: 'Spiel beenden', tr: 'Oyunu bitir', sv: 'Avsluta spelet', et: 'Lõpeta mäng', ja: 'ゲームを終了', ko: '게임 종료', zh: '结束游戏', it: 'Termina partita' };
let strings = {}, settings = { language: 'en', sound: true, accessibility: false, bestScore: 0, accuracyRecord: 0 };
let mode = 'classic', game = null, animation = null, currentView = 'setupView', settingsReturnView = 'setupView';
let nextRoundTimer = null, nextRoundDueAt = 0, pausedNextRoundDelay = null;
let vazirFontReady;
function ensureVazirFont() {
  if (!vazirFontReady) {
    const face = new FontFace('Vazirmatn', 'url("font/Vazirmatn.woff2") format("woff2")', { weight: '400', style: 'normal' });
    vazirFontReady = face.load().then(font => { document.fonts.add(font); return font; });
  }
  return vazirFontReady;
}
const $ = id => document.getElementById(id);
const t = (key, fallback = key) => strings[key]?.message || fallback;
const pick = list => list[Math.floor(Math.random() * list.length)];

let languageRequest = 0;
async function loadLanguage(language) {
  const request = ++languageRequest;
  const response = await fetch(`locales/${language}/messages.json`);
  const translations = await response.json();
  if (request !== languageRequest) return;
  const useVazir = ['fa', 'ar'].includes(language);
  document.documentElement.lang = language; document.documentElement.classList.toggle('fa-font', useVazir);
  document.body.style.setProperty('font-family', useVazir ? "'Vazirmatn', sans-serif" : '', 'important');
  if (useVazir) await ensureVazirFont().catch(() => { });
  if (request !== languageRequest) return;
  document.querySelectorAll('#settingsView, #settingsView *').forEach(node => node.style.setProperty('font-family', useVazir ? "'Vazirmatn', sans-serif" : '', 'important'));
  strings = translations;
  document.title = t('appName', 'Color Snap');
  const rtl = ['fa', 'ar'].includes(language); document.documentElement.dir = rtl ? 'rtl' : 'ltr'; $('settingsView').dir = rtl ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n, node.textContent); });
  $('endEndlessButton').textContent = FINISH_LABELS[language] || FINISH_LABELS.en;
  $('settingsButton').setAttribute('aria-label', t('settings')); $('settingsButton').title = t('settings');
  document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
  $('language').value = language; $('bestScore').textContent = settings.bestScore;
  refreshGameLanguage();
}
function formatSeconds(value) { return `${value} ${t('secondsUnit')}`; }
function refreshGameLanguage() {
  if (!game) return;
  $('word').textContent = t(`color.${game.word.id}`, game.word.id);
  $('assistLabel').textContent = settings.accessibility ? `${game.ink.symbol} ${t('chooseInk')}` : '';
  document.querySelectorAll('.answer').forEach(button => {
    const label = t(`color.${button.dataset.color}`, button.dataset.color);
    button.lastElementChild.textContent = label;
    button.setAttribute('aria-label', label);
  });
  if ($('feedback').textContent) {
    $('feedback').textContent = $('feedback').classList.contains('good') ? t('correctFeedback') : `${t('wrongFeedback')} ${t(`color.${game.ink.id}`)}`;
  }
  if (mode === 'endless') {
    const now = game.paused ? game.pausedAt : performance.now();
    $('timer').textContent = formatSeconds(Math.floor((now - game.startedAt) / 1000));
  }
  if (!game.active) {
    $('resultTitle').textContent = game.score > game.startedBest ? t('newBest') : t('roundDone');
    $('averageTime').textContent = game.responseTimes.length ? formatSeconds((game.responseTimes.reduce((a, b) => a + b, 0) / game.responseTimes.length / 1000).toFixed(2)) : '—';
  }
}
function show(view) {
  currentView = view;
  document.querySelector('.app').classList.toggle('endless-game', view === 'gameView' && mode === 'endless');
  ['setupView', 'gameView', 'resultView', 'settingsView'].forEach(id => $(id).classList.toggle('hidden', id !== view));
}
function playTone(ok) { if (!settings.sound) return; try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.frequency.value = ok ? 660 : 180; gain.gain.setValueAtTime(.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .12); osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .12); } catch (_) { } }

function clearNextRoundTimer() {
  if (nextRoundTimer !== null) clearTimeout(nextRoundTimer);
  nextRoundTimer = null;
  nextRoundDueAt = 0;
}
function scheduleNextRound(delay) {
  clearNextRoundTimer();
  nextRoundDueAt = performance.now() + delay;
  nextRoundTimer = setTimeout(() => {
    nextRoundTimer = null;
    nextRoundDueAt = 0;
    nextRound();
  }, delay);
}
function pauseGame() {
  if (!game?.active || game.paused) return;
  game.paused = true;
  game.pausedAt = performance.now();
  cancelAnimationFrame(animation);
  if (nextRoundTimer !== null) {
    pausedNextRoundDelay = Math.max(0, nextRoundDueAt - game.pausedAt);
    clearNextRoundTimer();
  }
}
function resumeGame() {
  if (!game?.active || !game.paused) return;
  const pausedFor = performance.now() - game.pausedAt;
  game.startedAt += pausedFor;
  game.roundStarted += pausedFor;
  if (Number.isFinite(game.endsAt)) game.endsAt += pausedFor;
  game.paused = false;
  game.pausedAt = 0;
  if (pausedNextRoundDelay !== null) {
    const delay = pausedNextRoundDelay;
    pausedNextRoundDelay = null;
    scheduleNextRound(delay);
  }
  tick();
}
function openSettings() {
  settingsReturnView = currentView === 'settingsView' ? 'setupView' : currentView;
  if (settingsReturnView === 'gameView') pauseGame();
  show('settingsView');
}
function closeSettings() {
  const returnView = settingsReturnView;
  show(returnView);
  if (returnView === 'gameView') resumeGame();
}

function startGame() {
  cancelAnimationFrame(animation); clearNextRoundTimer(); pausedNextRoundDelay = null; game = { score: 0, correct: 0, wrong: 0, combo: 0, responseTimes: [], round: 0, active: true, paused: false, pausedAt: 0, startedBest: settings.bestScore, startedAt: performance.now(), endsAt: mode === 'classic' ? performance.now() + 30000 : Infinity, roundStarted: 0, progressCycle: -1 };
  $('score').textContent = '0'; $('combo').textContent = '×0'; $('timer').textContent = mode === 'classic' ? '30.0' : '∞'; $('progressBar').style.width = '100%'; $('progressBar').style.background = mode === 'classic' ? '' : $('progressBar').style.background; $('feedback').textContent = ''; $('endEndlessButton').classList.toggle('hidden', mode !== 'endless'); show('gameView'); nextRound(); tick();
}
function endEndlessGame() {
  if (mode !== 'endless' || !game?.active) return;
  game.active = false;
  cancelAnimationFrame(animation);
  clearNextRoundTimer();
  pausedNextRoundDelay = null;
  const total = game.correct + game.wrong;
  const accuracy = total ? Math.round(game.correct / total * 100) : 0;
  settings.accuracyRecord = Math.max(settings.accuracyRecord, accuracy);
  storage.set({ bestScore: settings.bestScore, accuracyRecord: settings.accuracyRecord });
  $('bestScore').textContent = settings.bestScore;
  show('setupView');
}
function nextRound() {
  if (!game?.active) return;
  game.round++; const word = pick(COLORS); let ink = pick(COLORS);
  if (game.round > 2 && Math.random() < .82) while (ink.id === word.id) ink = pick(COLORS);
  game.word = word; game.ink = ink; game.roundStarted = performance.now(); if (mode === "endless") { const colors = ENDLESS_PROGRESS_COLORS[(game.round - 1) % ENDLESS_PROGRESS_COLORS.length]; const progressBar = document.getElementById("progressBar"); progressBar.style.width = "100%"; progressBar.style.background = "linear-gradient(90deg," + colors[0] + "," + colors[1] + ")"; } game.roundLimit = Math.max(900, 3000 - (game.round - 1) * 95); game.locked = false;
  $('word').textContent = t(`color.${word.id}`, word.id); $('word').style.color = ink.cssColor;
  $('assistLabel').textContent = settings.accessibility ? `${ink.symbol} ${t('chooseInk')}` : '';
  $('feedback').textContent = ''; $('feedback').className = 'feedback'; renderAnswers();
}
function renderAnswers() {
  const answers = $('answers'); answers.innerHTML = '';
  [...COLORS].sort(() => Math.random() - .5).forEach(color => {
    const button = document.createElement('button'); button.className = 'answer'; button.dataset.color = color.id;
    button.innerHTML = `${settings.accessibility ? `<span class="symbol">${color.symbol}</span>` : `<i class="swatch" style="background:${color.cssColor}"></i>`}<span>${t(`color.${color.id}`, color.id)}</span>`;
    button.setAttribute('aria-label', t(`color.${color.id}`, color.id)); button.addEventListener('click', () => answer(color.id, button)); answers.append(button);
  });
}
function answer(id, button) {
  if (!game?.active || game.locked) return; const correct = id === game.ink.id; if (!correct && mode === 'endless') { game.wrong++; game.combo = 0; button.disabled = true; button.classList.add('wrong'); document.getElementById('feedback').textContent = t('wrongFeedback') + ' ' + t('color.' + game.ink.id); document.getElementById('feedback').className = 'feedback bad'; document.getElementById('combo').textContent = '×0'; playTone(false); return; } game.locked = true; const elapsed = performance.now() - game.roundStarted; game.responseTimes.push(elapsed);
  [...document.querySelectorAll('.answer')].forEach(b => b.disabled = true);
  if (correct) {
    game.correct++; game.combo++; game.score += 10 + Math.min(40, game.combo * 2);
    if (game.score > settings.bestScore) {
      settings.bestScore = game.score;
      $('bestScore').textContent = settings.bestScore;
      storage.set({ bestScore: settings.bestScore });
    }
    button.classList.add('correct'); $('feedback').textContent = t('correctFeedback'); $('feedback').className = 'feedback good';
  }
  else { game.wrong++; game.combo = 0; button.classList.add("wrong"); const actual = [...document.querySelectorAll(".answer")].find(item => item.dataset.color === game.ink.id); actual?.classList.add("correct"); document.getElementById("feedback").textContent = t("wrongFeedback") + " " + t("color." + game.ink.id); document.getElementById("feedback").className = "feedback bad"; }
  $('score').textContent = game.score; $('combo').textContent = `×${game.combo}`; playTone(correct); scheduleNextRound(correct ? 420 : 850);
}
function tick() {
  if (!game?.active || game.paused) return; const now = performance.now();
  if (mode === 'classic') { const remaining = Math.max(0, game.endsAt - now); $('timer').textContent = (remaining / 1000).toFixed(1); $('progressBar').style.width = `${remaining / 300}%`; if (remaining <= 0) return finishGame(); }
  else { const elapsed = now - game.startedAt, seconds = Math.floor(elapsed / 1000), roundProgress = Math.min(1, (now - game.roundStarted) / ENDLESS_CYCLE_MS); document.getElementById("timer").textContent = formatSeconds(seconds); document.getElementById("progressBar").style.width = String((1 - roundProgress) * 100) + "%"; }
  if (mode === 'endless' && !game.locked && now - game.roundStarted >= ENDLESS_CYCLE_MS) timeoutRound();
  animation = requestAnimationFrame(tick);
}
function timeoutRound() {
  game.locked = true; game.wrong++; game.combo = 0; game.responseTimes.push(mode === 'endless' ? ENDLESS_CYCLE_MS : game.roundLimit);
  [...document.querySelectorAll('.answer')].forEach(b => { b.disabled = true; if (b.dataset.color === game.ink.id) b.classList.add('correct'); });
  $('combo').textContent = '×0'; $('feedback').textContent = `${t('wrongFeedback')} ${t(`color.${game.ink.id}`)}`; $('feedback').className = 'feedback bad'; playTone(false); scheduleNextRound(750);
}
async function finishGame() {
  game.active = false; cancelAnimationFrame(animation); clearNextRoundTimer(); pausedNextRoundDelay = null; const total = game.correct + game.wrong; const accuracy = total ? Math.round(game.correct / total * 100) : 0; const avg = game.responseTimes.length ? formatSeconds((game.responseTimes.reduce((a, b) => a + b, 0) / game.responseTimes.length / 1000).toFixed(2)) : '—';
  settings.bestScore = Math.max(settings.bestScore, game.score); settings.accuracyRecord = Math.max(settings.accuracyRecord, accuracy); await storage.set({ bestScore: settings.bestScore, accuracyRecord: settings.accuracyRecord });
  $('finalScore').textContent = game.score; $('correct').textContent = game.correct; $('wrong').textContent = game.wrong; $('accuracy').textContent = `${accuracy}%`; $('averageTime').textContent = avg; $('resultTitle').textContent = game.score > game.startedBest ? t('newBest') : t('roundDone'); show('resultView');
}

async function init() {
  settings = await storage.get(settings); await loadLanguage(settings.language); $('sound').checked = settings.sound; $('accessibility').checked = settings.accessibility;
  document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; document.querySelectorAll('.mode').forEach(b => b.classList.toggle('selected', b === button)); }));
  $('startButton').onclick = startGame; $('againButton').onclick = startGame; $('homeButton').onclick = () => { $('bestScore').textContent = settings.bestScore; show('setupView'); }; $('endEndlessButton').onclick = endEndlessGame;
  $('settingsButton').onclick = openSettings; $('closeSettings').onclick = closeSettings;
  $('language').onchange = async e => { settings.language = e.target.value; await storage.set({ language: settings.language }); await loadLanguage(settings.language); };
  $('sound').onchange = async e => { settings.sound = e.target.checked; await storage.set({ sound: settings.sound }); }; $('accessibility').onchange = async e => { settings.accessibility = e.target.checked; await storage.set({ accessibility: settings.accessibility }); };
}
init();
