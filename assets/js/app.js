(function () {
  'use strict';

  const PAGE = document.body.dataset.page || 'home';
  const SET_SIZE = 30;
  const KEYS = {
    progress: 'pn_progress_v3',
    saved: 'pn_saved_v3',
    adminPass: 'pn_admin_pass_v3',
    github: 'pn_github_v3',
    review: 'pn_review_v3',
    retry: 'pn_retry_v3',
    daily: 'pn_daily_v1'
  };

  const state = {
    index: null,
    subjectMap: new Map(),
    topicMap: new Map(),
    questionCache: new Map(),
    currentReview: null
  };

  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  const getJSON = async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return response.json();
  };

  const slugify = (value) => value.toLowerCase().trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const params = () => new URLSearchParams(window.location.search);
  const readStore = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  };
  const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const formatDate = (date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);

  async function loadIndex() {
    if (state.index) return state.index;
    const index = await getJSON('./data/index.json');
    state.index = index;
    state.subjectMap.clear();
    state.topicMap.clear();
    index.subjects.forEach((subject) => {
      state.subjectMap.set(subject.id, subject);
      subject.topics.forEach((topic) => {
        state.topicMap.set(`${subject.id}:${topic.id}`, { ...topic, subjectId: subject.id, subjectName: subject.name });
      });
    });
    return index;
  }

  async function loadTopic(subjectId, topicId) {
    const key = `${subjectId}:${topicId}`;
    if (state.questionCache.has(key)) return state.questionCache.get(key);
    const topicMeta = state.topicMap.get(key);
    if (!topicMeta) throw new Error('Topic not found');
    const data = await getJSON(`./${topicMeta.file}`);
    state.questionCache.set(key, data);
    return data;
  }

  function pageLink(path, query = {}) {
    const u = new URL(path, window.location.href);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    });
    return `${u.pathname.split('/').pop()}${u.search}`;
  }

  function getSavedIds() { return readStore(KEYS.saved, []); }
  function setSavedIds(ids) { writeStore(KEYS.saved, ids); }
  function isSaved(id) { return getSavedIds().includes(id); }
  function toggleSaved(question) {
    const ids = getSavedIds();
    const exists = ids.includes(question.id);
    let next;
    if (exists) {
      next = ids.filter((id) => id !== question.id);
    } else {
      next = [...ids, question.id];
    }
    setSavedIds(next);
    const progress = readStore(KEYS.progress, { savedBank: {} });
    progress.savedBank = progress.savedBank || {};
    if (!exists) progress.savedBank[question.id] = question;
    else delete progress.savedBank[question.id];
    writeStore(KEYS.progress, progress);
    return !exists;
  }


  function getSavedNotes() {
    const progress = getProgress();
    progress.savedNotes = progress.savedNotes || {};
    return progress.savedNotes;
  }

  function getNote(questionId) {
    return getSavedNotes()[questionId]?.note || '';
  }

  function hasNote(questionId) {
    return !!getNote(questionId).trim();
  }

  function setNote(question, noteText) {
    const progress = getProgress();
    progress.savedNotes = progress.savedNotes || {};
    const clean = (noteText || '').trim();
    if (!clean) {
      delete progress.savedNotes[question.id];
    } else {
      progress.savedNotes[question.id] = {
        id: question.id,
        subject: question.subject,
        topic: question.topic,
        question: question.question,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        caseScenario: question.caseScenario || '',
        imageUrl: question.imageUrl || '',
        note: clean
      };
    }
    saveProgress(progress);
  }

  function getProgress() {
    return readStore(KEYS.progress, {
      studiedQuestions: 0,
      studySessions: 0,
      finalExamsCompleted: 0,
      correctSelections: 0,
      totalSelections: 0,
      subjects: {},
      topics: {},
      recent: [],
      strengths: {},
      weak: {},
      savedBank: {},
      savedNotes: {}
    });
  }

  function saveProgress(progress) { writeStore(KEYS.progress, progress); }

  function getTopicStatus(subjectId, topicId, questionCount = 0) {
    const progress = getProgress();
    const key = `${subjectId}:${topicId}`;
    const stats = progress.topics[key] || null;
    const answered = Math.min(stats?.total || 0, questionCount || stats?.total || 0);
    const accuracy = stats?.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    const completion = questionCount ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;

    if (!stats || !stats.total) return { label: 'Not Started', accuracy: 0, completion: 0, tone: 'tag', className: 'is-not-started' };
    if (questionCount && answered >= questionCount && accuracy >= 85) return { label: 'Mastered', accuracy, completion: 100, tone: 'badge', className: 'is-mastered' };
    if (questionCount && answered >= questionCount) return { label: 'Completed', accuracy, completion: 100, tone: 'badge', className: 'is-completed' };
    return { label: 'In Progress', accuracy, completion: completion || 1, tone: 'tag', className: 'is-in-progress' };
  }

  function getTopicStatusMarkup(subjectId, topicId, questionCount = 0) {
    const status = getTopicStatus(subjectId, topicId, questionCount);
    return `
      <span class="${status.tone}">${status.label}</span>
      ${status.accuracy ? `<span class="tag">${status.accuracy}% Accuracy</span>` : ''}
      ${status.completion ? `<span class="tag">${status.completion}% Complete</span>` : ''}
    `;
  }

  function getContinueState() {
    const progress = getProgress();
    return progress.continueStudy || null;
  }

  function setContinueState(payload) {
    const progress = getProgress();
    progress.continueStudy = {
      subjectId: payload.subjectId,
      subjectName: payload.subjectName,
      topicId: payload.topicId,
      topicName: payload.topicName,
      setNumber: payload.setNumber,
      questionIndex: payload.questionIndex || 0,
      totalQuestions: payload.totalQuestions || 0,
      updatedAt: Date.now()
    };
    saveProgress(progress);
  }

  function clearContinueState() {
    const progress = getProgress();
    delete progress.continueStudy;
    saveProgress(progress);
  }

  function continueLink() {
    const state = getContinueState();
    if (!state) return '';
    return pageLink('./study.html', { subject: state.subjectId, topic: state.topicId, set: state.setNumber, resume: 1 });
  }

  const PAGE_META = {
    home: { title: 'Home', kicker: 'Pharmacy Nexus', description: 'Your main hub for guided study, quick actions, and daily momentum.' },
    subjects: { title: 'Subjects', kicker: 'Structured Navigation', description: 'Browse the full subject map and move into any study path clearly.' },
    auth: { title: 'Auth', kicker: 'Secure Access', description: 'Sign in or create your account for a more personalized experience.' },
    topics: { title: 'Topics', kicker: 'Subject Breakdown', description: 'See all topics inside the selected subject and choose where to continue.' },
    topic: { title: 'Topic Sets', kicker: 'Focused Practice', description: 'Review difficulty spread, progress, and launch any 30-question set.' },
    study: { title: 'Study Session', kicker: 'Interactive Practice', description: 'Answer, review instantly, save important items, and keep moving smoothly.' },
    review: { title: 'Review', kicker: 'Performance Feedback', description: 'Understand what happened, revisit errors, and retry weak points with clarity.' },
    dashboard: { title: 'Dashboard', kicker: 'Your Progress', description: 'Track study volume, performance, recent activity, and saved work.' },
    saved: { title: 'Saved & Notes', kicker: 'Knowledge Bank', description: 'Return to starred questions and personal notes whenever you need them.' },
    'final-exam': { title: 'Final Exam', kicker: 'Timed Simulation', description: 'Build a mixed exam experience and review it like a real assessment.' }
  };

  function getPageMeta(page = PAGE) {
    return PAGE_META[page] || {
      title: 'Pharmacy Nexus',
      kicker: 'Learning Platform',
      description: 'A calm and structured pharmacy study experience.'
    };
  }

  function createDrawerLink(path, label, sublabel, active = false) {
    return `
      <a class="drawer-link ${active ? 'is-active' : ''}" href="${path}">
        <span class="drawer-link-main">${label}</span>
        <span class="drawer-link-sub">${sublabel}</span>
      </a>
    `;
  }

  function isInternalHref(rawHref) {
    if (!rawHref) return false;
    if (rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return false;
    try {
      const parsed = new URL(rawHref, window.location.href);
      return parsed.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function showRouteLoader(targetHref) {
    const overlay = document.getElementById('routeLoader');
    if (!overlay) return;
    const destination = document.getElementById('routeLoaderDestination');
    const meta = document.getElementById('routeLoaderMeta');
    let label = 'Opening next page';
    try {
      const parsed = new URL(targetHref, window.location.href);
      const file = (parsed.pathname.split('/').pop() || '').toLowerCase();
      if (file.includes('subjects')) label = 'Opening subjects';
      else if (file.includes('topics')) label = 'Opening topic list';
      else if (file.includes('topic')) label = 'Preparing topic view';
      else if (file.includes('study')) label = 'Preparing study session';
      else if (file.includes('review')) label = 'Opening review';
      else if (file.includes('dashboard')) label = 'Opening dashboard';
      else if (file.includes('saved')) label = 'Opening saved bank';
      else if (file.includes('final-exam')) label = 'Preparing final exam';
      else if (file.includes('intern')) label = 'Opening intern area';
      else if (file.includes('index')) label = 'Returning to home';
    } catch (_) {}
    if (destination) destination.textContent = label;
    if (meta) meta.textContent = 'Building the next view through a live Nexus reaction…';
    document.body.classList.add('route-loading');
    overlay.classList.add('is-visible');
  }

  function hideRouteLoader() {
    const overlay = document.getElementById('routeLoader');
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    document.body.classList.remove('route-loading');
  }

  function navigateWithLoader(url) {
    if (!url) return;
    showRouteLoader(url);
    setTimeout(() => {
      window.location.href = url;
    }, 760);
  }

  function bindRouteLinks(scope = document) {
    scope.querySelectorAll('a[href]').forEach((anchor) => {
      if (anchor.dataset.routeBound === '1') return;
      const rawHref = anchor.getAttribute('href') || '';
      if (!isInternalHref(rawHref)) return;
      anchor.dataset.routeBound = '1';
      anchor.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank') return;
        event.preventDefault();
        closeDrawer();
        navigateWithLoader(anchor.href);
      });
    });
  }

  function openDrawer() {
    document.body.classList.add('drawer-open');
    document.getElementById('appDrawer')?.classList.add('is-open');
    document.getElementById('drawerBackdrop')?.classList.add('is-open');
    document.getElementById('navToggle')?.classList.add('is-open');
  }

  function closeDrawer() {
    document.body.classList.remove('drawer-open');
    document.getElementById('appDrawer')?.classList.remove('is-open');
    document.getElementById('drawerBackdrop')?.classList.remove('is-open');
    document.getElementById('navToggle')?.classList.remove('is-open');
  }

  function clampDailyCount(subjectQuestionTotal) {
  return Math.max(1, Math.min(10, subjectQuestionTotal || 1));
}
function getRandomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}  

function polarSegmentBackground(count, colors) {
  if (!count) return '#1d3557';
  const step = 360 / count;
  const stops = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * step;
    const end = (i + 1) * step;
    const color = colors[i % colors.length];
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}

function buildWheelLabels(container, options) {
  container.innerHTML = '';
  const count = options.length;
  const step = 360 / count;

  options.forEach((option, index) => {
    const label = document.createElement('div');
    label.className = 'wheel-label';
    label.style.transform = `rotate(${index * step}deg)`;
    label.innerHTML = `<span style="transform: rotate(${step / 2}deg)">${option.label}</span>`;
    container.appendChild(label);
  });
}

function playTickSound(audioCtx, frequency = 900, duration = 0.018, gainValue = 0.028) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(audioCtx.destination);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playFinishSound(audioCtx) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  [660, 880].forEach((freq, i) => {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, now + i * 0.06);
    gain.gain.setValueAtTime(0.001, now + i * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.05, now + i * 0.06 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.16);

    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.start(now + i * 0.06);
    oscillator.stop(now + i * 0.06 + 0.16);
  });
}

function ensureWheelAudio() {
  try {
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextRef) return null;
    if (!window.__dailyWheelAudioCtx) {
      window.__dailyWheelAudioCtx = new AudioContextRef();
    }
    if (window.__dailyWheelAudioCtx.state === 'suspended') {
      window.__dailyWheelAudioCtx.resume();
    }
    return window.__dailyWheelAudioCtx;
  } catch (error) {
    return null;
  }
}

function computeWheelRotation(optionCount, chosenIndex, extraSpins = 5) {
  const segment = 360 / optionCount;
  const centerAngle = chosenIndex * segment + segment / 2;
  const pointerAngle = 0;
  const target = 360 - centerAngle + pointerAngle;
  return extraSpins * 360 + target;
}

function spinWheel({
  wheelEl,
  resultEl,
  options,
  getResultText,
  audioCtx,
  duration = 3200
}) {
  return new Promise((resolve) => {
    if (!options.length) {
      resolve(null);
      return;
    }

    const chosenIndex = Math.floor(Math.random() * options.length);
    const chosen = options[chosenIndex];
    const finalRotation = computeWheelRotation(options.length, chosenIndex, 6 + Math.floor(Math.random() * 2));

    wheelEl.classList.add('is-spinning');
    wheelEl.style.transition = 'none';
    wheelEl.style.transform = 'rotate(0deg)';
    wheelEl.offsetHeight;

    let tickCount = 0;
    const tickIntervalMs = 85;
    const tickTimer = setInterval(() => {
      tickCount += 1;
      playTickSound(audioCtx, 850 + (tickCount % 5) * 30, 0.014, 0.02);
    }, tickIntervalMs);

    requestAnimationFrame(() => {
      wheelEl.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.82, 0.18, 1)`;
      wheelEl.style.transform = `rotate(${finalRotation}deg)`;
    });

    setTimeout(() => {
      clearInterval(tickTimer);
      playFinishSound(audioCtx);
      wheelEl.classList.remove('is-spinning');
      resultEl.textContent = getResultText(chosen);
      resolve(chosen);
    }, duration + 40);
  });
}
async function startDailyChallengeBySubject(subjectId, requestedCount) {
  const subject = state.subjectMap.get(subjectId);
  if (!subject) throw new Error('Selected subject was not found.');

  let pool = [];
  for (const topic of subject.topics) {
    const data = await loadTopic(subjectId, topic.id);
    pool.push(...(data.questions || []));
  }

  if (!pool.length) throw new Error('No questions were found for the selected subject.');

  const actualCount = Math.min(Math.max(1, requestedCount || 1), pool.length);

  const questions = shuffle(pool)
    .slice(0, actualCount)
    .map((q) => ({
      ...q,
      options: shuffle([...(q.options || [])])
    }));

  writeStore(KEYS.daily, {
    date: new Date().toISOString(),
    subjects: [subjectId],
    subjectNames: [subject.name],
    questions,
    selectedCount: actualCount,
    selectedSubjectName: subject.name
  });

  navigateWithLoader('./study.html?daily=1');
}

  function ensureShell() {
    const root = document.getElementById('site-shell');
    const meta = getPageMeta();
    root.innerHTML = `
      <div class="drawer-backdrop" id="drawerBackdrop"></div>
      <aside class="app-drawer" id="appDrawer" aria-label="Primary navigation">
        <div class="drawer-head">
          <a class="drawer-brand" href="./index.html">
            <span class="drawer-brand-mark" aria-hidden="true">
              <span class="nexus-core"></span>
              <span class="nexus-ring ring-a"></span>
              <span class="nexus-ring ring-b"></span>
              <span class="nexus-node node-a"></span>
              <span class="nexus-node node-b"></span>
              <span class="nexus-node node-c"></span>
            </span>
            <span>
              <strong>Pharmacy Nexus</strong>
              <small>Chemical learning system</small>
            </span>
          </a>
          <button class="drawer-close" id="drawerClose" type="button" aria-label="Close navigation">×</button>
        </div>

        <div class="drawer-intro card">
          <span class="tag">${meta.kicker}</span>
          <h3>${meta.title}</h3>
          <p class="muted">${meta.description}</p>
        </div>

        <nav class="drawer-nav" id="navMenu">
          ${createDrawerLink('./index.html', 'Home', 'Overview, daily challenge, and recent activity', PAGE === 'home')}
          ${createDrawerLink('./subjects.html', 'Subjects', 'Browse the full subject map and start clearly', PAGE === 'subjects' || PAGE === 'topics' || PAGE === 'topic')}
          ${createDrawerLink('./auth.html', 'Auth', 'Sign in or create your account', PAGE === 'auth')}
          ${createDrawerLink('./final-exam.html', 'Final Exam', 'Timed mixed assessment with full review', PAGE === 'final-exam')}
          ${createDrawerLink('./dashboard.html', 'Dashboard', 'Your performance, progress, and history', PAGE === 'dashboard')}
          ${createDrawerLink('./saved.html', 'Saved & Notes', 'Return to starred questions and notes', PAGE === 'saved')}
          ${createDrawerLink('./intern/index.html', 'Intern', 'Enter the intern section and related tools', false)}
        </nav>

        <div class="drawer-note">
          <span class="drawer-note-title">Nexus tip</span>
          <p>Every page here is part of one connected study network, so you always know where to begin and where to continue.</p>
        </div>
      </aside>

      <div class="route-loader" id="routeLoader" aria-hidden="true">
        <div class="route-loader-shell">
          <div class="route-loader-network">
            <div class="route-loader-grid"></div>
            <div class="route-loader-bond bond-a"></div>
            <div class="route-loader-bond bond-b"></div>
            <div class="route-loader-bond bond-c"></div>
            <div class="route-loader-atom atom-center"></div>
            <div class="route-loader-atom atom-a"></div>
            <div class="route-loader-atom atom-b"></div>
            <div class="route-loader-atom atom-c"></div>
            <div class="route-loader-pulse pulse-a"></div>
            <div class="route-loader-pulse pulse-b"></div>
          </div>
          <div class="route-loader-copy">
            <span class="badge">Nexus Transition</span>
            <h2 id="routeLoaderDestination">Opening next page</h2>
            <p id="routeLoaderMeta">Building the next view through a live Nexus reaction…</p>
          </div>
        </div>
      </div>

      <header class="site-header app-topbar">
        <div class="container navbar app-topbar-inner">
          <div class="app-topbar-left">
            <button class="nav-toggle" id="navToggle" type="button" aria-label="Open navigation"><span></span></button>
            <a class="brand app-brand" href="./index.html">
              <span class="brand-mark brand-mark-nexus" aria-hidden="true">
                <span class="nexus-core"></span>
                <span class="nexus-node node-a"></span>
                <span class="nexus-node node-b"></span>
                <span class="nexus-node node-c"></span>
              </span>
              <span>Pharmacy Nexus</span>
            </a>
          </div>
          <div class="page-context">
            <span class="page-context-kicker">${meta.kicker}</span>
            <strong>${meta.title}</strong>
            <small>${meta.description}</small>
          </div>
        </div>
      </header>
      <main class="main-section"><div class="container" id="pageRoot"></div></main>
      <footer class="footer">
        <div class="container footer-shell">
          <div>
            <strong>Contact: pharmacynexusofficial@gmail.com</strong>
            <div>For feedback, collaboration, or educational contributions, feel free to contact us.</div>
          </div>
        </div>
      </footer>
      <div class="admin-backdrop" id="adminBackdrop"></div>
    `;

    document.getElementById('navToggle')?.addEventListener('click', () => {
      const isOpen = document.getElementById('appDrawer')?.classList.contains('is-open');
      if (isOpen) closeDrawer();
      else openDrawer();
    });
    document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerBackdrop')?.addEventListener('click', closeDrawer);
    bindRouteLinks(root);
  }


  function getSubjectAccent(subjectName = '', index = 0) {
    const key = subjectName.toLowerCase();
    if (key.includes('pharmacology') || key.includes('فارما')) {
      return { icon: '💊', tag: 'Core', bg: 'linear-gradient(135deg, #0d2549 0%, #143564 62%, #1d467d 100%)' };
    }
    if (key.includes('biochemistry') || key.includes('bio')) {
      return { icon: '🧬', tag: 'Pathways', bg: 'linear-gradient(135deg, #102543 0%, #1d467d 58%, #d7b14b 140%)' };
    }
    if (key.includes('pharmaceutics') || key.includes('سيوتكس')) {
      return { icon: '🧪', tag: 'Dosage Forms', bg: 'linear-gradient(135deg, #07182f 0%, #0d2549 60%, #2b5c92 100%)' };
    }
    if (key.includes('chemistry') || key.includes('pharmaceutical chemistry') || key.includes('medicinal') || key.includes('سيوتكال')) {
      return { icon: '⚗️', tag: 'Medicinal', bg: 'linear-gradient(135deg, #0d2549 0%, #143564 55%, #0b1c37 100%)' };
    }
    if (key.includes('clinical')) {
      return { icon: '🩺', tag: 'Practice', bg: 'linear-gradient(135deg, #143564 0%, #1d467d 52%, #e8c765 155%)' };
    }
    const fallback = [
      { icon: '📘', tag: 'Subject', bg: 'linear-gradient(135deg, #07182f 0%, #0d2549 56%, #143564 100%)' },
      { icon: '🔬', tag: 'Science', bg: 'linear-gradient(135deg, #102543 0%, #1d467d 60%, #143564 100%)' },
      { icon: '🧠', tag: 'High Yield', bg: 'linear-gradient(135deg, #0d2549 0%, #143564 58%, #d7b14b 165%)' },
      { icon: '📚', tag: 'Review', bg: 'linear-gradient(135deg, #07182f 0%, #143564 55%, #1d467d 100%)' }
    ];
    return fallback[index % fallback.length];
  }

  function buildHomeSubjectCarousel(subjects) {
    const cards = subjects.map((subject, index) => {
      const accent = getSubjectAccent(subject.name, index);
      const topicCount = (subject.topics || []).length;
      const questionCount = (subject.topics || []).reduce((sum, topic) => sum + (topic.questionCount || 0), 0);
      return `
        <a class="subject-showcase-card" href="${pageLink('./topics.html', { subject: subject.id })}" style="--subject-bg:${accent.bg};">
          <div class="subject-showcase-glow"></div>
          <div class="subject-showcase-top">
            <div class="subject-showcase-count">${String(index + 1).padStart(2, '0')}</div>
            <div class="subject-showcase-tag">${accent.tag}</div>
          </div>
          <div class="subject-showcase-icon">${accent.icon}</div>
          <div class="subject-showcase-body">
            <h3>${subject.name}</h3>
            <p>${topicCount} topic${topicCount === 1 ? '' : 's'} • ${questionCount} question${questionCount === 1 ? '' : 's'}</p>
            <div class="subject-showcase-footer">
              <span class="subject-showcase-link">Open Subject</span>
            </div>
          </div>
        </a>
      `;
    }).join('');

    return `
      <section class="home-subject-showcase" style="margin-top:30px;">
        <div class="section-header">
          <div>
            <h2>Browse Subjects</h2>
            <p>A smooth moving subject rail that makes the home page feel richer and more visual.</p>
          </div>
          <a class="btn btn-secondary" href="./subjects.html">See All Subjects</a>
        </div>
        <div class="subject-showcase-shell">
          <div class="subject-showcase-track">
            ${cards}
            ${cards}
          </div>
        </div>
      </section>
    `;
  }

function renderHome(index) {
  const root = document.getElementById('pageRoot');
  const subjects = index.subjects;
  const progress = getProgress();
  const continueState = getContinueState();
  const recent = progress.recent.slice(0, 4);
  const savedCount = Object.keys(progress.savedBank || {}).length;
  const notesCount = Object.keys(progress.savedNotes || {}).length;
  const accuracy = progress.totalSelections
    ? Math.round((progress.correctSelections / progress.totalSelections) * 100)
    : 0;

  const totalQuestions = subjects.reduce(
    (sum, subject) => sum + (subject.topics || []).reduce((acc, topic) => acc + (topic.questionCount || 0), 0),
    0
  );

  root.innerHTML = `
    <section class="hero hero-graphic-shell">
      <span class="hero-chem hero-chem-a">C₂₀H₂₅N₃O</span>
      <span class="hero-chem hero-chem-b">C₈H₉NO₂</span>
      <span class="hero-orb hero-orb-a"></span>
      <span class="hero-orb hero-orb-b"></span>

      <div class="hero-grid">
        <div>
          <span class="eyebrow">Pharmacy Nexus • Structured Learning</span>
          <h1>Your Ultimate Pharmacy Learning Platform <span>Built for Future Pharmacists</span></h1>
          <p>
            Move subject by subject, topic by topic, study in clear 30-question sets,
            review every attempt in detail, and finish with a polished final exam workflow.
          </p>

          <div class="hero-actions">
  <a class="btn btn-primary" href="./subjects.html">Explore Subjects</a>
  <a class="btn btn-secondary" href="./final-exam.html">Go to Final Exam</a>
  <a class="btn btn-light" href="./auth.html">Sign In</a>
</div>

          <div class="hero-mini-stats">
            <div class="mini-stat">
              <strong>${subjects.length}</strong>
              <span>Subjects</span>
            </div>
            <div class="mini-stat">
              <strong>${totalQuestions}</strong>
              <span>Questions</span>
            </div>
            <div class="mini-stat">
              <strong>${accuracy}%</strong>
              <span>Accuracy</span>
            </div>
          </div>
        </div>

        <div class="hero-panel">
          <h3>Focused. Clean. Expandable.</h3>
          <p>
            Study sets, instant feedback, saved questions, final exam review,
            dashboard tracking, and hidden admin management inside one lightweight static build.
          </p>

          <div class="stats-grid">
            <div class="stat-box"><div class="label">Saved Questions</div><div class="value">${savedCount}</div></div>
            <div class="stat-box"><div class="label">Notes</div><div class="value">${notesCount}</div></div>
            <div class="stat-box"><div class="label">Final Exams</div><div class="value">${progress.finalExamsCompleted}</div></div>
            <div class="stat-box"><div class="label">Accuracy</div><div class="value">${accuracy}%</div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="ticker-section" style="margin-top:26px;">
      <div class="ticker-shell">
        <div class="ticker-track">
          <span> Study in focused 30-question sets</span>
          <span> Get instant answer feedback and explanations</span>
          <span> Save important questions and notes</span>
          <span> Retry only the questions you missed</span>
          <span> Practice with timed final exams</span>
          <span> Study in focused 30-question sets</span>
          <span> Get instant answer feedback and explanations</span>
          <span> Save important questions and notes</span>
          <span> Retry only the questions you missed</span>
          <span> Practice with timed final exams</span>
        </div>
      </div>
    </section>

    ${continueState ? `
      <section style="margin-top:30px;">
        <div class="card continue-banner">
          <div>
            <div class="meta-row">
              <span class="badge">Continue</span>
              <span class="tag">${continueState.subjectName || 'Subject'}</span>
            </div>
            <h3 style="margin:8px 0 6px;">Resume ${continueState.topicName || 'your study session'}</h3>
            <p class="muted">
              You stopped at question ${Math.min((continueState.questionIndex || 0) + 1, Math.max(continueState.totalQuestions || 1, 1))}
              in set ${continueState.setNumber || 1}.
            </p>
          </div>
          <a class="btn btn-dark" href="${continueLink()}">Resume Now</a>
        </div>
      </section>
    ` : ''}

    ${buildHomeSubjectCarousel(subjects)}

 <section class="home-daily-section" style="margin-top:30px;">
  <div class="section-header">
    <div>
      <h2>Daily Challenge</h2>
      <p>Spin for a subject, get a lucky number, and launch a fast daily practice session.</p>
    </div>
  </div>

  <div class="card home-dark-card daily-challenge-card daily-premium-card">
    <div class="daily-accent daily-accent-a"></div>
    <div class="daily-accent daily-accent-b"></div>

    <div class="daily-header-row">
      <div>
        <div class="meta-row">
          <span class="badge">Daily Spin</span>
          <span class="tag">Premium Hybrid</span>
        </div>
        <h3 style="margin:8px 0 6px;">Spin the Subject Wheel</h3>
        <p class="muted">
          The wheel updates automatically when you add new subjects. Then generate a lucky question count from 1 to the smart maximum.
        </p>
      </div>
    </div>

    <div class="daily-premium-layout">
      <div class="daily-wheel-side">
        <div class="wheel-stage premium-wheel-stage">
          <div class="wheel-pointer"></div>
          <div class="daily-wheel-shell premium-wheel-shell">
            <div class="daily-wheel-disc" id="subjectWheelDisc">
              <div class="daily-wheel-center"></div>
              <div class="wheel-labels" id="subjectWheelLabels"></div>
            </div>
          </div>
        </div>

        <div class="daily-wheel-result" id="dailySubjectDisplay">Press spin</div>
        <div class="muted" id="dailySubjectMeta">Chooses from all current subjects in your bank.</div>

        <div class="action-row" style="justify-content:center; margin-top:12px;">
          <button class="btn btn-light" id="spinSubjectBtn" type="button">Spin Subject</button>
        </div>
      </div>

      <div class="daily-lucky-side">
        <div class="daily-lucky-card">
          <div class="daily-wheel-label">Lucky Number</div>
          <div class="daily-lucky-number" id="dailyCountDisplay">?</div>
          <div class="muted" id="dailyCountMeta">Spin a subject first.</div>

          <div class="action-row" style="justify-content:center; margin-top:14px;">
            <button class="btn btn-light" id="spinCountBtn" type="button" disabled>Lucky Number</button>
          </div>
        </div>

        <div class="daily-selection-summary" id="dailySelectionSummary">
          <div class="metric-row"><span>Selected Subject</span><strong>—</strong></div>
          <div class="metric-row"><span>Questions</span><strong>—</strong></div>
        </div>

        <div class="action-row" style="justify-content:flex-start; margin-top:16px;">
          <button class="btn btn-primary" id="dailyChallengeBtn" type="button" disabled>Start Daily Challenge</button>
        </div>
      </div>
    </div>

    <div id="dailyChallengeMsg"></div>
  </div>
</section>
    <section style="margin-top:30px;">
      <div class="section-header">
        <div>
          <h2>Recent Activity</h2>
          <p>Your latest study and exam sessions.</p>
        </div>
      </div>

      <div class="card home-dark-card">
        ${recent.length ? `
          <div class="list-stack">
            ${recent.map((item) => `
              <div class="list-item home-dark-panel">
                <div>
                  <strong>${item.name || item.type || 'Activity'}</strong>
                  <div class="muted">${item.subject || 'Mixed'} • ${item.date || ''}</div>
                </div>
                <div class="tag">${item.score || '--'}</div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">No recent activity yet. Start your first study set to build momentum.</div>
        `}
      </div>
    </section>
  `;
const dailyBtn = document.getElementById('dailyChallengeBtn');
const dailyMsg = document.getElementById('dailyChallengeMsg');
const spinSubjectBtn = document.getElementById('spinSubjectBtn');
const spinCountBtn = document.getElementById('spinCountBtn');

const subjectDisplay = document.getElementById('dailySubjectDisplay');
const countDisplay = document.getElementById('dailyCountDisplay');
const subjectMeta = document.getElementById('dailySubjectMeta');
const countMeta = document.getElementById('dailyCountMeta');
const summary = document.getElementById('dailySelectionSummary');

const subjectWheelDisc = document.getElementById('subjectWheelDisc');
const subjectWheelLabels = document.getElementById('subjectWheelLabels');

let selectedDailySubject = null;
let selectedDailyCount = null;

const subjectOptions = subjects.map((subject) => ({
  id: subject.id,
  name: subject.name,
  totalQuestions: (subject.topics || []).reduce((sum, topic) => sum + (topic.questionCount || 0), 0),
  label: subject.name
}));

const wheelPalette = [
  '#0f274f',
  '#17386b',
  '#214b86',
  '#a98028',
  '#d0a546',
  '#355f9d',
  '#1d3e73',
  '#6f5320'
];

subjectWheelDisc.style.background = polarSegmentBackground(subjectOptions.length, wheelPalette);
buildWheelLabels(subjectWheelLabels, subjectOptions);

function refreshDailySummary() {
  summary.innerHTML = `
    <div class="metric-row"><span>Selected Subject</span><strong>${selectedDailySubject?.name || '—'}</strong></div>
    <div class="metric-row"><span>Questions</span><strong>${selectedDailyCount || '—'}</strong></div>
  `;
  dailyBtn.disabled = !(selectedDailySubject && selectedDailyCount);
}

function animateLuckyNumber(maxCount, audioCtx) {
  return new Promise((resolve) => {
    let ticks = 0;
    const totalTicks = 16 + Math.floor(Math.random() * 8);

    const interval = setInterval(() => {
      const value = getRandomInt(1, maxCount);
      countDisplay.textContent = `${value}`;
      playTickSound(audioCtx, 950 + (ticks % 4) * 35, 0.012, 0.018);
      ticks += 1;

      if (ticks >= totalTicks) {
        clearInterval(interval);
        const finalValue = getRandomInt(1, maxCount);
        countDisplay.textContent = `${finalValue}`;
        playFinishSound(audioCtx);
        resolve(finalValue);
      }
    }, 80);
  });
}

spinSubjectBtn?.addEventListener('click', async () => {
  if (!subjectOptions.length) {
    dailyMsg.innerHTML = '<div class="message error">No subjects available yet.</div>';
    return;
  }

  dailyMsg.innerHTML = '';
  selectedDailyCount = null;
  countDisplay.textContent = '?';
  countMeta.textContent = 'Spin a subject first.';
  spinCountBtn.disabled = true;
  refreshDailySummary();

  const audioCtx = ensureWheelAudio();

  spinSubjectBtn.disabled = true;
  const picked = await spinWheel({
    wheelEl: subjectWheelDisc,
    resultEl: subjectDisplay,
    options: subjectOptions,
    getResultText: (item) => item.name,
    audioCtx,
    duration: 3200
  });
  spinSubjectBtn.disabled = false;

  selectedDailySubject = picked;

  if (picked) {
    const maxCount = clampDailyCount(picked.totalQuestions);
    subjectMeta.textContent = `${picked.totalQuestions} question${picked.totalQuestions === 1 ? '' : 's'} available in this subject.`;
    countMeta.textContent = `Lucky number range: 1 to ${maxCount}.`;
    spinCountBtn.disabled = false;
  }

  refreshDailySummary();
});

spinCountBtn?.addEventListener('click', async () => {
  if (!selectedDailySubject) return;

  dailyMsg.innerHTML = '';
  const maxCount = clampDailyCount(selectedDailySubject.totalQuestions);
  const audioCtx = ensureWheelAudio();

  spinCountBtn.disabled = true;
  selectedDailyCount = await animateLuckyNumber(maxCount, audioCtx);
  spinCountBtn.disabled = false;

  countMeta.textContent = `Challenge will use ${selectedDailyCount} question${selectedDailyCount === 1 ? '' : 's'}.`;
  refreshDailySummary();
});

dailyBtn?.addEventListener('click', async () => {
  if (!(selectedDailySubject && selectedDailyCount)) return;

  dailyBtn.disabled = true;
  dailyBtn.textContent = 'Preparing...';
  dailyMsg.innerHTML = '';

  try {
    await startDailyChallengeBySubject(selectedDailySubject.id, selectedDailyCount);
  } catch (error) {
    dailyMsg.innerHTML = `<div class="message error">${error.message}</div>`;
    dailyBtn.disabled = false;
    dailyBtn.textContent = 'Start Daily Challenge';
  }
});

refreshDailySummary();
}
  function renderSubjectCards(subjects, target, searchInput) {
    const draw = (term = '') => {
      const filtered = subjects.filter((subject) => subject.name.toLowerCase().includes(term.toLowerCase()));
      target.innerHTML = filtered.length ? '' : '<div class="empty-state">No subjects matched your search.</div>';
      filtered.forEach((subject) => {
        const card = el('article', 'card soft');
        card.innerHTML = `
          <div class="meta-row"><span class="badge">${subject.topics.length} Topics</span><span class="tag">${subject.id}</span></div>
          <h3>${subject.name}</h3>
          <div class="meta-row">${subject.topics.slice(0, 2).map((t) => `<span class="tag">${t.name}</span>`).join('')}</div>
          <div style="margin-top:20px;"><a class="btn btn-dark" href="${pageLink('./topics.html', { subject: subject.id })}">Open Topics</a></div>
        `;
        target.appendChild(card);
      });
    };
    draw();
    searchInput?.addEventListener('input', (e) => draw(e.target.value));
  }

function renderSubjectsPage(index) {
  const root = document.getElementById('pageRoot');
  const subjects = index.subjects || [];

  root.innerHTML = `
    <section class="section-header">
      <div>
        <h2>Subjects</h2>
        <p>Browse your pharmacy subjects, check topic coverage, and open any subject to start studying.</p>
      </div>
    </section>

    <section style="margin-bottom: 22px;">
      <div class="card">
        <div class="input-row two">
          <div>
            <label class="muted">Search subjects</label>
            <input
              type="text"
              id="subjectSearch"
              class="input"
              placeholder="Type a subject name..."
            />
          </div>
          <div class="panel">
            <strong id="subjectCountLabel">${subjects.length} subject${subjects.length === 1 ? '' : 's'}</strong>
            <div class="muted" style="margin-top:8px;">
              Open a subject to explore topics and start study sets.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="card-grid" id="subjectsGrid"></div>
    </section>
  `;

  const grid = document.getElementById('subjectsGrid');
  const searchInput = document.getElementById('subjectSearch');
  const countLabel = document.getElementById('subjectCountLabel');

  function drawSubjects(query = '') {
    const normalized = query.trim().toLowerCase();

    const filtered = subjects.filter((subject) =>
      (subject.name || '').toLowerCase().includes(normalized)
    );

    countLabel.textContent = `${filtered.length} subject${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="empty-state">
          No subjects found for "<strong>${query}</strong>".
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((subject) => {
      const topicCount = (subject.topics || []).length;
      const questionCount = (subject.topics || []).reduce(
        (sum, topic) => sum + (topic.questionCount || 0),
        0
      );

      return `
        <article class="card subject-card-upgraded">
          <div class="subject-card-top">
            <div>
              <div class="tag">Subject</div>
              <h3>${subject.name}</h3>
            </div>
          </div>

          <p class="muted">
            ${topicCount} topic${topicCount === 1 ? '' : 's'} available for structured study.
          </p>

          <div class="subject-mini-stats">
            <div class="subject-mini-stat">
              <span>Topics</span>
              <strong>${topicCount}</strong>
            </div>
            <div class="subject-mini-stat">
              <span>Questions</span>
              <strong>${questionCount}</strong>
            </div>
          </div>

          <div class="action-row" style="justify-content:flex-start;">
            <a class="btn btn-dark" href="${pageLink('./topics.html', { subject: subject.id })}">
              Open Topics
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  drawSubjects();

  searchInput.addEventListener('input', (e) => {
    drawSubjects(e.target.value);
  });
}

async function renderTopicsPage() {
  const subjectId = params().get('subject');
  const subject = state.subjectMap.get(subjectId);
  const root = document.getElementById('pageRoot');

  if (!subject) {
    root.innerHTML = '<div class="empty-state">Subject not found.</div>';
    return;
  }

  const topics = subject.topics || [];
  const totalQuestions = topics.reduce((sum, topic) => sum + (topic.questionCount || 0), 0);

  root.innerHTML = `
    <section class="section-header">
      <div>
        <h2>${subject.name}</h2>
        <p>Browse topics, check coverage, and open any topic to start studying in structured sets.</p>
      </div>
    </section>

    <section style="margin-bottom:22px;">
      <div class="summary-grid three">
        <div class="card summary-card">
          <div class="muted">Topics</div>
          <div class="big">${topics.length}</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Question Bank</div>
          <div class="big">${totalQuestions}</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Study Mode</div>
          <div class="big" style="font-size:1.05rem;">Structured Sets</div>
        </div>
      </div>
    </section>

    <section style="margin-bottom:22px;">
      <div class="card">
        <div class="input-row two">
          <div>
            <label class="muted">Search topics</label>
            <input
              type="text"
              id="topicSearch"
              class="input"
              placeholder="Type a topic name..."
            />
          </div>
          <div class="panel">
            <strong id="topicCountLabel">${topics.length} topic${topics.length === 1 ? '' : 's'}</strong>
            <div class="muted" style="margin-top:8px;">
              Open a topic to choose study sets or launch practice.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="card-grid" id="topicsGrid"></div>
    </section>
  `;

  const grid = document.getElementById('topicsGrid');
  const searchInput = document.getElementById('topicSearch');
  const countLabel = document.getElementById('topicCountLabel');

  function drawTopics(query = '') {
    const normalized = query.trim().toLowerCase();

    const filtered = topics.filter((topic) =>
      (topic.name || '').toLowerCase().includes(normalized)
    );

    countLabel.textContent = `${filtered.length} topic${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="empty-state">
          No topics found for "<strong>${query}</strong>".
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((topic) => {
      const questionCount = topic.questionCount || 0;
      const setCount = Math.ceil(questionCount / SET_SIZE);
      const topicStatus = getTopicStatus(subjectId, topic.id, questionCount);

      return `
        <article class="card topic-card-upgraded">
          <div class="topic-card-top">
            <div>
              <div class="tag">Topic</div>
              <h3>${topic.name}</h3>
            </div>
            <div class="topic-status-chip ${topicStatus.className || ''}">
              ${topicStatus.label}
            </div>
          </div>

          <p class="muted">
            ${questionCount} question${questionCount === 1 ? '' : 's'} available across
            ${setCount || 1} study set${setCount === 1 ? '' : 's'}.
          </p>

          <div class="topic-mini-stats">
            <div class="topic-mini-stat">
              <span>Questions</span>
              <strong>${questionCount}</strong>
            </div>
            <div class="topic-mini-stat">
              <span>Sets</span>
              <strong>${setCount || 1}</strong>
            </div>
          </div>

          <div class="meta-row" style="margin-top:6px;">
            ${getTopicStatusMarkup(subjectId, topic.id, questionCount)}
          </div>

          <div class="action-row" style="justify-content:flex-start;">
            <a class="btn btn-dark" href="${pageLink('./topic.html', { subject: subjectId, topic: topic.id })}">
              Open Topic
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  drawTopics();

  searchInput.addEventListener('input', (e) => {
    drawTopics(e.target.value);
  });
}
  async function renderTopicPage() {
    const subjectId = params().get('subject');
    const topicId = params().get('topic');
    const subject = state.subjectMap.get(subjectId);
    const topic = state.topicMap.get(`${subjectId}:${topicId}`);
    const root = document.getElementById('pageRoot');
    if (!subject || !topic) {
      root.innerHTML = '<div class="empty-state">Topic not found.</div>';
      return;
    }
    const data = await loadTopic(subjectId, topicId);
    const questions = data.questions || [];
    const diff = { easy: 0, medium: 0, hard: 0 };
    questions.forEach((q) => { diff[q.difficulty] = (diff[q.difficulty] || 0) + 1; });
    const setCount = Math.ceil(questions.length / SET_SIZE);
    const topicStatus = getTopicStatus(subjectId, topicId, questions.length);
    root.innerHTML = `
      <div class="section-header"><div><h2>${topic.name}</h2><p>${subject.name} • ${questions.length} questions • choose a study set below.</p><div class="meta-row" style="margin-top:10px;">${getTopicStatusMarkup(subjectId, topicId, questions.length)}</div></div></div>
      <div class="summary-grid four input-row four">
        <div class="card summary-card"><div class="muted">Easy</div><div class="big">${diff.easy || 0}</div></div>
        <div class="card summary-card"><div class="muted">Medium</div><div class="big">${diff.medium || 0}</div></div>
        <div class="card summary-card"><div class="muted">Hard</div><div class="big">${diff.hard || 0}</div></div>
        <div class="card summary-card"><div class="muted">Status</div><div class="big" style="font-size:1.1rem;">${topicStatus.label}</div></div>
      </div>
      ${(() => { const c = getContinueState(); return c && c.subjectId === subjectId && c.topicId === topicId ? `
      <section style="margin-top:26px;">
        <div class="card">
          <div class="question-top">
            <div>
              <div class="meta-row"><span class="badge">Continue This Topic</span><span class="tag">Set ${c.setNumber}</span></div>
              <h3 style="margin:10px 0 6px;">Resume ${topic.name}</h3>
              <p class="muted">You last stopped at question ${Math.min((c.questionIndex || 0) + 1, Math.max(c.totalQuestions || 1, 1))} in this topic.</p>
            </div>
            <a class="btn btn-dark" href="${continueLink()}">Resume</a>
          </div>
        </div>
      </section>` : ''; })()}
      <section style="margin-top:26px;">
        <div class="card">
          <h3 style="margin-top:0;">Study Sets</h3>
          <p class="muted">Questions are automatically split into sets of 30. Inside each set, both question order and answer order are shuffled every time.</p>
          <div class="topic-sets" id="setGrid"></div>
        </div>
      </section>
    `;
    const setGrid = document.getElementById('setGrid');
    for (let i = 0; i < setCount; i += 1) {
      const start = i * SET_SIZE + 1;
      const end = Math.min((i + 1) * SET_SIZE, questions.length);
      const item = el('div', 'set-card');
      item.innerHTML = `
        <div class="tag">Set ${i + 1}</div>
        <h4 style="margin:12px 0 8px;">Questions ${start} - ${end}</h4>
        <p class="muted">${end - start + 1} questions in this set.</p>
        <a class="btn btn-dark" href="${pageLink('./study.html', { subject: subjectId, topic: topicId, set: i + 1 })}">Start Set</a>
      `;
      setGrid.appendChild(item);
    }
  }

  function prepareStudySet(questions, setNumber) {
    const start = (setNumber - 1) * SET_SIZE;
    const chunk = questions.slice(start, start + SET_SIZE);
    return shuffle(chunk).map((q) => ({
      ...q,
      options: shuffle([...(q.options || [])])
    }));
  }

  function questionKey(q) { return `${q.subject}:${q.topic}:${q.id}`; }

  function updateStudyProgress(payload) {
    const progress = getProgress();
    progress.studiedQuestions += payload.questionsSeen;
    progress.studySessions += 1;
    progress.correctSelections += payload.correct;
    progress.totalSelections += payload.total;
    progress.subjects[payload.subjectId] = progress.subjects[payload.subjectId] || { attempts: 0, correct: 0, total: 0 };
    progress.subjects[payload.subjectId].attempts += 1;
    progress.subjects[payload.subjectId].correct += payload.correct;
    progress.subjects[payload.subjectId].total += payload.total;
    progress.topics[payload.topicId] = progress.topics[payload.topicId] || { attempts: 0, correct: 0, total: 0, topicName: payload.topicName, subjectName: payload.subjectName };
    progress.topics[payload.topicId].attempts += 1;
    progress.topics[payload.topicId].correct += payload.correct;
    progress.topics[payload.topicId].total += payload.total;
    progress.recent.unshift({
      type: 'study', name: payload.topicName, subject: payload.subjectName, score: `${payload.correct}/${payload.total}`, date: formatDate(new Date())
    });
    progress.recent = progress.recent.slice(0, 12);
    saveProgress(progress);
  }


  function updateRetryProgress(payload) {
    const progress = getProgress();
    progress.studiedQuestions += payload.questionsSeen;
    progress.studySessions += 1;
    progress.correctSelections += payload.correct;
    progress.totalSelections += payload.total;
    payload.rows.forEach((row) => {
      const subjectId = row.question.subject;
      const topicKey = `${row.question.subject}:${row.question.topic}`;
      progress.subjects[subjectId] = progress.subjects[subjectId] || { attempts: 0, correct: 0, total: 0 };
      progress.subjects[subjectId].correct += row.isCorrect ? 1 : 0;
      progress.subjects[subjectId].total += 1;
      progress.subjects[subjectId].attempts += 1;
      progress.topics[topicKey] = progress.topics[topicKey] || { attempts: 0, correct: 0, total: 0, topicName: row.question.topic, subjectName: row.question.subject };
      progress.topics[topicKey].correct += row.isCorrect ? 1 : 0;
      progress.topics[topicKey].total += 1;
      progress.topics[topicKey].attempts += 1;
    });
    progress.recent.unshift({
      type: 'study',
      name: payload.name || 'Retry Wrong Questions',
      subject: payload.subject || 'Mixed',
      score: `${payload.correct}/${payload.total}`,
      date: formatDate(new Date())
    });
    progress.recent = progress.recent.slice(0, 12);
    saveProgress(progress);
  }


  async function startDailyChallenge(subjectIds) {
    const ids = (subjectIds || []).filter(Boolean);
    if (!ids.length) throw new Error('Select at least one subject for your challenge.');
    if (ids.length === 1) {
      return startDailyChallengeBySubject(ids[0], 5);
    }

    let pool = [];
    for (const subjectId of ids) {
      const subject = state.subjectMap.get(subjectId);
      if (!subject) continue;
      for (const topic of subject.topics) {
        const data = await loadTopic(subjectId, topic.id);
        pool.push(...(data.questions || []));
      }
    }
    if (!pool.length) throw new Error('No questions were found for the selected subjects.');

    const actualCount = Math.min(5, pool.length);
    const questions = shuffle(pool).slice(0, actualCount).map((q) => ({
      ...q,
      options: shuffle([...(q.options || [])])
    }));
    const selectedNames = ids.map((id) => state.subjectMap.get(id)?.name).filter(Boolean);

    writeStore(KEYS.daily, {
      date: new Date().toISOString(),
      subjects: ids,
      subjectNames: selectedNames,
      questions,
      selectedCount: actualCount,
      selectedSubjectName: selectedNames.join(' • ') || 'Mixed Subjects'
    });
    navigateWithLoader('./study.html?daily=1');
  }

  async function renderStudyPage() {
    const p = params();
    const retryMode = p.get('retry') === '1';
    const dailyMode = p.get('daily') === '1';
    const subjectId = p.get('subject');
    const topicId = p.get('topic');
    const setNumber = Number(p.get('set') || '1');
    const root = document.getElementById('pageRoot');

    let prepared = [];
    let subject = null;
    let topic = null;
    let panelTag = '';
    let panelTitle = '';
    let panelMuted = '';
    let backHref = './dashboard.html';
    let backLabel = 'Back';

    if (dailyMode) {
      const dailyData = readStore(KEYS.daily, null);
      const dailyQuestions = dailyData?.questions || [];
      if (!dailyQuestions.length) {
        root.innerHTML = '<div class="empty-state">No daily challenge found yet. Start one from the home page.</div>';
        return;
      }
      prepared = dailyQuestions.map((q) => ({ ...q, options: shuffle([...(q.options || [])]) }));
panelTag = 'Daily Challenge';
panelTitle = `${dailyQuestions.length} Question Challenge`;
panelMuted = (dailyData.subjectNames || []).join(' • ') || 'Selected subjects';
      backHref = './index.html';
      backLabel = 'Back to Home';
    } else if (retryMode) {
      const retryData = readStore(KEYS.retry, null);
      const retryQuestions = retryData?.questions || [];
      if (!retryQuestions.length) {
        root.innerHTML = '<div class="empty-state">No wrong-question retry session found yet.</div>';
        return;
      }
      prepared = shuffle(retryQuestions).map((q) => ({ ...q, options: shuffle([...(q.options || [])]) }));
      panelTag = 'Retry Session';
      panelTitle = retryData.title || 'Retry Wrong Questions';
      panelMuted = `${prepared.length} incorrect questions selected from your last review`;
      backHref = './review.html';
      backLabel = 'Back to Review';
    } else {
      subject = state.subjectMap.get(subjectId);
      topic = state.topicMap.get(`${subjectId}:${topicId}`);
      if (!subject || !topic) {
        root.innerHTML = '<div class="empty-state">Topic not found.</div>';
        return;
      }
      const data = await loadTopic(subjectId, topicId);
      prepared = prepareStudySet(data.questions || [], setNumber);
      if (!prepared.length) {
        root.innerHTML = '<div class="empty-state">This set does not contain questions.</div>';
        return;
      }
      panelTag = `Study Set ${setNumber}`;
      panelTitle = topic.name;
      panelMuted = subject.name;
      backHref = pageLink('./topic.html', { subject: subjectId, topic: topicId });
      backLabel = 'Back to Topic';
    }

    let index = 0;
    if (!retryMode && !dailyMode) {
      const continueState = getContinueState();
      if (p.get('resume') === '1' && continueState && continueState.subjectId === subjectId && continueState.topicId === topicId && Number(continueState.setNumber) === setNumber) {
        index = Math.min(Number(continueState.questionIndex) || 0, Math.max(prepared.length - 1, 0));
      }
    }
    const answers = {};

    root.innerHTML = `
      <div class="study-shell">
        <aside class="side-panel">
          <div class="sidebar-card">
            <div class="tag">${panelTag}</div>
            <h3>${panelTitle}</h3>
            <p class="muted">${panelMuted}</p>
            <div style="margin:14px 0 10px;" class="progress-bar"><div class="progress-fill" id="setProgressFill"></div></div>
            <div class="muted" id="setProgressText"></div>
          </div>
          <div class="sidebar-card">
            <h4>Rules</h4>
            <p class="muted">First choice locks immediately. Correct answer turns green, wrong choice turns red, and explanation appears right away.</p>
            <a class="btn btn-light" href="${backHref}">${backLabel}</a>
          </div>
        </aside>
        <section class="question-card" id="studyCard"></section>
      </div>
    `;

    const card = document.getElementById('studyCard');
    const progressFill = document.getElementById('setProgressFill');
    const progressText = document.getElementById('setProgressText');

    function drawQuestion() {
      const q = prepared[index];
      if (!retryMode && !dailyMode) {
        setContinueState({
          subjectId,
          subjectName: subject.name,
          topicId,
          topicName: topic.name,
          setNumber,
          questionIndex: index,
          totalQuestions: prepared.length
        });
      }
      const answered = answers[q.id];
      const saved = isSaved(q.id);
      const note = getNote(q.id);
      progressFill.style.width = `${((index + 1) / prepared.length) * 100}%`;
      progressText.textContent = `Question ${index + 1} of ${prepared.length}`;
      card.innerHTML = `
        <div class="question-top">
          <div>
            <div class="meta-row"><span class="badge">${q.difficulty.toUpperCase()}</span><span class="tag">${q.type}</span>${hasNote(q.id) ? '<span class="tag">Noted</span>' : ''}</div>
            <h2 class="question-title">${q.question}</h2>
          </div>
          <div class="question-tools">
            <button class="btn btn-light btn-note" id="toggleNoteBtn" type="button">${note ? 'Edit Note' : 'Add Note'}</button>
            <button class="star-btn ${saved ? 'is-saved' : ''}" id="saveBtn" title="Save question">★</button>
          </div>
        </div>
        ${q.caseScenario ? `<div class="case-box"><strong>Case</strong><div class="muted" style="margin-top:8px;">${q.caseScenario}</div></div>` : ''}
        ${q.imageUrl ? `<div style="margin-top:18px;"><img src="${q.imageUrl}" alt="Question visual" style="border-radius:22px; border:1px solid var(--border);"></div>` : ''}
        <div class="option-list" id="optionList"></div>
        <div class="explanation-box ${answered ? 'is-visible' : ''}" id="explanationBox">
          <strong>Explanation</strong>
          <div class="muted" style="margin-top:8px;">${answered ? q.explanation : ''}</div>
        </div>
        <div class="note-panel" id="noteBox" style="display:none;">
          <strong>Question Note</strong>
          <textarea class="textarea" id="noteInput" placeholder="Write your note here..." style="margin-top:10px;">${note}</textarea>
          <div class="action-row" style="justify-content:flex-start; margin-top:12px;">
            <button class="btn btn-dark" id="saveNoteBtn" type="button">Save Note</button>
            <button class="btn btn-light" id="cancelNoteBtn" type="button">Cancel</button>
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-light" id="prevBtn" ${index === 0 ? 'disabled' : ''}>Previous</button>
          <button class="btn btn-dark" id="nextBtn">${index === prepared.length - 1 ? 'Finish Set' : 'Next'}</button>
        </div>
      `;
      const optionList = document.getElementById('optionList');
      q.options.forEach((option) => {
        const btn = el('button', 'option-btn');
        btn.type = 'button';
        btn.textContent = option;
        if (answered) {
          btn.classList.add('locked');
          if (option === q.correctAnswer) btn.classList.add('correct');
          if (option === answered.selected && option !== q.correctAnswer) btn.classList.add('wrong');
        }
        btn.addEventListener('click', () => {
          if (answers[q.id]) return;
          const correct = option === q.correctAnswer;
          answers[q.id] = { selected: option, correct };
          drawQuestion();
        });
        optionList.appendChild(btn);
      });

      document.getElementById('saveBtn').addEventListener('click', () => {
        const on = toggleSaved(q);
        document.getElementById('saveBtn').classList.toggle('is-saved', on);
      });
      const noteBox = document.getElementById('noteBox');
      document.getElementById('toggleNoteBtn').addEventListener('click', () => {
        noteBox.style.display = noteBox.style.display === 'none' ? 'block' : 'none';
      });
      document.getElementById('saveNoteBtn').addEventListener('click', () => {
        setNote(q, document.getElementById('noteInput').value);
        drawQuestion();
      });
      document.getElementById('cancelNoteBtn').addEventListener('click', () => {
        noteBox.style.display = 'none';
      });
      document.getElementById('prevBtn').addEventListener('click', () => { if (index > 0) { index -= 1; drawQuestion(); } });
      document.getElementById('nextBtn').addEventListener('click', () => {
        if (index === prepared.length - 1) {
          finishSet();
        } else {
          index += 1;
          drawQuestion();
        }
      });
    }

    function finishSet() {
      const rows = prepared.map((q) => ({
        question: q,
        selected: answers[q.id]?.selected || 'No answer selected',
        correct: q.correctAnswer,
        isCorrect: !!answers[q.id]?.correct
      }));
      const correct = rows.filter((row) => row.isCorrect).length;
      if (dailyMode) {
        updateRetryProgress({
          rows,
          correct,
          total: rows.length,
          questionsSeen: rows.length,
          name: 'Daily Challenge',
          subject: 'Mixed'
        });
        writeStore(KEYS.review, {
          type: 'study',
          title: 'Daily Challenge Review',
          summary: { score: correct, total: rows.length, subject: 'Selected Subjects', topic: 'Daily Challenge' },
          rows,
          actions: { back: './index.html', backLabel: 'Back to Home' }
        });
      } else if (retryMode) {
        updateRetryProgress({
          rows,
          correct,
          total: rows.length,
          questionsSeen: rows.length,
          name: 'Retry Wrong Questions',
          subject: 'Mixed'
        });
        writeStore(KEYS.review, {
          type: 'study',
          title: 'Retry Wrong Questions Review',
          summary: { score: correct, total: rows.length, subject: 'Mixed', topic: 'Wrong Questions' },
          rows,
          actions: { back: './dashboard.html', backLabel: 'Back to Dashboard' }
        });
      } else {
        updateStudyProgress({
          subjectId, topicId: `${subjectId}:${topicId}`, topicName: topic.name, subjectName: subject.name,
          correct, total: rows.length, questionsSeen: rows.length
        });
        clearContinueState();
        writeStore(KEYS.review, {
          type: 'study',
          title: `${topic.name} • Set ${setNumber}`,
          summary: { score: correct, total: rows.length, subject: subject.name, topic: topic.name },
          rows,
          actions: { back: pageLink('./topic.html', { subject: subjectId, topic: topicId }), backLabel: 'Back to Topic' }
        });
      }
      navigateWithLoader('./review.html');
    }

    drawQuestion();
  }

  async function renderFinalExamPage() {
  const root = document.getElementById('pageRoot');
  await loadIndex();
  const subjects = state.index.subjects;
  const progress = getProgress();
  const overallAccuracy = progress.totalSelections
    ? Math.round((progress.correctSelections / progress.totalSelections) * 100)
    : 0;

  root.innerHTML = `
    <section class="hero hero-graphic-shell exam-hero">
      <span class="hero-chem hero-chem-a">RX • FINAL • EXAM</span>
      <span class="hero-chem hero-chem-b">Timed • Mixed • Review</span>
      <span class="hero-orb hero-orb-a"></span>
      <span class="hero-orb hero-orb-b"></span>

      <div class="hero-grid">
        <div>
          <span class="eyebrow">Pharmacy Nexus • Assessment Mode</span>
          <h1>Final Exam <span>Simulate the real pressure, then review deeply</span></h1>
          <p>
            Build a timed exam from one subject, selected topics, or a wider mixed pool.
            Answers stay hidden until submission, then you get a full performance review.
          </p>
        </div>

        <div class="hero-panel">
          <h3>Exam Snapshot</h3>
          <div class="stats-grid">
            <div class="stat-box">
              <div class="label">Completed Exams</div>
              <div class="value">${progress.finalExamsCompleted || 0}</div>
            </div>
            <div class="stat-box">
              <div class="label">Overall Accuracy</div>
              <div class="value">${overallAccuracy}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Subjects</div>
              <div class="value">${subjects.length}</div>
            </div>
            <div class="stat-box">
              <div class="label">Question Bank</div>
              <div class="value">${subjects.reduce((sum, s) => sum + (s.topics || []).reduce((a, t) => a + (t.questionCount || 0), 0), 0)}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section style="margin-top:28px;">
      <div class="summary-grid four">
        <div class="card summary-card">
          <div class="muted">Exam Style</div>
          <div class="big" style="font-size:1.15rem;">Timed</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Answer Reveal</div>
          <div class="big" style="font-size:1.15rem;">After Finish</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Review</div>
          <div class="big" style="font-size:1.15rem;">Detailed</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Retry Wrong</div>
          <div class="big" style="font-size:1.15rem;">Enabled</div>
        </div>
      </div>
    </section>

    <section style="margin-top:28px;">
      <div class="card exam-builder-card">
        <div class="section-header" style="margin-bottom:18px;">
          <div>
            <h2>Build Your Exam</h2>
            <p>Choose mode, difficulty, pool, and exam size before starting.</p>
          </div>
        </div>

        <div class="input-row two">
          <div>
            <label class="muted">Exam mode</label>
            <select class="select" id="examMode">
              <option value="multi">Multiple Subjects</option>
              <option value="single">Single Subject + Selected Topics</option>
            </select>
          </div>
          <div>
            <label class="muted">Difficulty</label>
            <select class="select" id="examDifficulty">
              <option value="all">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div class="input-row three" style="margin-top:16px;">
          <div>
            <label class="muted">Number of questions</label>
            <input class="input" id="examCount" type="number" min="5" value="20" />
          </div>
          <div>
            <label class="muted">Time limit (minutes)</label>
            <input class="input" id="examMinutes" type="number" min="5" value="30" />
          </div>
          <div class="panel exam-preview-panel">
            <strong id="poolCountLabel">Available pool: --</strong>
            <div class="muted" id="examEstimateText" style="margin-top:8px;">Choose your filters to preview the pool.</div>
          </div>
        </div>

        <div id="modeArea" style="margin-top:16px;"></div>

        <div class="exam-checklist" style="margin-top:18px;">
          <div class="check-item">Timed exam experience</div>
          <div class="check-item">Hidden answers until submission</div>
          <div class="check-item">Detailed review after finishing</div>
          <div class="check-item">Retry wrong questions later</div>
        </div>

        <div class="action-row" style="justify-content:flex-start; margin-top:22px;">
          <button class="btn btn-dark" id="startExamBtn" type="button">Start Final Exam</button>
          <button class="btn btn-light" id="previewExamBtn" type="button">Refresh Preview</button>
        </div>

        <div id="examMessage"></div>
      </div>
    </section>

    <section style="margin-top:28px;">
      <div id="examEngine"></div>
    </section>
  `;

  const engine = document.getElementById('examEngine');
  const modeSelect = document.getElementById('examMode');
  const modeArea = document.getElementById('modeArea');
  const difficultySelect = document.getElementById('examDifficulty');
  const examCountInput = document.getElementById('examCount');
  const examMinutesInput = document.getElementById('examMinutes');
  const poolCountLabel = document.getElementById('poolCountLabel');
  const examEstimateText = document.getElementById('examEstimateText');
  const examMessage = document.getElementById('examMessage');

  const drawMode = () => {
    if (modeSelect.value === 'multi') {
      modeArea.innerHTML = `
        <label class="muted">Subjects</label>
        <div class="input-row two">
          <label class="panel exam-radio-panel">
            <input type="radio" name="multiScope" value="all" checked />
            <div>
              <strong>All subjects</strong>
              <div class="muted">Pull questions from the whole available bank.</div>
            </div>
          </label>
          <label class="panel exam-radio-panel">
            <input type="radio" name="multiScope" value="single" />
            <div>
              <strong>One subject only</strong>
              <div class="muted">Build a focused final exam from one subject.</div>
            </div>
          </label>
        </div>

        <div style="margin-top:14px;">
          <label class="muted">Subject</label>
          <select class="select" id="multiSubjectSelect">
            ${subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
      `;

      document.querySelectorAll('input[name="multiScope"]').forEach((radio) => {
        radio.addEventListener('change', refreshPreview);
      });
      document.getElementById('multiSubjectSelect')?.addEventListener('change', refreshPreview);
    } else {
      modeArea.innerHTML = `
        <div>
          <label class="muted">Subject</label>
          <select class="select" id="singleSubjectSelect">
            ${subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div style="margin-top:14px;" id="topicCheckboxes"></div>
      `;

      const select = document.getElementById('singleSubjectSelect');

      const drawTopics = () => {
        const subject = state.subjectMap.get(select.value);
        document.getElementById('topicCheckboxes').innerHTML = `
          <label class="muted">Topics</label>
          <div class="analysis-grid exam-topic-grid" style="margin-top:10px;">
            ${(subject?.topics || []).map((topic) => `
              <label class="panel exam-topic-option">
                <input type="checkbox" value="${topic.id}" checked />
                <div>
                  <strong>${topic.name}</strong>
                  <div class="muted">${topic.questionCount || 0} questions</div>
                </div>
              </label>
            `).join('')}
          </div>
        `;
        document.querySelectorAll('#topicCheckboxes input').forEach((box) => {
          box.addEventListener('change', refreshPreview);
        });
      };

      select.addEventListener('change', () => {
        drawTopics();
        refreshPreview();
      });

      drawTopics();
    }
  };

  async function buildExamPool() {
    let pool = [];

    if (modeSelect.value === 'multi') {
      const scope = document.querySelector('input[name="multiScope"]:checked')?.value || 'all';
      const subjectIds = scope === 'all'
        ? subjects.map((s) => s.id)
        : [document.getElementById('multiSubjectSelect').value];

      for (const subjectId of subjectIds) {
        const subject = state.subjectMap.get(subjectId);
        for (const topic of (subject?.topics || [])) {
          const data = await loadTopic(subjectId, topic.id);
          pool.push(...(data.questions || []));
        }
      }
    } else {
      const subjectId = document.getElementById('singleSubjectSelect')?.value;
      const checkedTopics = [...document.querySelectorAll('#topicCheckboxes input:checked')].map((input) => input.value);

      if (!checkedTopics.length) {
        return [];
      }

      for (const topicId of checkedTopics) {
        const data = await loadTopic(subjectId, topicId);
        pool.push(...(data.questions || []));
      }
    }

    const difficulty = difficultySelect.value;
    if (difficulty !== 'all') {
      pool = pool.filter((q) => q.difficulty === difficulty);
    }

    return pool;
  }

  async function refreshPreview() {
    examMessage.innerHTML = '';
    poolCountLabel.textContent = 'Available pool: ...';
    examEstimateText.textContent = 'Checking your selected filters...';

    try {
      const pool = await buildExamPool();
      const requestedCount = Number(examCountInput.value || '20');
      const minutes = Number(examMinutesInput.value || '30');

      poolCountLabel.textContent = `Available pool: ${pool.length} question${pool.length === 1 ? '' : 's'}`;

      if (!pool.length) {
        examEstimateText.textContent = 'No questions match your current subject/topic/difficulty filters.';
        return;
      }

      const actualCount = Math.min(requestedCount, pool.length);
      const avgSeconds = Math.round((minutes * 60) / Math.max(actualCount, 1));

      examEstimateText.textContent =
        `You will get ${actualCount} question${actualCount === 1 ? '' : 's'} with about ${avgSeconds} sec/question based on your current time limit.`;
    } catch (error) {
      poolCountLabel.textContent = 'Available pool: --';
      examEstimateText.textContent = 'Could not preview the exam pool.';
      examMessage.innerHTML = `<div class="message error">${error.message}</div>`;
    }
  }

  modeSelect.addEventListener('change', async () => {
    drawMode();
    await refreshPreview();
  });

  difficultySelect.addEventListener('change', refreshPreview);
  examCountInput.addEventListener('input', refreshPreview);
  examMinutesInput.addEventListener('input', refreshPreview);
  document.getElementById('previewExamBtn').addEventListener('click', refreshPreview);

  drawMode();
  await refreshPreview();

  document.getElementById('startExamBtn').addEventListener('click', async () => {
    const count = Number(examCountInput.value || '20');
    const minutes = Number(examMinutesInput.value || '30');

    try {
      if (count < 5) throw new Error('Please choose at least 5 questions.');
      if (minutes < 5) throw new Error('Please choose at least 5 minutes.');

      const pool = await buildExamPool();
      if (!pool.length) throw new Error('No questions matched your exam filters.');

      const examQuestions = shuffle(pool)
        .slice(0, Math.min(count, pool.length))
        .map((q) => ({ ...q, options: [...q.options] }));

      document.querySelector('.exam-builder-card').classList.add('hidden');
      startExamEngine(engine, examQuestions, minutes);
    } catch (error) {
      examMessage.innerHTML = `<div class="message error">${error.message}</div>`;
    }
  });
}

function startExamEngine(container, questions, minutes) {
  let current = 0;
  const answers = {};
  let remaining = minutes * 60;
  let timerId = null;

  container.innerHTML = `
    <div class="study-shell exam-shell-upgraded">
      <aside class="side-panel">
        <div class="sidebar-card">
          <div class="tag">Final Exam</div>
          <div class="timer" id="examTimer"></div>
          <div class="muted">Time remaining</div>
        </div>

        <div class="sidebar-card">
          <div class="progress-bar">
            <div class="progress-fill" id="examProgressFill"></div>
          </div>
          <div class="muted" id="examProgressText" style="margin-top:10px;"></div>

          <div class="metric-list" style="margin-top:16px;">
            <div class="metric-row">
              <span>Answered</span>
              <strong id="answeredCount">0</strong>
            </div>
            <div class="metric-row">
              <span>Remaining</span>
              <strong id="remainingCount">${questions.length}</strong>
            </div>
            <div class="metric-row">
              <span>Total Questions</span>
              <strong>${questions.length}</strong>
            </div>
          </div>
        </div>

        <div class="sidebar-card">
          <h4 style="margin-top:0;">Question Palette</h4>
          <p class="muted" style="margin-bottom:12px;">Jump directly to any question.</p>
          <div class="exam-palette" id="examPalette"></div>
        </div>

        <div class="sidebar-card">
          <button class="btn btn-danger" id="submitExamSide" type="button" style="width:100%;">Submit Exam</button>
        </div>
      </aside>

      <section class="question-card" id="examCard"></section>
    </div>
  `;

  const timerEl = document.getElementById('examTimer');
  const progressFill = document.getElementById('examProgressFill');
  const progressText = document.getElementById('examProgressText');
  const answeredCountEl = document.getElementById('answeredCount');
  const remainingCountEl = document.getElementById('remainingCount');
  const palette = document.getElementById('examPalette');
  const card = document.getElementById('examCard');

  const drawTimer = () => {
    const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
    const secs = (remaining % 60).toString().padStart(2, '0');
    timerEl.textContent = `${mins}:${secs}`;
  };

  function drawPalette() {
    palette.innerHTML = '';
    questions.forEach((q, idx) => {
      const btn = el('button', `palette-btn ${idx === current ? 'is-current' : ''} ${answers[q.id] ? 'is-answered' : ''}`);
      btn.type = 'button';
      btn.textContent = idx + 1;
      btn.addEventListener('click', () => {
        current = idx;
        drawQuestion();
      });
      palette.appendChild(btn);
    });
  }

  function updateMeta() {
    const answeredCount = Object.keys(answers).length;
    progressFill.style.width = `${((current + 1) / questions.length) * 100}%`;
    progressText.textContent = `Question ${current + 1} of ${questions.length}`;
    answeredCountEl.textContent = answeredCount;
    remainingCountEl.textContent = Math.max(questions.length - answeredCount, 0);
    drawPalette();
  }

  drawTimer();
  timerId = setInterval(() => {
    remaining -= 1;
    drawTimer();

    if (remaining <= 0) {
      clearInterval(timerId);
      finishExam();
    }
  }, 1000);

  function drawQuestion() {
    const q = questions[current];
    updateMeta();

    card.innerHTML = `
      <div class="question-top">
        <div>
          <div class="meta-row">
            <span class="badge">${q.difficulty.toUpperCase()}</span>
            <span class="tag">${q.subject}</span>
            <span class="tag">${q.topic}</span>
            ${answers[q.id] ? '<span class="tag">Answered</span>' : '<span class="tag">Unanswered</span>'}
          </div>
          <h2 class="question-title">${q.question}</h2>
        </div>
      </div>

      ${q.caseScenario ? `
        <div class="case-box">
          <strong>Case</strong>
          <div class="muted" style="margin-top:8px;">${q.caseScenario}</div>
        </div>
      ` : ''}

      ${q.imageUrl ? `
        <div style="margin-top:18px;">
          <img src="${q.imageUrl}" alt="Question visual" style="border-radius:22px; border:1px solid var(--border);">
        </div>
      ` : ''}

      <div class="option-list" id="examOptionList"></div>

      <div class="action-row">
        <button class="btn btn-light" id="examPrev" ${current === 0 ? 'disabled' : ''}>Previous</button>

        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <button class="btn btn-light" id="clearAnswerBtn" ${answers[q.id] ? '' : 'disabled'}>Clear Answer</button>
          <button class="btn btn-danger" id="submitExam">Submit Exam</button>
          <button class="btn btn-dark" id="examNext">${current === questions.length - 1 ? 'Finish Reviewing' : 'Next'}</button>
        </div>
      </div>
    `;

    const list = document.getElementById('examOptionList');
    q.options.forEach((option) => {
      const button = el('button', 'option-btn');
      button.type = 'button';
      button.textContent = option;

      if (answers[q.id] === option) {
        button.classList.add('ghost-correct');
      }

      button.addEventListener('click', () => {
        answers[q.id] = option;
        drawQuestion();
      });

      list.appendChild(button);
    });

    document.getElementById('examPrev').addEventListener('click', () => {
      if (current > 0) {
        current -= 1;
        drawQuestion();
      }
    });

    document.getElementById('examNext').addEventListener('click', () => {
      if (current < questions.length - 1) {
        current += 1;
        drawQuestion();
      }
    });

    document.getElementById('clearAnswerBtn').addEventListener('click', () => {
      delete answers[q.id];
      drawQuestion();
    });

    document.getElementById('submitExam').addEventListener('click', () => {
      const unanswered = questions.length - Object.keys(answers).length;
      const text = unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`
        : 'Submit final exam now?';

      if (confirm(text)) finishExam();
    });
  }

  document.getElementById('submitExamSide').addEventListener('click', () => {
    const unanswered = questions.length - Object.keys(answers).length;
    const text = unanswered > 0
      ? `You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`
      : 'Submit final exam now?';

    if (confirm(text)) finishExam();
  });

  function finishExam() {
    clearInterval(timerId);

    const rows = questions.map((q) => ({
      question: q,
      selected: answers[q.id] || 'No answer selected',
      correct: q.correctAnswer,
      isCorrect: answers[q.id] === q.correctAnswer
    }));

    const correct = rows.filter((row) => row.isCorrect).length;
    const progress = getProgress();

    progress.finalExamsCompleted += 1;
    progress.correctSelections += correct;
    progress.totalSelections += rows.length;
    progress.recent.unshift({
      type: 'exam',
      name: 'Final Exam',
      subject: 'Mixed',
      score: `${correct}/${rows.length}`,
      date: formatDate(new Date())
    });
    progress.recent = progress.recent.slice(0, 12);

    rows.forEach((row) => {
      progress.subjects[row.question.subject] = progress.subjects[row.question.subject] || { attempts: 0, correct: 0, total: 0 };
      progress.subjects[row.question.subject].correct += row.isCorrect ? 1 : 0;
      progress.subjects[row.question.subject].total += 1;
      progress.subjects[row.question.subject].attempts += 1;

      const topicKey = `${row.question.subject}:${row.question.topic}`;
      progress.topics[topicKey] = progress.topics[topicKey] || {
        attempts: 0,
        correct: 0,
        total: 0,
        topicName: row.question.topic,
        subjectName: row.question.subject
      };
      progress.topics[topicKey].correct += row.isCorrect ? 1 : 0;
      progress.topics[topicKey].total += 1;
      progress.topics[topicKey].attempts += 1;
    });

    saveProgress(progress);

    const bySubject = {};
    const byTopic = {};

    rows.forEach((row) => {
      bySubject[row.question.subject] = bySubject[row.question.subject] || { correct: 0, total: 0 };
      bySubject[row.question.subject].total += 1;
      if (row.isCorrect) bySubject[row.question.subject].correct += 1;

      const topicKey = `${row.question.subject} • ${row.question.topic}`;
      byTopic[topicKey] = byTopic[topicKey] || { correct: 0, total: 0 };
      byTopic[topicKey].total += 1;
      if (row.isCorrect) byTopic[topicKey].correct += 1;
    });

    writeStore(KEYS.review, {
      type: 'exam',
      title: 'Final Exam Review',
      summary: { score: correct, total: rows.length, subjects: bySubject, topics: byTopic },
      rows,
      actions: { back: './final-exam.html', backLabel: 'Back to Final Exam' }
    });

    navigateWithLoader('./review.html');
  }

  drawQuestion();
}

  function renderReviewPage() {
    const data = readStore(KEYS.review, null);
    const root = document.getElementById('pageRoot');
    if (!data) {
      root.innerHTML = '<div class="empty-state">No review data found yet.</div>';
      return;
    }
    const rows = data.rows || [];
    const correct = data.summary.score;
    const total = data.summary.total;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    let analysis = '';
    if (data.type === 'exam') {
      const subjectRows = Object.entries(data.summary.subjects || {})
        .map(([name, stats]) => ({ name, pct: Math.round((stats.correct / stats.total) * 100), ...stats }))
        .sort((a, b) => b.pct - a.pct);
      const topicRows = Object.entries(data.summary.topics || {})
        .map(([name, stats]) => ({ name, pct: Math.round((stats.correct / stats.total) * 100), ...stats }))
        .sort((a, b) => a.pct - b.pct);
      analysis = `
        <div class="analysis-grid" style="margin-bottom:24px;">
          <div class="card"><h3 style="margin-top:0;">Strongest Areas</h3>${subjectRows.slice(0, 3).map((row) => `<div class="metric-row"><span>${row.name}</span><strong>${row.pct}%</strong></div>`).join('') || '<div class="muted">No data</div>'}</div>
          <div class="card"><h3 style="margin-top:0;">Needs Review</h3>${topicRows.slice(0, 4).map((row) => `<div class="metric-row"><span>${row.name}</span><strong>${row.pct}%</strong></div>`).join('') || '<div class="muted">No data</div>'}</div>
        </div>
      `;
    }

    root.innerHTML = `
      <div class="section-header"><div><h2>${data.title}</h2><p>Detailed performance review with your answers, the correct answers, and explanations.</p></div></div>
      <div class="summary-grid four" style="margin-bottom:24px;">
        <div class="card summary-card"><div class="muted">Score</div><div class="big">${correct}/${total}</div></div>
        <div class="card summary-card"><div class="muted">Percent</div><div class="big">${percent}%</div></div>
        <div class="card summary-card"><div class="muted">Correct</div><div class="big">${correct}</div></div>
        <div class="card summary-card"><div class="muted">Incorrect</div><div class="big">${total - correct}</div></div>
      </div>
      ${analysis}
      <div class="review-list" id="reviewList"></div>
      <div class="action-row" style="margin-top:22px; justify-content:flex-start;">
        ${rows.some((row) => !row.isCorrect) ? '<button class="btn btn-primary" id="retryWrongBtn" type="button">Retry Wrong Questions</button>' : ''}
        <a class="btn btn-light" href="${data.actions.back}">${data.actions.backLabel}</a>
        <a class="btn btn-dark" href="./dashboard.html">Go to Dashboard</a>
      </div>
    `;
    const list = document.getElementById('reviewList');
    const retryWrongBtn = document.getElementById('retryWrongBtn');
    if (retryWrongBtn) {
      retryWrongBtn.addEventListener('click', () => {
        const wrongQuestions = rows.filter((row) => !row.isCorrect).map((row) => row.question);
        writeStore(KEYS.retry, {
          title: data.title,
          type: data.type,
          questions: wrongQuestions,
          sourceBack: data.actions.back,
          sourceBackLabel: data.actions.backLabel
        });
        navigateWithLoader('./study.html?retry=1');
      });
    }
    rows.forEach((row, idx) => {
      const saved = isSaved(row.question.id);
      const note = getNote(row.question.id);
      const card = el('article', 'review-card');
      card.innerHTML = `
        <div class="question-top">
          <div>
            <div class="meta-row"><div class="review-status ${row.isCorrect ? 'correct' : 'wrong'}">${row.isCorrect ? 'Correct' : 'Incorrect'}</div>${note ? '<span class="tag">Noted</span>' : ''}</div>
            <h3 style="margin:10px 0 8px;">${idx + 1}. ${row.question.question}</h3>
          </div>
          <div class="question-tools">
            <button class="btn btn-light btn-note note-toggle-btn" type="button">${note ? 'Edit Note' : 'Add Note'}</button>
            <button class="star-btn ${saved ? 'is-saved' : ''}">★</button>
          </div>
        </div>
        ${row.question.caseScenario ? `<div class="case-box"><strong>Case</strong><div class="muted" style="margin-top:8px;">${row.question.caseScenario}</div></div>` : ''}
        <div class="review-answer"><strong>Your answer:</strong> ${row.selected}</div>
        <div class="review-answer"><strong>Correct answer:</strong> ${row.correct}</div>
        <div class="review-answer"><strong>Explanation:</strong> ${row.question.explanation}</div>
        <div class="note-panel review-note-box" style="display:none; margin-top:14px;">
          <strong>Question Note</strong>
          <textarea class="textarea review-note-input" style="margin-top:10px;" placeholder="Write your note here...">${note}</textarea>
          <div class="action-row" style="justify-content:flex-start; margin-top:12px;">
            <button class="btn btn-dark save-review-note" type="button">Save Note</button>
            <button class="btn btn-light cancel-review-note" type="button">Cancel</button>
          </div>
        </div>
      `;
      card.querySelector('.star-btn').addEventListener('click', (e) => {
        const on = toggleSaved(row.question);
        e.currentTarget.classList.toggle('is-saved', on);
      });
      const reviewNoteBox = card.querySelector('.review-note-box');
      card.querySelector('.note-toggle-btn').addEventListener('click', () => {
        reviewNoteBox.style.display = reviewNoteBox.style.display === 'none' ? 'block' : 'none';
      });
      card.querySelector('.save-review-note').addEventListener('click', () => {
        setNote(row.question, card.querySelector('.review-note-input').value);
        renderReviewPage();
      });
      card.querySelector('.cancel-review-note').addEventListener('click', () => {
        reviewNoteBox.style.display = 'none';
      });
      list.appendChild(card);
    });
  }

  function renderDashboardPage() {
    const progress = getProgress();
    const root = document.getElementById('pageRoot');
    const success = progress.totalSelections ? Math.round((progress.correctSelections / progress.totalSelections) * 100) : 0;
    const continueState = getContinueState();
    const savedCount = Object.keys(progress.savedBank || {}).length;
    const notesCount = Object.keys(progress.savedNotes || {}).length;

    const topicRows = Object.entries(progress.topics || {}).map(([key, topic]) => {
      const [subjectId, topicId] = key.split(':');
      const pct = topic.total ? Math.round((topic.correct / topic.total) * 100) : 0;
      return {
        ...topic,
        key,
        subjectId,
        topicId,
        pct,
        attempts: topic.attempts || 0,
        total: topic.total || 0,
        correct: topic.correct || 0
      };
    });

    const strengths = [...topicRows].sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 4);
    const weak = [...topicRows].sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 4);
    const recommendation = weak[0];

    const achievementItems = [
      { label: 'Studied 100 Questions', on: progress.studiedQuestions >= 100, meta: `${progress.studiedQuestions}/100` },
      { label: 'Completed 5 Study Sessions', on: progress.studySessions >= 5, meta: `${progress.studySessions}/5` },
      { label: 'Completed 3 Final Exams', on: progress.finalExamsCompleted >= 3, meta: `${progress.finalExamsCompleted}/3` },
      { label: 'Reached 80%+ Overall', on: success >= 80, meta: `${success}%` }
    ];

    const parseScore = (value) => {
      const match = String(value || '').match(/(\d+)\s*\/\s*(\d+)/);
      if (!match) return null;
      const correct = Number(match[1]);
      const total = Number(match[2]);
      if (!total) return null;
      return Math.round((correct / total) * 100);
    };

    const recent = Array.isArray(progress.recent) ? progress.recent : [];
    const recentFive = recent.slice(0, 5).map((item) => parseScore(item.score)).filter((n) => Number.isFinite(n));
    const previousFive = recent.slice(5, 10).map((item) => parseScore(item.score)).filter((n) => Number.isFinite(n));
    const avg = (items) => items.length ? Math.round(items.reduce((sum, n) => sum + n, 0) / items.length) : 0;
    const recentAvg = avg(recentFive);
    const previousAvg = avg(previousFive);
    const trendDelta = previousFive.length ? recentAvg - previousAvg : 0;

    const studyItems = recent.filter((item) => item.type === 'study');
    const examItems = recent.filter((item) => item.type === 'exam');
    const studyAvg = avg(studyItems.map((item) => parseScore(item.score)).filter((n) => Number.isFinite(n)));
    const examAvg = avg(examItems.map((item) => parseScore(item.score)).filter((n) => Number.isFinite(n)));

    const levelLabel = success >= 85 ? 'Excellent momentum' : success >= 70 ? 'Good momentum' : success >= 50 ? 'Building momentum' : 'Just getting started';
    const levelTone = success >= 85 ? 'is-great' : success >= 70 ? 'is-good' : success >= 50 ? 'is-fair' : 'is-starting';
    const trendLabel = previousFive.length
      ? trendDelta > 0
        ? `Up ${trendDelta}% from your previous sessions`
        : trendDelta < 0
          ? `Down ${Math.abs(trendDelta)}% from your previous sessions`
          : 'Stable compared with your previous sessions'
      : 'Complete more sessions to unlock trend tracking';

    const recommendationLink = recommendation
      ? pageLink('./topic.html', { subject: recommendation.subjectId, topic: recommendation.topicId })
      : pageLink('./subjects.html');

    const nextActionHref = continueState
      ? continueLink()
      : recommendation
        ? recommendationLink
        : pageLink('./subjects.html');

    const nextActionLabel = continueState
      ? 'Resume Study'
      : recommendation
        ? 'Review Weak Topic'
        : 'Explore Subjects';

    root.innerHTML = `
      <div class="dashboard-hero card">
        <div class="dashboard-hero-main">
          <div class="dashboard-eyebrow">Student Dashboard</div>
          <h2>Your performance at a glance</h2>
          <p class="muted">Provides continuous performance tracking, identifying core weaknesses and suggesting targeted interventions for optimization.</p>

          <div class="dashboard-score-ring-clean">
  <div class="dashboard-score-ring-track">
    <div class="dashboard-score-ring-fill" style="--score:${success};"></div>
    <div class="dashboard-score-ring-center">
      <strong>${success}%</strong>
      <span>OVERALL</span>
    </div>
  </div>
</div>

            <div class="dashboard-hero-copy">
              <div class="dashboard-status-chip ${levelTone}">${levelLabel}</div>
              <div class="dashboard-progress-block">
                <div class="metric-row">
                  <span>Overall mastery progress</span>
                  <strong>${success}%</strong>
                </div>
                <div class="dashboard-progress-bar">
                  <span style="width:${Math.max(success, 6)}%"></span>
                </div>
                <div class="dashboard-trend ${trendDelta > 0 ? 'is-up' : trendDelta < 0 ? 'is-down' : ''}">${trendLabel}</div>
              </div>
            </div>
          </div>

          <div class="dashboard-quick-actions">
            <a class="btn btn-primary" href="${nextActionHref}">${nextActionLabel}</a>
            <a class="btn btn-secondary" href="${recommendationLink}">Weakest Topic</a>
            <a class="btn btn-light" href="./saved.html">Saved & Notes</a>
          </div>
        </div>

        <div class="dashboard-hero-side">
       <div class="dashboard-side-card is-primary">
            <div class="muted">Recommended next move</div>
            ${
              recommendation
                ? `<h3>Review ${recommendation.topicName}</h3>
                   <p class="muted">${recommendation.subjectName} • ${recommendation.pct}% accuracy • ${recommendation.correct}/${recommendation.total} correct</p>
                   <a class="btn btn-dark" href="${recommendationLink}">Open Topic</a>`
                : `<h3>Start your first focused session</h3>
                   <p class="muted">Once you solve a few sets, your personalized recommendation will appear here.</p>
                   <a class="btn btn-dark" href="./subjects.html">Start Studying</a>`
            }
          </div>

          ${
            continueState
              ? `<div class="dashboard-side-card dashboard-side-soft">
                   <div class="muted">Continue where you left off</div>
                   <h3>${continueState.topicName}</h3>
                   <p class="muted">${continueState.subjectName} • Set ${continueState.setNumber} • Resume from question ${Math.min((continueState.questionIndex || 0) + 1, Math.max(continueState.totalQuestions || 1, 1))}</p>
                   <a class="btn btn-light" href="${continueLink()}">Resume Now</a>
                 </div>`
              : `<div class="dashboard-side-card dashboard-side-soft">
                   <div class="muted">Keep the streak alive</div>
                   <h3>Open a fresh study set</h3>
                   <p class="muted">Jump back into your subjects and keep the learning rhythm consistent.</p>
                   <a class="btn btn-light" href="./subjects.html">Browse Subjects</a>
                 </div>`
          }
        </div>
      </div>

      <div class="summary-grid four dashboard-summary-grid">
        <div class="card summary-card">
          <div class="muted">Overall Success Rate</div>
          <div class="big">${success}%</div>
          <div class="dashboard-card-sub">Across all tracked study and exam attempts</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Total Solved Questions</div>
          <div class="big">${progress.studiedQuestions}</div>
          <div class="dashboard-card-sub">Questions answered inside study and retry flows</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Study Sessions</div>
          <div class="big">${progress.studySessions}</div>
          <div class="dashboard-card-sub">Focused practice sessions completed</div>
        </div>
        <div class="card summary-card">
          <div class="muted">Final Exams Completed</div>
          <div class="big">${progress.finalExamsCompleted}</div>
          <div class="dashboard-card-sub">Timed mixed exams finished so far</div>
        </div>
      </div>

      <div class="dashboard-grid dashboard-main-grid" style="margin-top:24px;">
        <div class="dashboard-main-column">
          <div class="card dashboard-panel">
            <div class="dashboard-panel-head">
              <div>
                <h3>Performance breakdown</h3>
                <p class="muted">A cleaner read on what is going well and what needs recovery.</p>
              </div>
            </div>

            <div class="dashboard-split-grid">
              <div class="dashboard-topic-box">
                <div class="dashboard-box-title">Strength Areas</div>
                ${strengths.length ? strengths.map((row) => `
                  <div class="dashboard-topic-row is-strong">
                    <div class="dashboard-topic-copy">
                      <strong>${row.topicName}</strong>
                      <div class="muted">${row.subjectName} • ${row.correct}/${row.total} correct • ${row.attempts} session${row.attempts === 1 ? '' : 's'}</div>
                    </div>
                    <div class="dashboard-topic-score">
                      <span>${row.pct}%</span>
                      <div class="dashboard-mini-bar"><span style="width:${Math.max(row.pct, 6)}%"></span></div>
                    </div>
                  </div>
                `).join('') : '<div class="muted">No strong areas yet. Keep solving questions to build your performance map.</div>'}
              </div>

              <div class="dashboard-topic-box">
                <div class="dashboard-box-title">Weak Areas</div>
                ${weak.length ? weak.map((row) => `
                  <div class="dashboard-topic-row is-weak">
                    <div class="dashboard-topic-copy">
                      <strong>${row.topicName}</strong>
                      <div class="muted">${row.subjectName} • ${row.correct}/${row.total} correct • ${row.attempts} session${row.attempts === 1 ? '' : 's'}</div>
                    </div>
                    <div class="dashboard-topic-score">
                      <span>${row.pct}%</span>
                      <div class="dashboard-mini-bar"><span style="width:${Math.max(row.pct, 6)}%"></span></div>
                    </div>
                  </div>
                `).join('') : '<div class="muted">No weak areas tracked yet. Your first completed sessions will unlock this section.</div>'}
              </div>
            </div>
          </div>

          <div class="card dashboard-panel">
            <div class="dashboard-panel-head">
              <div>
                <h3>Recent activity</h3>
                <p class="muted">Your latest study sessions and final exam attempts.</p>
              </div>
            </div>

            ${recent.length ? `
              <div class="dashboard-activity-list">
                ${recent.slice(0, 6).map((item) => {
                  const scorePct = parseScore(item.score);
                  return `
                    <div class="dashboard-activity-item">
                      <div class="dashboard-activity-left">
                        <div class="dashboard-activity-icon">${item.type === 'exam' ? '📝' : '📘'}</div>
                        <div>
                          <strong>${item.name || item.type || 'Activity'}</strong>
                          <div class="muted">${item.subject || 'Mixed'} • ${item.date || ''}</div>
                        </div>
                      </div>
                      <div class="dashboard-activity-right">
                        <div class="dashboard-activity-badge">${item.score || '--'}</div>
                        <div class="dashboard-activity-pct">${scorePct !== null ? `${scorePct}%` : ''}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : '<div class="empty-state">No recent activity yet. Start your first study set to build momentum.</div>'}
          </div>
        </div>

        <div class="dashboard-side-column">
          <div class="card dashboard-panel">
            <div class="dashboard-panel-head">
              <div>
                <h3>Smart insights</h3>
                <p class="muted">Small signals that help you decide what to do next.</p>
              </div>
            </div>

            <div class="dashboard-insight-list">
              <div class="dashboard-insight-card">
                <span class="dashboard-insight-label">Last 5 sessions average</span>
                <strong>${recentFive.length ? `${recentAvg}%` : '--'}</strong>
              </div>
              <div class="dashboard-insight-card">
                <span class="dashboard-insight-label">Study sessions average</span>
                <strong>${studyItems.length ? `${studyAvg}%` : '--'}</strong>
              </div>
              <div class="dashboard-insight-card">
                <span class="dashboard-insight-label">Final exams average</span>
                <strong>${examItems.length ? `${examAvg}%` : '--'}</strong>
              </div>
              <div class="dashboard-insight-card">
                <span class="dashboard-insight-label">Saved questions</span>
                <strong>${savedCount}</strong>
              </div>
              <div class="dashboard-insight-card">
                <span class="dashboard-insight-label">Saved notes</span>
                <strong>${notesCount}</strong>
              </div>
            </div>
          </div>

          <div class="card dashboard-panel">
            <div class="dashboard-panel-head">
              <div>
                <h3>Achievements</h3>
                <p class="muted">Visible milestones that make the progress feel rewarding.</p>
              </div>
            </div>

            <div class="dashboard-achievement-list">
              ${achievementItems.map((item) => `
                <div class="dashboard-achievement ${item.on ? 'is-on' : ''}">
                  <div class="dashboard-achievement-icon">${item.on ? '🏅' : '⭕'}</div>
                  <div>
                    <strong>${item.label}</strong>
                    <div class="muted">${item.on ? 'Unlocked' : 'In progress'} • ${item.meta}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card dashboard-panel dashboard-cta-panel">
            <h3>Quick actions</h3>
            <p class="muted">Open the most useful next page in one tap.</p>
            <div class="dashboard-cta-stack">
              <a class="btn btn-primary" href="${nextActionHref}">${nextActionLabel}</a>
              <a class="btn btn-secondary" href="./final-exam.html">Start Final Exam</a>
              <a class="btn btn-light" href="./saved.html">Open Saved Questions</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSavedPage() {
    const progress = getProgress();
    const savedMap = progress.savedBank || {};
    const notesMap = progress.savedNotes || {};
    const mergedMap = {};

    Object.values(savedMap).forEach((q) => {
      mergedMap[q.id] = { ...q, isSaved: true, note: notesMap[q.id]?.note || '' };
    });
    Object.values(notesMap).forEach((q) => {
      mergedMap[q.id] = {
        ...(mergedMap[q.id] || q),
        ...q,
        isSaved: !!savedMap[q.id],
        note: q.note || ''
      };
    });

    const allItems = Object.values(mergedMap);
    const root = document.getElementById('pageRoot');
    const subjects = [...new Set(allItems.map((q) => q.subject).filter(Boolean))];
    const topics = [...new Set(allItems.map((q) => q.topic).filter(Boolean))];

    root.innerHTML = `
      <div class="section-header"><div><h2>Saved Questions</h2><p>Your starred questions and notes are stored locally in this browser for quick review later.</p></div></div>
      <div class="card" style="margin-bottom:20px;">
        <div class="action-row saved-filter-row" style="justify-content:flex-start; gap:10px; margin-top:0; margin-bottom:16px; flex-wrap:wrap;">
          <button class="btn btn-dark saved-filter-btn is-active" data-filter="all" type="button">All</button>
          <button class="btn btn-light saved-filter-btn" data-filter="starred" type="button">Starred</button>
          <button class="btn btn-light saved-filter-btn" data-filter="notes" type="button">Notes</button>
          <button class="btn btn-light saved-filter-btn" data-filter="both" type="button">Starred + Notes</button>
        </div>
        <div class="input-row three">
          <select class="select" id="savedSubjectFilter">
            <option value="all">All Subjects</option>
            ${subjects.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <select class="select" id="savedTopicFilter">
            <option value="all">All Topics</option>
            ${topics.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <input class="input" id="savedSearch" placeholder="Search saved questions or notes..." />
        </div>
      </div>
      <div class="saved-grid" id="savedGrid"></div>
    `;

    const grid = document.getElementById('savedGrid');
    const filterButtons = [...document.querySelectorAll('.saved-filter-btn')];
    const subjectFilter = document.getElementById('savedSubjectFilter');
    const topicFilter = document.getElementById('savedTopicFilter');
    const searchInput = document.getElementById('savedSearch');
    let activeFilter = 'all';

    function draw() {
      const subjectValue = subjectFilter.value;
      const topicValue = topicFilter.value;
      const term = searchInput.value.trim().toLowerCase();
      let rows = [...allItems];

      if (activeFilter === 'starred') rows = rows.filter((q) => q.isSaved);
      if (activeFilter === 'notes') rows = rows.filter((q) => (q.note || '').trim());
      if (activeFilter === 'both') rows = rows.filter((q) => q.isSaved && (q.note || '').trim());
      if (subjectValue !== 'all') rows = rows.filter((q) => q.subject === subjectValue);
      if (topicValue !== 'all') rows = rows.filter((q) => q.topic === topicValue);
      if (term) {
        rows = rows.filter((q) =>
          q.question.toLowerCase().includes(term) ||
          (q.note || '').toLowerCase().includes(term) ||
          (q.explanation || '').toLowerCase().includes(term)
        );
      }

      grid.innerHTML = '';
      if (!rows.length) {
        grid.innerHTML = '<div class="empty-state">No matching saved questions or notes found.</div>';
        return;
      }

      rows.forEach((q) => {
        const card = el('article', 'card');
        card.innerHTML = `
          <div class="question-top">
            <div>
              <div class="meta-row"><span class="badge">${q.subject}</span><span class="tag">${q.topic}</span>${q.note ? '<span class="tag">Noted</span>' : ''}</div>
              <h3 style="margin:0;">${q.question}</h3>
            </div>
            <div class="question-tools">
              <button class="btn btn-light btn-note saved-note-toggle" type="button">${q.note ? 'Edit Note' : 'Add Note'}</button>
              <button class="star-btn ${q.isSaved ? 'is-saved' : ''}" type="button">★</button>
            </div>
          </div>
          <div class="review-answer"><strong>Correct answer:</strong> ${q.correctAnswer}</div>
          <div class="review-answer"><strong>Explanation:</strong> ${q.explanation}</div>
          ${q.note ? `<div class="case-box" style="margin-top:14px;"><strong>Your note</strong><div class="muted" style="margin-top:8px;">${q.note}</div></div>` : ''}
          <div class="note-panel saved-note-box" style="display:none; margin-top:14px;">
            <strong>Question Note</strong>
            <textarea class="textarea saved-note-input" style="margin-top:10px;" placeholder="Write your note here...">${q.note || ''}</textarea>
            <div class="action-row" style="justify-content:flex-start; margin-top:12px;">
              <button class="btn btn-dark saved-note-save" type="button">Save Note</button>
              <button class="btn btn-light saved-note-cancel" type="button">Cancel</button>
              ${q.note ? '<button class="btn btn-danger saved-note-delete" type="button">Delete Note</button>' : ''}
            </div>
          </div>
          <div class="action-row" style="justify-content:flex-start; margin-top:16px;">
            <a class="btn btn-light" href="${pageLink('./topic.html', { subject: q.subject, topic: q.topic })}">Open Topic</a>
          </div>
        `;

        card.querySelector('.star-btn').addEventListener('click', (e) => {
          const on = toggleSaved(q);
          q.isSaved = on;
          e.currentTarget.classList.toggle('is-saved', on);
          draw();
        });

        const noteBox = card.querySelector('.saved-note-box');
        card.querySelector('.saved-note-toggle').addEventListener('click', () => {
          noteBox.style.display = noteBox.style.display === 'none' ? 'block' : 'none';
        });
        card.querySelector('.saved-note-save').addEventListener('click', () => {
          setNote(q, card.querySelector('.saved-note-input').value);
          draw();
        });
        card.querySelector('.saved-note-cancel').addEventListener('click', () => {
          noteBox.style.display = 'none';
        });
        const deleteBtn = card.querySelector('.saved-note-delete');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', () => {
            setNote(q, '');
            draw();
          });
        }

        grid.appendChild(card);
      });
    }

    filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        filterButtons.forEach((b) => {
          b.classList.remove('is-active', 'btn-dark');
          b.classList.add('btn-light');
        });
        btn.classList.add('is-active', 'btn-dark');
        btn.classList.remove('btn-light');
        draw();
      });
    });

    subjectFilter.addEventListener('change', draw);
    topicFilter.addEventListener('change', draw);
    searchInput.addEventListener('input', draw);
    draw();
  }

  function githubHeaders(token) {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }

  async function githubRequest(path, options = {}) {
    const settings = readStore(KEYS.github, null);
    if (!settings?.owner || !settings?.repo || !settings?.branch || !settings?.token) {
      throw new Error('GitHub settings are incomplete.');
    }
    const res = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`, {
      ...options,
      headers: { ...githubHeaders(settings.token), ...(options.headers || {}) }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'GitHub request failed');
    return json;
  }

  async function githubGetText(path) {
    const file = await githubRequest(path);
    const decoded = atob(file.content.replace(/\n/g, ''));
    return { text: decoded, sha: file.sha };
  }

  async function githubPutFile(path, content, message) {
    let sha;
    try { sha = (await githubRequest(path)).sha; } catch (_) { sha = undefined; }
    const settings = readStore(KEYS.github, null);
    return githubRequest(path, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: settings.branch,
        sha
      })
    });
  }

  async function githubDeleteFile(path, message) {
    const settings = readStore(KEYS.github, null);
    const file = await githubRequest(path);
    return githubRequest(path, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha: file.sha, branch: settings.branch })
    });
  }

  function injectAdmin() {
    const backdrop = document.getElementById('adminBackdrop');
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        openAdmin();
      }
    });

    function passwordMarkup(hasPass) {
      return `
        <div class="password-screen">
          <h2>${hasPass ? 'Enter Admin Password' : 'Create Admin Password'}</h2>
          <p class="muted">This password is stored locally in this browser only.</p>
          <input class="input" id="adminPassInput" type="password" placeholder="${hasPass ? 'Enter password' : 'Create password'}" />
          <div class="action-row" style="justify-content:flex-start; margin-top:16px;">
            <button class="btn btn-dark" id="adminPassBtn">${hasPass ? 'Unlock' : 'Save Password'}</button>
            <button class="btn btn-light" id="adminCancelBtn">Cancel</button>
          </div>
          <div id="adminPassMsg"></div>
        </div>
      `;
    }

    function openAdmin() {
      backdrop.classList.add('is-open');
      const currentPass = localStorage.getItem(KEYS.adminPass);
      backdrop.innerHTML = passwordMarkup(!!currentPass);
      document.getElementById('adminPassInput').focus();
      document.getElementById('adminCancelBtn').onclick = closeAdmin;
      const submit = () => {
        const input = document.getElementById('adminPassInput').value.trim();
        if (!input) return;
        if (!currentPass) {
          localStorage.setItem(KEYS.adminPass, input);
          renderAdminPanel();
        } else if (input === currentPass) {
          renderAdminPanel();
        } else {
          document.getElementById('adminPassMsg').innerHTML = '<div class="message error">Wrong password.</div>';
        }
      };
      document.getElementById('adminPassBtn').onclick = submit;
      document.getElementById('adminPassInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }

    function closeAdmin() {
      backdrop.classList.remove('is-open');
      backdrop.innerHTML = '';
    }

    function renderAdminPanel() {
      backdrop.innerHTML = `
        <div class="admin-modal">
          <aside class="admin-nav">
            <div>
              <div class="brand-mark" style="margin-bottom:12px;">PN</div>
              <strong style="font-size:1.35rem;">Admin Panel</strong>
              <div style="color:rgba(255,255,255,0.72); margin-top:6px;">Manage subjects, topics, and questions.</div>
            </div>
            <button class="is-active" data-tab="github">1. GitHub</button>
            <button data-tab="subject">2. Add Subject</button>
            <button data-tab="topic">3. Add Topic</button>
            <button data-tab="question">4. Add Question</button>
            <button id="adminClose" style="margin-top:auto; background:rgba(255,255,255,0.04); color:#ffb1b1;">Close</button>
          </aside>
          <section class="admin-content"><div id="adminTabContent"></div></section>
        </div>
      `;
      backdrop.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
        backdrop.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        drawAdminTab(btn.dataset.tab);
      }));
      document.getElementById('adminClose').onclick = closeAdmin;
      drawAdminTab('github');
    }

    function drawAdminTab(tab) {
      const box = document.getElementById('adminTabContent');
      if (tab === 'github') return drawGithubTab(box);
      if (tab === 'subject') return drawSubjectTab(box);
      if (tab === 'topic') return drawTopicTab(box);
      drawQuestionTab(box);
    }

    function drawGithubTab(box) {
      const settings = readStore(KEYS.github, { owner: '', repo: '', branch: 'main', token: '' });
      box.innerHTML = `
        <h2>GitHub Settings</h2>
        <p class="muted">Use your GitHub username or org as owner, exact repo name, exact branch name, and a Classic PAT with repo access.</p>
        <div class="input-row two">
          <input class="input" id="ghOwner" placeholder="Owner" value="${settings.owner || ''}" />
          <input class="input" id="ghRepo" placeholder="Repo" value="${settings.repo || ''}" />
        </div>
        <div class="input-row two" style="margin-top:16px;">
          <input class="input" id="ghBranch" placeholder="Branch" value="${settings.branch || 'main'}" />
          <input class="input" id="ghToken" placeholder="Classic PAT" value="${settings.token || ''}" />
        </div>
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;">
          <button class="btn btn-dark" id="ghSave">Save Settings</button>
          <button class="btn btn-light" id="ghTest">Test Connection</button>
        </div>
        <div id="ghMsg"></div>
      `;
      document.getElementById('ghSave').onclick = () => {
        const next = {
          owner: document.getElementById('ghOwner').value.trim(),
          repo: document.getElementById('ghRepo').value.trim(),
          branch: document.getElementById('ghBranch').value.trim(),
          token: document.getElementById('ghToken').value.trim()
        };
        writeStore(KEYS.github, next);
        document.getElementById('ghMsg').innerHTML = '<div class="message success">Settings saved in this browser.</div>';
      };
      document.getElementById('ghTest').onclick = async () => {
        try {
          const settingsNow = {
            owner: document.getElementById('ghOwner').value.trim(),
            repo: document.getElementById('ghRepo').value.trim(),
            branch: document.getElementById('ghBranch').value.trim(),
            token: document.getElementById('ghToken').value.trim()
          };
          writeStore(KEYS.github, settingsNow);
          const res = await fetch(`https://api.github.com/repos/${settingsNow.owner}/${settingsNow.repo}/branches/${settingsNow.branch}`, { headers: githubHeaders(settingsNow.token) });
          if (!res.ok) throw new Error('GitHub could not find this repo/branch. Check owner, repo, branch, and PAT access.');
          document.getElementById('ghMsg').innerHTML = '<div class="message success">Connection successful.</div>';
        } catch (error) {
          document.getElementById('ghMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };
    }

    function drawSubjectTab(box) {
      box.innerHTML = `
        <h2>Add Subject</h2>
        <p class="muted">Type the subject name only. The slug ID is created automatically.</p>
        <input class="input" id="subjectNameInput" placeholder="Subject name" />
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;"><button class="btn btn-dark" id="createSubjectBtn">Create Subject</button></div>
        <div id="subjectMsg"></div>
        <h3 style="margin-top:28px;">Delete Subject</h3>
        <select class="select" id="deleteSubjectSelect">${state.index.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;"><button class="btn btn-danger" id="deleteSubjectBtn">Delete Subject</button></div>
      `;
      document.getElementById('createSubjectBtn').onclick = async () => {
        const name = document.getElementById('subjectNameInput').value.trim();
        if (!name) return;
        try {
          const indexData = JSON.parse((await githubGetText('data/index.json')).text);
          const id = slugify(name);
          if (indexData.subjects.some((s) => s.id === id)) throw new Error('Subject already exists.');
          indexData.subjects.push({ id, name, topics: [] });
          await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Add subject ${name}`);
          document.getElementById('subjectMsg').innerHTML = '<div class="message success">Subject created. Refresh the page to load it locally.</div>';
        } catch (error) {
          document.getElementById('subjectMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };
      document.getElementById('deleteSubjectBtn').onclick = async () => {
        const subjectId = document.getElementById('deleteSubjectSelect').value;
        if (!subjectId || !confirm('Delete this subject and all its topic files?')) return;
        try {
          const indexFile = await githubGetText('data/index.json');
          const indexData = JSON.parse(indexFile.text);
          const subject = indexData.subjects.find((s) => s.id === subjectId);
          for (const topic of subject.topics) {
            await githubDeleteFile(topic.file, `Delete topic ${topic.name}`);
          }
          indexData.subjects = indexData.subjects.filter((s) => s.id !== subjectId);
          await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Delete subject ${subjectId}`);
          document.getElementById('subjectMsg').innerHTML = '<div class="message success">Subject deleted from GitHub.</div>';
        } catch (error) {
          document.getElementById('subjectMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };
    }

    function drawTopicTab(box) {
      box.innerHTML = `
        <h2>Add Topic</h2>
        <div class="input-row two">
          <select class="select" id="topicSubjectSelect">${state.index.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
          <input class="input" id="topicNameInput" placeholder="Topic name" />
        </div>
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;"><button class="btn btn-dark" id="createTopicBtn">Create Topic</button></div>
        <div id="topicMsg"></div>
        <h3 style="margin-top:28px;">Delete Topic</h3>
        <div class="input-row two">
          <select class="select" id="deleteTopicSubject"></select>
          <select class="select" id="deleteTopicSelect"></select>
        </div>
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;"><button class="btn btn-danger" id="deleteTopicBtn">Delete Topic</button></div>
      `;
      const deleteSubject = document.getElementById('deleteTopicSubject');
      const deleteTopic = document.getElementById('deleteTopicSelect');
      deleteSubject.innerHTML = state.index.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
      const syncTopics = () => {
        const subject = state.subjectMap.get(deleteSubject.value);
        deleteTopic.innerHTML = subject.topics.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
      };
      deleteSubject.addEventListener('change', syncTopics);
      syncTopics();

      document.getElementById('createTopicBtn').onclick = async () => {
        const subjectId = document.getElementById('topicSubjectSelect').value;
        const topicName = document.getElementById('topicNameInput').value.trim();
        if (!topicName) return;
        try {
          const indexData = JSON.parse((await githubGetText('data/index.json')).text);
          const subject = indexData.subjects.find((s) => s.id === subjectId);
          const topicId = slugify(topicName);
          if (subject.topics.some((t) => t.id === topicId)) throw new Error('Topic already exists.');
          const filePath = `data/${subjectId}/${topicId}.json`;
          subject.topics.push({ id: topicId, name: topicName, file: filePath, questionCount: 0 });
          await githubPutFile(filePath, JSON.stringify({ questions: [] }, null, 2), `Create topic file ${topicName}`);
          await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Add topic ${topicName}`);
          document.getElementById('topicMsg').innerHTML = '<div class="message success">Topic created on GitHub.</div>';
        } catch (error) {
          document.getElementById('topicMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };

      document.getElementById('deleteTopicBtn').onclick = async () => {
        const subjectId = deleteSubject.value;
        const topicId = deleteTopic.value;
        if (!topicId || !confirm('Delete this topic and its file?')) return;
        try {
          const indexData = JSON.parse((await githubGetText('data/index.json')).text);
          const subject = indexData.subjects.find((s) => s.id === subjectId);
          const topic = subject.topics.find((t) => t.id === topicId);
          await githubDeleteFile(topic.file, `Delete topic ${topic.name}`);
          subject.topics = subject.topics.filter((t) => t.id !== topicId);
          await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Delete topic ${topicId}`);
          document.getElementById('topicMsg').innerHTML = '<div class="message success">Topic deleted from GitHub.</div>';
        } catch (error) {
          document.getElementById('topicMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };
    }

    function drawQuestionTab(box) {
      box.innerHTML = `
        <h2>Add Question</h2>
        <div class="input-row two">
          <select class="select" id="qSubject"></select>
          <select class="select" id="qTopic"></select>
        </div>
        <div class="input-row two" style="margin-top:16px;">
          <select class="select" id="qType"><option value="mcq">MCQ</option><option value="true-false">True / False</option><option value="image">Image Question</option><option value="case">Clinical Case Question</option></select>
          <select class="select" id="qDifficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
        </div>
        <textarea class="textarea" id="qText" placeholder="Question text" style="margin-top:16px;"></textarea>
        <textarea class="textarea" id="qCase" placeholder="Case scenario (optional)" style="margin-top:16px;"></textarea>
        <input class="input" id="qImage" placeholder="Image URL (optional)" style="margin-top:16px;" />
        <div class="input-row two" style="margin-top:16px;"><input class="input" id="qA" placeholder="Option A" /><input class="input" id="qB" placeholder="Option B" /></div>
        <div class="input-row two" style="margin-top:16px;"><input class="input" id="qC" placeholder="Option C" /><input class="input" id="qD" placeholder="Option D" /></div>
        <select class="select" id="qCorrect" style="margin-top:16px;"><option value="A">Correct = Option A</option><option value="B">Correct = Option B</option><option value="C">Correct = Option C</option><option value="D">Correct = Option D</option></select>
        <textarea class="textarea" id="qExplanation" placeholder="Explanation" style="margin-top:16px;"></textarea>
        <div class="action-row" style="justify-content:flex-start; margin-top:16px;"><button class="btn btn-dark" id="addQuestionBtn">Add Question</button></div>
        <div id="questionMsg"></div>
        <h3 style="margin-top:28px;">Delete Question</h3>
        <div class="input-row two"><select class="select" id="delQSubject"></select><select class="select" id="delQTopic"></select></div>
        <div class="list-box" id="questionDeleteList"></div>
      `;
      const qSubject = document.getElementById('qSubject');
      const qTopic = document.getElementById('qTopic');
      const delQSubject = document.getElementById('delQSubject');
      const delQTopic = document.getElementById('delQTopic');
      const fillSubjectOptions = (select) => { select.innerHTML = state.index.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join(''); };
      fillSubjectOptions(qSubject); fillSubjectOptions(delQSubject);
      const syncTopicOptions = (subjectSelect, topicSelect) => {
        const subject = state.subjectMap.get(subjectSelect.value);
        topicSelect.innerHTML = subject.topics.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
      };
      const renderDeleteList = async () => {
        const subjectId = delQSubject.value; const topicId = delQTopic.value;
        if (!subjectId || !topicId) return;
        const meta = state.topicMap.get(`${subjectId}:${topicId}`);
        let data;
        try {
          data = JSON.parse((await githubGetText(meta.file)).text);
        } catch (_) {
          data = await getJSON(`./${meta.file}`);
        }
        const boxList = document.getElementById('questionDeleteList');
        boxList.innerHTML = data.questions.length ? '' : '<div class="empty-state">No questions in this topic.</div>';
        data.questions.slice(0, 50).forEach((q) => {
          const row = el('div', 'list-item');
          row.innerHTML = `<div><strong>${q.id}</strong><div class="muted">${q.question.slice(0, 90)}</div></div><button class="small-btn danger">Delete</button>`;
          row.querySelector('button').addEventListener('click', async () => {
            if (!confirm('Delete this question from GitHub?')) return;
            try {
              const file = await githubGetText(meta.file);
              const json = JSON.parse(file.text);
              json.questions = json.questions.filter((item) => item.id !== q.id);
              await githubPutFile(meta.file, JSON.stringify(json, null, 2), `Delete question ${q.id}`);
              const indexData = JSON.parse((await githubGetText('data/index.json')).text);
              const subject = indexData.subjects.find((s) => s.id === subjectId);
              const topic = subject.topics.find((t) => t.id === topicId);
              topic.questionCount = json.questions.length;
              await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Update count for ${topicId}`);
              row.remove();
            } catch (error) {
              document.getElementById('questionMsg').innerHTML = `<div class="message error">${error.message}</div>`;
            }
          });
          boxList.appendChild(row);
        });
      };
      qSubject.addEventListener('change', () => syncTopicOptions(qSubject, qTopic));
      delQSubject.addEventListener('change', async () => { syncTopicOptions(delQSubject, delQTopic); await renderDeleteList(); });
      delQTopic.addEventListener('change', renderDeleteList);
      syncTopicOptions(qSubject, qTopic); syncTopicOptions(delQSubject, delQTopic); renderDeleteList();

      document.getElementById('addQuestionBtn').onclick = async () => {
        try {
          const subjectId = qSubject.value;
          const topicId = qTopic.value;
          const meta = state.topicMap.get(`${subjectId}:${topicId}`);
          const file = await githubGetText(meta.file);
          const json = JSON.parse(file.text);
          const options = [document.getElementById('qA').value.trim(), document.getElementById('qB').value.trim(), document.getElementById('qC').value.trim(), document.getElementById('qD').value.trim()];
          if (options.some((o) => !o)) throw new Error('All 4 options are required.');
          const correctIndex = { A: 0, B: 1, C: 2, D: 3 }[document.getElementById('qCorrect').value];
          const question = {
            id: `${subjectId}-${topicId}-${Date.now()}`,
            type: document.getElementById('qType').value,
            subject: subjectId,
            topic: topicId,
            question: document.getElementById('qText').value.trim(),
            options,
            correctAnswer: options[correctIndex],
            explanation: document.getElementById('qExplanation').value.trim(),
            difficulty: document.getElementById('qDifficulty').value,
            caseScenario: document.getElementById('qCase').value.trim(),
            imageUrl: document.getElementById('qImage').value.trim()
          };
          if (!question.question || !question.explanation) throw new Error('Question text and explanation are required.');
          json.questions.push(question);
          await githubPutFile(meta.file, JSON.stringify(json, null, 2), `Add question ${question.id}`);
          const indexData = JSON.parse((await githubGetText('data/index.json')).text);
          const subject = indexData.subjects.find((s) => s.id === subjectId);
          const topic = subject.topics.find((t) => t.id === topicId);
          topic.questionCount = json.questions.length;
          await githubPutFile('data/index.json', JSON.stringify(indexData, null, 2), `Update count for ${topicId}`);
          document.getElementById('questionMsg').innerHTML = '<div class="message success">Question added to GitHub.</div>';
          renderDeleteList();
        } catch (error) {
          document.getElementById('questionMsg').innerHTML = `<div class="message error">${error.message}</div>`;
        }
      };
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeAdmin(); });
  }

  async function boot() {
    ensureShell();
    await loadIndex();
    injectAdmin();
    if (PAGE === 'home') renderHome(state.index);
    else if (PAGE === 'subjects') renderSubjectsPage(state.index);
    else if (PAGE === 'topics') renderTopicsPage();
    else if (PAGE === 'topic') await renderTopicPage();
    else if (PAGE === 'study') await renderStudyPage();
    else if (PAGE === 'final-exam') await renderFinalExamPage();
    else if (PAGE === 'review') renderReviewPage();
    else if (PAGE === 'dashboard') renderDashboardPage();
    else if (PAGE === 'saved') renderSavedPage();
    bindRouteLinks(document);
    setTimeout(() => hideRouteLoader(), 80);
  }

  boot().catch((error) => {
    const root = document.getElementById('pageRoot') || document.body;
    root.innerHTML = `<div class="container"><div class="message error">${error.message}</div></div>`;
    console.error(error);
  });
})();
