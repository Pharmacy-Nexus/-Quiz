(() => {
  'use strict';

  const PAGE = document.body.dataset.page || 'home';
  const SET_SIZE = 30;
  const KEYS = {
    progress: 'pn_progress_v4',
    saved: 'pn_saved_v4',
    review: 'pn_review_v4',
    daily: 'pn_daily_v4',
    exam: 'pn_exam_v4',
    customBank: 'pn_custom_bank_v1'
  };

  const state = {
    index: null,
    subjects: new Map(),
    topics: new Map(),
    topicCache: new Map(),
    customBank: null,
  };

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const params = () => new URLSearchParams(location.search);
  const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const formatDate = (d) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const byId = (id) => document.getElementById(id);
  const label = (s='') => s.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

  function pageHref(file, query = {}) {
    const u = new URL(file, location.href);
    Object.entries(query).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
    return `${u.pathname.split('/').pop()}${u.search}`;
  }

  function getProgress() {
    return read(KEYS.progress, {
      studiedQuestions: 0,
      studySessions: 0,
      finalExamsCompleted: 0,
      correctSelections: 0,
      totalSelections: 0,
      subjects: {},
      topics: {},
      recent: [],
      continueStudy: null,
      savedBank: {},
      savedNotes: {}
    });
  }
  function saveProgress(v) { write(KEYS.progress, v); }
  function getSavedIds() { return read(KEYS.saved, []); }
  function setSavedIds(v) { write(KEYS.saved, v); }
  function isSaved(id) { return getSavedIds().includes(id); }
  function getAccuracy(correct, total) { return total ? Math.round((correct / total) * 100) : 0; }

  function getCustomBank() {
    if (state.customBank) return state.customBank;
    state.customBank = read(KEYS.customBank, []);
    return state.customBank;
  }
  function saveCustomBank(v) { state.customBank = v; write(KEYS.customBank, v); }

  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  async function loadIndex() {
    if (state.index) return state.index;
    const index = await getJSON('./data/index.json');
    const custom = getCustomBank();
    if (custom.length) {
      custom.forEach((q) => {
        let subject = index.subjects.find(s => s.id === q.subject);
        if (!subject) {
          subject = { id: q.subject, name: q.subjectName || label(q.subject), topics: [] };
          index.subjects.push(subject);
        }
        let topic = subject.topics.find(t => t.id === q.topic);
        if (!topic) {
          topic = { id: q.topic, name: q.topicName || label(q.topic), file: `__custom__/${q.subject}:${q.topic}`, questionCount: 0 };
          subject.topics.push(topic);
        }
        topic.questionCount += 1;
      });
    }
    state.index = index;
    state.subjects.clear();
    state.topics.clear();
    index.subjects.forEach(subject => {
      state.subjects.set(subject.id, subject);
      subject.topics.forEach(topic => state.topics.set(`${subject.id}:${topic.id}`, { ...topic, subjectId: subject.id, subjectName: subject.name }));
    });
    return index;
  }

  async function loadTopic(subjectId, topicId) {
    const key = `${subjectId}:${topicId}`;
    if (state.topicCache.has(key)) return state.topicCache.get(key);
    const meta = state.topics.get(key);
    if (!meta) throw new Error('Topic not found');
    let data;
    if (meta.file.startsWith('__custom__/')) {
      data = { questions: getCustomBank().filter(q => q.subject === subjectId && q.topic === topicId) };
    } else {
      data = await getJSON(`./${meta.file}`);
      const custom = getCustomBank().filter(q => q.subject === subjectId && q.topic === topicId);
      if (custom.length) data.questions.push(...custom);
    }
    state.topicCache.set(key, data);
    return data;
  }

  function findQuestionById(id) {
    const progress = getProgress();
    return progress.savedBank?.[id] || progress.savedNotes?.[id] || null;
  }

  function toggleSaved(question) {
    const ids = getSavedIds();
    const next = ids.includes(question.id) ? ids.filter(i => i !== question.id) : [...ids, question.id];
    setSavedIds(next);
    const progress = getProgress();
    progress.savedBank ||= {};
    if (next.includes(question.id)) progress.savedBank[question.id] = question;
    else delete progress.savedBank[question.id];
    saveProgress(progress);
    return next.includes(question.id);
  }
  function getNote(id) { return getProgress().savedNotes?.[id]?.note || ''; }
  function setNote(question, note) {
    const progress = getProgress();
    progress.savedNotes ||= {};
    if (!note.trim()) delete progress.savedNotes[question.id];
    else progress.savedNotes[question.id] = { ...question, note: note.trim() };
    saveProgress(progress);
  }

  function setContinueState(payload) {
    const progress = getProgress();
    progress.continueStudy = { ...payload, updatedAt: Date.now() };
    saveProgress(progress);
  }
  function clearContinueState() {
    const progress = getProgress();
    delete progress.continueStudy;
    saveProgress(progress);
  }
  function continueLink() {
    const c = getProgress().continueStudy;
    return c ? pageHref('study.html', { subject: c.subjectId, topic: c.topicId, set: c.setNumber, resume: 1 }) : '';
  }

  function updateSessionProgress(rows, summary) {
    const progress = getProgress();
    const correct = rows.filter(r => r.isCorrect).length;
    progress.studiedQuestions += rows.length;
    progress.studySessions += summary.type === 'exam' ? 0 : 1;
    progress.finalExamsCompleted += summary.type === 'exam' ? 1 : 0;
    progress.correctSelections += correct;
    progress.totalSelections += rows.length;
    rows.forEach(row => {
      const sk = row.question.subject;
      const tk = `${row.question.subject}:${row.question.topic}`;
      progress.subjects[sk] ||= { attempts: 0, correct: 0, total: 0, subjectName: row.question.subjectName || label(sk) };
      progress.topics[tk] ||= { attempts: 0, correct: 0, total: 0, topicName: row.question.topicName || label(row.question.topic), subjectName: row.question.subjectName || label(sk) };
      progress.subjects[sk].attempts += 1;
      progress.subjects[sk].total += 1;
      progress.subjects[sk].correct += row.isCorrect ? 1 : 0;
      progress.topics[tk].attempts += 1;
      progress.topics[tk].total += 1;
      progress.topics[tk].correct += row.isCorrect ? 1 : 0;
    });
    progress.recent.unshift({
      type: summary.type,
      name: summary.name,
      subject: summary.subject,
      score: `${correct}/${rows.length}`,
      accuracy: getAccuracy(correct, rows.length),
      date: formatDate(new Date())
    });
    progress.recent = progress.recent.slice(0, 12);
    saveProgress(progress);
    return progress;
  }

  function topicStatus(subjectId, topicId, totalQuestions = 0) {
    const stats = getProgress().topics?.[`${subjectId}:${topicId}`];
    const answered = Math.min(stats?.total || 0, totalQuestions || stats?.total || 0);
    const accuracy = getAccuracy(stats?.correct || 0, stats?.total || 0);
    const completion = totalQuestions ? Math.min(100, Math.round((answered / totalQuestions) * 100)) : 0;
    if (!stats || !stats.total) return { label: 'Not Started', accuracy: 0, completion: 0, cls: 'not-started' };
    if (answered >= totalQuestions) return { label: accuracy >= 85 ? 'Mastered' : 'Completed', accuracy, completion: 100, cls: 'completed' };
    return { label: 'In Progress', accuracy, completion, cls: 'progress' };
  }

  function topbar() {
    const active = PAGE;
    const menu = [
      ['index.html','Home'],['subjects.html','Subjects'],['dashboard.html','Dashboard'],['saved.html','Saved & Notes'],['final-exam.html','Final Exam']
    ];
    return `
      <header class="topbar">
        <div class="container topbar-inner">
          <button class="menu-btn" id="menuBtn">☰</button>
          <a class="brand" href="index.html"><span class="brand-icon">⚗️</span><span>Pharmacy Nexus</span></a>
          <nav class="top-links">
            ${menu.map(([href,label]) => `<a class="${(active==='home'&&href==='index.html')||href.startsWith(active)?'is-active':''}" href="${href}">${label}</a>`).join('')}
          </nav>
          <div class="page-copy">
            <span>${({home:'Structured Learning',subjects:'Structured Navigation',topics:'Subject Breakdown',topic:'Focused Practice',study:'Interactive Practice','final-exam':'Timed Simulation',saved:'Knowledge Bank',dashboard:'Student Dashboard',review:'Review'}[PAGE]||'Pharmacy Nexus').toUpperCase()}</span>
            <strong>${({home:'Home',subjects:'Subjects',topics:'Topics',topic:'Topic Sets',study:'Study Session','final-exam':'Final Exam',saved:'Saved & Notes',dashboard:'Dashboard',review:'Review'}[PAGE]||'Pharmacy Nexus')}</strong>
          </div>
        </div>
      </header>
      <aside class="drawer" id="drawer">
        <div class="drawer-panel">
          <div class="drawer-head"><strong>Pharmacy Nexus</strong><button id="closeDrawer">×</button></div>
          ${menu.map(([href,label]) => `<a href="${href}" class="drawer-link">${label}</a>`).join('')}
          <a href="admin.html" class="drawer-link subtle">Admin</a>
        </div>
      </aside>`;
  }

  function layout(content) {
    const app = byId('app');
    app.innerHTML = `${topbar()}<main class="page"><div class="container">${content}</div></main><footer class="site-footer"><div class="container"><strong>Contact: pharmacynexusofficial@gmail.com</strong><div>For feedback, collaboration, or educational contributions, feel free to contact us.</div></div></footer>`;
    byId('menuBtn')?.addEventListener('click',()=>byId('drawer').classList.add('open'));
    byId('closeDrawer')?.addEventListener('click',()=>byId('drawer').classList.remove('open'));
    byId('drawer')?.addEventListener('click',(e)=>{ if(e.target.id==='drawer') e.target.classList.remove('open'); });
  }

  async function renderHome() {
    const index = await loadIndex();
    const progress = getProgress();
    const totalQuestions = index.subjects.reduce((sum,s)=>sum+s.topics.reduce((a,t)=>a+t.questionCount,0),0);
    const accuracy = getAccuracy(progress.correctSelections, progress.totalSelections);
    const c = progress.continueStudy;
    layout(`
      <section class="hero-card">
        <div class="hero-grid">
          <div>
            <span class="eyebrow">Pharmacy Nexus • Structured Learning</span>
            <h1>Your Ultimate Pharmacy Learning Platform <span>Built for Future Pharmacists</span></h1>
            <p>Move subject by subject, topic by topic, study in clear 30-question sets, review every attempt in detail, and finish with a polished final exam workflow.</p>
            <div class="cta-row"><a class="btn gold" href="subjects.html">Explore Subjects</a><a class="btn light" href="final-exam.html">Go to Final Exam</a><a class="btn white" href="auth.html">Sign In</a></div>
            <div class="mini-stats"><div><strong>${index.subjects.length}</strong><span>Subjects</span></div><div><strong>${totalQuestions}</strong><span>Questions</span></div><div><strong>${accuracy}%</strong><span>Accuracy</span></div></div>
          </div>
          <div class="hero-panel">
            <h3>Focused. Clean. Expandable.</h3>
            <p>Study sets, instant feedback, saved questions, final exam review, dashboard tracking, and hidden admin management inside one lightweight static build.</p>
            <div class="glass-grid"><div><span>Saved Questions</span><strong>${Object.keys(progress.savedBank||{}).length}</strong></div><div><span>Notes</span><strong>${Object.keys(progress.savedNotes||{}).length}</strong></div><div><span>Final Exams</span><strong>${progress.finalExamsCompleted}</strong></div><div><span>Accuracy</span><strong>${accuracy}%</strong></div></div>
          </div>
        </div>
      </section>
      ${c ? `<section class="panel continue-card"><div><div class="pill-row"><span class="pill gold">Continue</span><span class="pill">${c.subjectName}</span></div><h3>Resume ${c.topicName}</h3><p>You stopped at question ${Math.min((c.questionIndex||0)+1,c.totalQuestions||1)} in set ${c.setNumber}.</p></div><a class="btn dark" href="${continueLink()}">Resume Now</a></section>` : ''}
      <section class="section-head"><h2>Browse Subjects</h2><a href="subjects.html">See All Subjects</a></section>
      <section class="subject-rail">${index.subjects.map((s,i)=>`<a class="subject-card" href="${pageHref('topics.html',{subject:s.id})}"><div class="subject-top"><span class="tiny-pill">0${i+1}</span><span class="tiny-pill alt">${['Core','Dosage Forms','Practice'][i]||'Subject'}</span></div><div class="subject-icon">${['💊','🧪','🩺'][i]||'📘'}</div><h3>${s.name}</h3><p>${s.topics.length} topics • ${s.topics.reduce((a,t)=>a+t.questionCount,0)} questions</p><span class="inline-link">Open Subject →</span></a>`).join('')}</section>
      <section class="section-head"><h2>Daily Challenge</h2></section>
      <section class="daily-card panel dark-panel">
        <div class="pill-row"><span class="pill whiteish">Daily Spin</span><span class="pill whiteish">Premium Hybrid</span></div>
        <h3>Spin the Subject Wheel</h3>
        <p>The wheel updates automatically when you add new subjects. Then generate a lucky question count from 1 to the smart maximum.</p>
        <div class="wheel-wrap"><div class="wheel-pointer"></div><div class="wheel" id="wheel"></div></div>
        <div class="wheel-result" id="wheelResult">Press spin</div>
        <div class="center-row"><button class="btn white" id="spinSubject">Spin Subject</button></div>
        <div class="lucky-card"><div>Lucky Number</div><strong id="luckyNumber">?</strong><small id="luckyMeta">Spin a subject first.</small></div>
        <div class="daily-summary"><div><span>Selected Subject</span><strong id="dailySubjectName">—</strong></div><div><span>Questions</span><strong id="dailyCount">—</strong></div></div>
        <button class="btn gold start-daily" id="startDaily" disabled>Start Daily Challenge</button>
      </section>
      <section class="section-head"><h2>Recent Activity</h2></section>
      <section class="panel recent-panel">${(progress.recent||[]).slice(0,4).map(item=>`<div class="recent-row"><div><strong>${item.name}</strong><span>${item.subject} • ${item.date}</span></div><div class="score-badge">${item.score}</div></div>`).join('') || '<div class="empty">No recent activity yet.</div>'}</section>
    `);
    initDailyWheel(index.subjects);
  }

  function initDailyWheel(subjects) {
    const wheel = byId('wheel'); if (!wheel) return;
    const colors = ['#173d77','#20488b','#0f2d5a'];
    const count = subjects.length;
    const stops = subjects.map((s,i)=>`${colors[i%colors.length]} ${i*(360/count)}deg ${(i+1)*(360/count)}deg`).join(',');
    wheel.style.background = `conic-gradient(${stops})`;
    wheel.innerHTML = subjects.map((s,i)=>`<span class="wheel-label" style="transform:rotate(${(i*360/count)+180/count}deg) translateY(-116px) rotate(${90}deg)">${s.name}</span>`).join('');
    let selected = null, dailyCount = null, rotation = 0;
    byId('spinSubject').onclick = () => {
      const idx = Math.floor(Math.random()*subjects.length);
      selected = subjects[idx];
      const target = 360*5 + (360 - ((idx + 0.5) * (360/count)));
      rotation = target;
      wheel.style.transform = `rotate(${rotation}deg)`;
      byId('wheelResult').textContent = selected.name;
      const max = Math.min(10, selected.topics.reduce((a,t)=>a+t.questionCount,0));
      let n = 1, ticks = 0;
      const interval = setInterval(()=>{ n = Math.floor(Math.random()*max)+1; byId('luckyNumber').textContent = n; ticks++; if (ticks>16){ clearInterval(interval); dailyCount = n; byId('luckyMeta').textContent = `Challenge will use ${dailyCount} question${dailyCount>1?'s':''}.`; byId('dailySubjectName').textContent = selected.name; byId('dailyCount').textContent = dailyCount; byId('startDaily').disabled = false; } }, 75);
    };
    byId('startDaily').onclick = async () => {
      if (!selected || !dailyCount) return;
      let pool = [];
      for (const t of selected.topics) {
        const data = await loadTopic(selected.id, t.id); pool.push(...data.questions);
      }
      const questions = shuffle(pool).slice(0,dailyCount).map(q=>({ ...q, options: shuffle(q.options) }));
      write(KEYS.daily,{ subjectId:selected.id, subjectName:selected.name, questions, count:dailyCount, date:Date.now() });
      location.href = 'study.html?daily=1';
    };
  }

  async function renderSubjects() {
    const index = await loadIndex();
    layout(`
      <section class="headline"><h1>Subjects</h1><p>Browse your pharmacy subjects, check topic coverage, and open any subject to start studying.</p></section>
      <section class="panel filter-panel"><div><label>Search subjects</label><input id="subjectSearch" class="field" placeholder="Type a subject name..." /></div><div class="summary-box"><strong id="subjectCount">${index.subjects.length} subjects</strong><span>Open a subject to explore topics and start study sets.</span></div></section>
      <section id="subjectGrid" class="card-grid"></section>
    `);
    const grid = byId('subjectGrid');
    const draw = (term='') => {
      const items = index.subjects.filter(s=>s.name.toLowerCase().includes(term.toLowerCase()));
      byId('subjectCount').textContent = `${items.length} subject${items.length!==1?'s':''}`;
      grid.innerHTML = items.map(s=>`<article class="panel info-card"><span class="pill">Subject</span><h3>${s.name}</h3><p>${s.topics.length} topics available for structured study.</p><div class="metric-mini"><div><span>Topics</span><strong>${s.topics.length}</strong></div><div><span>Questions</span><strong>${s.topics.reduce((a,t)=>a+t.questionCount,0)}</strong></div></div><a class="btn dark" href="${pageHref('topics.html',{subject:s.id})}">Open Topics</a></article>`).join('') || '<div class="empty">No subjects found.</div>';
    };
    draw();
    byId('subjectSearch').addEventListener('input',e=>draw(e.target.value));
  }

  async function renderTopics() {
    const subjectId = params().get('subject');
    await loadIndex();
    const subject = state.subjects.get(subjectId);
    if (!subject) return layout('<div class="empty">Subject not found.</div>');
    const total = subject.topics.reduce((a,t)=>a+t.questionCount,0);
    layout(`
      <section class="headline"><h1>${subject.name}</h1><p>Browse topics, check coverage, and open any topic to start studying in structured sets.</p></section>
      <section class="stats-four"><div class="panel"><span>Topics</span><strong>${subject.topics.length}</strong></div><div class="panel"><span>Question Bank</span><strong>${total}</strong></div><div class="panel"><span>Study Mode</span><strong>Structured Sets</strong></div></section>
      <section class="panel filter-panel"><div><label>Search topics</label><input id="topicSearch" class="field" placeholder="Type a topic name..."/></div><div class="summary-box"><strong id="topicCount">${subject.topics.length} topics</strong><span>Open a topic to choose study sets or launch practice.</span></div></section>
      <section id="topicGrid" class="card-grid"></section>
    `);
    const grid = byId('topicGrid');
    const draw = (term='') => {
      const items = subject.topics.filter(t=>t.name.toLowerCase().includes(term.toLowerCase()));
      byId('topicCount').textContent = `${items.length} topics`;
      grid.innerHTML = items.map(t=>{const st=topicStatus(subjectId,t.id,t.questionCount);return `<article class="panel info-card"><div class="row-between"><span class="pill">Topic</span><span class="status-chip ${st.cls}">${st.label}</span></div><h3>${t.name}</h3><p>${t.questionCount} questions available across ${Math.ceil(t.questionCount/SET_SIZE)} study sets.</p><div class="metric-mini"><div><span>Questions</span><strong>${t.questionCount}</strong></div><div><span>Sets</span><strong>${Math.ceil(t.questionCount/SET_SIZE)}</strong></div></div><div class="pill-row"><span class="pill ${st.cls}">${st.label}</span>${st.accuracy?`<span class="pill">${st.accuracy}% Accuracy</span>`:''}${st.completion?`<span class="pill">${st.completion}% Complete</span>`:''}</div><a class="btn dark" href="${pageHref('topic.html',{subject:subjectId,topic:t.id})}">Open Topic</a></article>`;}).join('') || '<div class="empty">No topics found.</div>';
    };
    draw();
    byId('topicSearch').addEventListener('input',e=>draw(e.target.value));
  }

  async function renderTopicPage() {
    const p = params();
    await loadIndex();
    const subject = state.subjects.get(p.get('subject'));
    const meta = state.topics.get(`${p.get('subject')}:${p.get('topic')}`);
    if (!subject || !meta) return layout('<div class="empty">Topic not found.</div>');
    const data = await loadTopic(subject.id, meta.id);
    const q = data.questions;
    const diff = { easy:0, medium:0, hard:0 }; q.forEach(x=>diff[x.difficulty]=(diff[x.difficulty]||0)+1);
    const st = topicStatus(subject.id, meta.id, q.length);
    const c = getProgress().continueStudy;
    layout(`
      <section class="headline"><h1>${meta.name}</h1><p>${subject.name} • ${q.length} questions • choose a study set below.</p><div class="pill-row"><span class="pill ${st.cls}">${st.label}</span>${st.accuracy?`<span class="pill">${st.accuracy}% Accuracy</span>`:''}${st.completion?`<span class="pill">${st.completion}% Complete</span>`:''}</div></section>
      <section class="stats-four"><div class="panel"><span>Easy</span><strong>${diff.easy}</strong></div><div class="panel"><span>Medium</span><strong>${diff.medium}</strong></div><div class="panel"><span>Hard</span><strong>${diff.hard}</strong></div><div class="panel"><span>Status</span><strong>${st.label}</strong></div></section>
      ${(c && c.subjectId===subject.id && c.topicId===meta.id) ? `<section class="panel continue-card"><div><div class="pill-row"><span class="pill gold">Continue This Topic</span><span class="pill">Set ${c.setNumber}</span></div><h3>Resume ${meta.name}</h3><p>You last stopped at question ${Math.min((c.questionIndex||0)+1,c.totalQuestions||1)} in this topic.</p></div><a class="btn dark" href="${continueLink()}">Resume</a></section>`:''}
      <section class="panel"><h2>Study Sets</h2><p>Questions are automatically split into sets of 30. Inside each set, both question order and answer order are shuffled every time.</p><div class="set-grid">${Array.from({length:Math.ceil(q.length/SET_SIZE)},(_,i)=>{const start=i*SET_SIZE+1,end=Math.min((i+1)*SET_SIZE,q.length);return `<div class="set-card"><span class="pill">Set ${i+1}</span><h3>Questions ${start} - ${end}</h3><p>${end-start+1} questions in this set.</p><a class="btn dark" href="${pageHref('study.html',{subject:subject.id,topic:meta.id,set:i+1})}">Start Set</a></div>`;}).join('')}</div></section>
    `);
  }

  async function renderStudyPage() {
    const p = params();
    await loadIndex();
    let questions = [], title = '', subtitle = '', back = 'subjects.html', mode='study';
    let continuePayload = null;
    if (p.get('daily')==='1') {
      const daily = read(KEYS.daily, null);
      if (!daily?.questions?.length) return layout('<div class="empty">No daily challenge found yet.</div>');
      questions = daily.questions.map(q=>({ ...q, options: shuffle(q.options) }));
      title = 'Daily Challenge'; subtitle = daily.subjectName; back='index.html'; mode='daily';
    } else if (p.get('exam')==='1') {
      const exam = read(KEYS.exam, null);
      if (!exam?.questions?.length) return layout('<div class="empty">No exam session found.</div>');
      renderExamMode(exam);
      return;
    } else {
      const subjectId=p.get('subject'),topicId=p.get('topic'), setNumber = Number(p.get('set')||1);
      const subject = state.subjects.get(subjectId), meta = state.topics.get(`${subjectId}:${topicId}`);
      if (!subject || !meta) return layout('<div class="empty">Topic not found.</div>');
      const data = await loadTopic(subjectId, topicId);
      const chunk = data.questions.slice((setNumber-1)*SET_SIZE, setNumber*SET_SIZE);
      questions = shuffle(chunk).map(q=>({ ...q, options: shuffle(q.options) }));
      title = meta.name; subtitle = subject.name; back = pageHref('topic.html',{subject:subjectId,topic:topicId});
      continuePayload = { subjectId, subjectName: subject.name, topicId, topicName: meta.name, setNumber, totalQuestions: questions.length };
    }
    let idx = 0; const answers = {};
    layout(`<section class="study-layout"><aside class="study-side"><div class="panel"><span class="pill">${mode==='study'?'Study Set '+(p.get('set')||1):title}</span><h3>${mode==='study'?title:title}</h3><p>${subtitle}</p><div class="progress"><div id="studyProgressBar"></div></div><small id="studyProgressText"></small></div><div class="panel"><h3>Rules</h3><p>First choice locks immediately. Correct answer turns green, wrong choice turns red, and explanation appears right away.</p><a class="btn white" href="${back}">Back to Topic</a></div></aside><section class="panel question-panel" id="questionPanel"></section></section>`);

    const draw = () => {
      const q = questions[idx];
      if (continuePayload) setContinueState({ ...continuePayload, questionIndex: idx });
      byId('studyProgressBar').style.width = `${((idx+1)/questions.length)*100}%`;
      byId('studyProgressText').textContent = `Question ${idx+1} of ${questions.length}`;
      const chosen = answers[q.id];
      byId('questionPanel').innerHTML = `
        <div class="pill-row"><span class="pill ${q.difficulty}">${q.difficulty.toUpperCase()}</span><span class="pill">${q.type}</span></div>
        <h2>${q.question}</h2>
        <div class="action-row left"><button class="btn white" id="noteToggle">${getNote(q.id)?'Edit Note':'Add Note'}</button><button class="star ${isSaved(q.id)?'saved':''}" id="saveStar">★</button></div>
        ${q.caseScenario ? `<div class="case-box"><strong>Case</strong><p>${q.caseScenario}</p></div>`:''}
        <div class="options">${q.options.map(opt=>{let cls=''; if(chosen){ if(opt===q.correctAnswer) cls='correct'; else if(opt===chosen.selected) cls='wrong'; } return `<button class="option ${cls} ${chosen?'locked':''}">${opt}</button>`;}).join('')}</div>
        ${chosen ? `<div class="explain"><strong>Explanation</strong><p>${q.explanation}</p></div>`:''}
        <div id="noteBox" class="note-box ${getNote(q.id)?'open':''}" style="display:none;"><textarea id="noteInput" class="field textarea" placeholder="Write your note here...">${getNote(q.id)}</textarea><div class="action-row left"><button class="btn dark" id="saveNote">Save Note</button><button class="btn white" id="cancelNote">Cancel</button></div></div>
        <div class="action-row"><button class="btn white" id="prevBtn" ${idx===0?'disabled':''}>Previous</button><button class="btn dark" id="nextBtn">${idx===questions.length-1?'Finish Set':'Next'}</button></div>`;
      qsa('.option', byId('questionPanel')).forEach((btn, i) => btn.onclick = () => {
        if (answers[q.id]) return;
        answers[q.id] = { selected: q.options[i], isCorrect: q.options[i] === q.correctAnswer };
        draw();
      });
      byId('saveStar').onclick = () => { toggleSaved(q); draw(); };
      byId('noteToggle').onclick = ()=>{ const b=byId('noteBox'); b.style.display=b.style.display==='none'?'block':'none'; };
      byId('saveNote').onclick = ()=>{ setNote(q, byId('noteInput').value); byId('noteBox').style.display='none'; draw(); };
      byId('cancelNote').onclick = ()=> byId('noteBox').style.display='none';
      byId('prevBtn').onclick = ()=>{ if(idx>0){ idx--; draw(); }};
      byId('nextBtn').onclick = ()=>{ if(idx===questions.length-1) finish(); else { idx++; draw(); }};
    };
    const finish = () => {
      const rows = questions.map(q=>({ question:q, selected: answers[q.id]?.selected || 'No answer selected', isCorrect: !!answers[q.id]?.isCorrect }));
      updateSessionProgress(rows, { type: mode==='study'?'study':mode, name: title, subject: subtitle });
      if (continuePayload) clearContinueState();
      write(KEYS.review, { title: `${title} Review`, subject: subtitle, rows, type: mode, back });
      location.href = 'review.html';
    };
    draw();
  }

  function renderReviewPage() {
    const data = read(KEYS.review, null);
    if (!data?.rows?.length) return layout('<div class="empty">No review data available yet.</div>');
    const correct = data.rows.filter(r=>r.isCorrect).length;
    const wrongRows = data.rows.filter(r=>!r.isCorrect).map(r=>r.question);
    layout(`
      <section class="headline"><h1>${data.title}</h1><p>${data.subject} • ${correct}/${data.rows.length} correct • ${getAccuracy(correct,data.rows.length)}% accuracy</p></section>
      <section class="stats-four"><div class="panel"><span>Correct</span><strong>${correct}</strong></div><div class="panel"><span>Wrong</span><strong>${data.rows.length-correct}</strong></div><div class="panel"><span>Accuracy</span><strong>${getAccuracy(correct,data.rows.length)}%</strong></div></section>
      <section class="action-row left review-top-actions"><a class="btn white" href="${data.back||'dashboard.html'}">Back</a>${wrongRows.length?'<button class="btn gold" id="retryWrong">Retry Wrong Questions</button>':''}</section>
      <section class="stack">${data.rows.map((r,idx)=>`<article class="panel review-card"><div class="row-between"><div class="pill-row"><span class="pill">Question ${idx+1}</span><span class="pill ${r.isCorrect?'completed':'wrong'}">${r.isCorrect?'Correct':'Wrong'}</span></div></div><h3>${r.question.question}</h3><div class="review-row"><strong>Your answer:</strong> <span>${r.selected}</span></div><div class="review-row"><strong>Correct answer:</strong> <span>${r.question.correctAnswer}</span></div><div class="review-row"><strong>Explanation:</strong> <span>${r.question.explanation}</span></div></article>`).join('')}</section>
    `);
    byId('retryWrong')?.addEventListener('click',()=>{ write(KEYS.daily,{ subjectName:'Retry Wrong Questions', questions: wrongRows, count: wrongRows.length, date: Date.now() }); location.href='study.html?daily=1'; });
  }

  async function renderFinalExamPage() {
    const examMode = params().get('mode') === 'exam';
    if (examMode) return renderExamMode(read(KEYS.exam, null));
    await loadIndex();
    const progress = getProgress();
    const total = state.index.subjects.reduce((a,s)=>a+s.topics.reduce((b,t)=>b+t.questionCount,0),0);
    layout(`
      <section class="exam-hero"><div class="exam-hero-main"><span class="eyebrow">Pharmacy Nexus • Assessment Mode</span><h1>Final Exam <span>Simulate the real pressure, then review deeply</span></h1><p>Build a timed exam from one subject, selected topics, or a wider mixed pool. Answers stay hidden until submission, then you get a full performance review.</p></div><div class="exam-snapshot"><h3>Exam Snapshot</h3><div class="glass-grid"><div><span>Completed Exams</span><strong>${progress.finalExamsCompleted}</strong></div><div><span>Overall Accuracy</span><strong>${getAccuracy(progress.correctSelections,progress.totalSelections)}%</strong></div><div><span>Subjects</span><strong>${state.index.subjects.length}</strong></div><div><span>Question Bank</span><strong>${total}</strong></div></div></div></section>
      <section class="stats-four exam-badges"><div class="panel"><span>Exam Style</span><strong>Timed</strong></div><div class="panel"><span>Answer Reveal</span><strong>After Finish</strong></div><div class="panel"><span>Review</span><strong>Detailed</strong></div><div class="panel"><span>Retry Wrong</span><strong>Enabled</strong></div></section>
      <section class="panel build-exam"><h2>Build Your Exam</h2><p>Choose mode, difficulty, pool, and exam size before starting.</p><div class="form-grid"><div><label>Exam mode</label><select id="examModeSel" class="field"><option value="all">All subjects</option><option value="single">One subject only</option></select></div><div><label>Difficulty</label><select id="examDiff" class="field"><option value="all">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div><div><label>Number of questions</label><input id="examCount" class="field" type="number" value="20" min="5" max="100" /></div><div><label>Time limit (minutes)</label><input id="examMinutes" class="field" type="number" value="30" min="5" max="180" /></div><div class="full"><label>Subject</label><select id="examSubject" class="field">${state.index.subjects.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div></div><div class="action-row left"><button class="btn dark" id="startExamBtn">Start Final Exam</button></div></section>
    `);
    byId('examModeSel').onchange = ()=> byId('examSubject').parentElement.style.display = byId('examModeSel').value==='single'?'block':'none';
    byId('examModeSel').dispatchEvent(new Event('change'));
    byId('startExamBtn').onclick = async ()=>{
      const mode = byId('examModeSel').value, diff=byId('examDiff').value, count=Number(byId('examCount').value||20), minutes=Number(byId('examMinutes').value||30);
      let pool=[];
      const chosenSubjects = mode==='single' ? [state.subjects.get(byId('examSubject').value)] : state.index.subjects;
      for (const s of chosenSubjects) for (const t of s.topics){ const d=await loadTopic(s.id,t.id); pool.push(...d.questions); }
      if (diff!=='all') pool = pool.filter(q=>q.difficulty===diff);
      pool = shuffle(pool).slice(0, Math.min(count,pool.length)).map(q=>({ ...q, options: shuffle(q.options) }));
      write(KEYS.exam, { questions: pool, minutes, startedAt: Date.now(), mode, diff, current:0, answers:{} });
      location.href = 'study.html?exam=1';
    };
  }

  function renderExamMode(exam) {
    if (!exam?.questions?.length) return layout('<div class="empty">No exam session found.</div>');
    let idx = exam.current || 0; const answers = exam.answers || {};
    layout(`
      <section class="exam-hero compact"><div class="exam-hero-main"><span class="eyebrow">Timed Simulation</span><h1>Final Exam</h1></div></section>
      <section class="exam-mode"><aside class="panel exam-side"><div class="timer" id="timerBox"></div><div class="progress"><div id="examProgress"></div></div><small id="examCountText"></small><div class="palette" id="palette"></div><button class="btn danger full" id="submitExam">Submit Exam</button></aside><section class="panel question-panel" id="examQuestion"></section></section>
    `);
    const deadline = exam.startedAt + exam.minutes * 60 * 1000;
    const tick = ()=>{ const ms=Math.max(0, deadline-Date.now()); const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000); byId('timerBox').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; if(ms<=0){ clearInterval(timerInt); submit(); } };
    const timerInt = setInterval(tick,1000); tick();
    const drawPalette=()=>{ byId('palette').innerHTML = exam.questions.map((q,i)=>`<button class="pal ${i===idx?'active':''} ${answers[q.id]?'done':''}" data-i="${i}">${i+1}</button>`).join(''); qsa('.pal',byId('palette')).forEach(b=>b.onclick=()=>{ idx=Number(b.dataset.i); exam.current=idx; write(KEYS.exam,exam); draw(); });};
    const draw=()=>{ const q = exam.questions[idx]; byId('examProgress').style.width=`${((idx+1)/exam.questions.length)*100}%`; byId('examCountText').textContent=`Question ${idx+1} of ${exam.questions.length}`; byId('examQuestion').innerHTML=`<div class="pill-row"><span class="pill ${q.difficulty}">${q.difficulty.toUpperCase()}</span><span class="pill">${q.subject}</span><span class="pill">${q.topic}</span></div><h2>${q.question}</h2><div class="options">${q.options.map((o,i)=>`<button class="option ${answers[q.id]===o?'selected':''}">${o}</button>`).join('')}</div><div class="action-row"><button class="btn white" id="examPrev" ${idx===0?'disabled':''}>Previous</button><button class="btn white" id="clearAns">Clear Answer</button><button class="btn danger" id="submitNow">Submit Exam</button><button class="btn dark" id="examNext">${idx===exam.questions.length-1?'Last Question':'Next'}</button></div>`;
      qsa('.option',byId('examQuestion')).forEach((b,i)=>b.onclick=()=>{ answers[q.id]=q.options[i]; exam.answers=answers; write(KEYS.exam,exam); drawPalette(); draw(); });
      byId('examPrev').onclick=()=>{ if(idx>0){ idx--; exam.current=idx; write(KEYS.exam,exam); draw(); }};
      byId('examNext').onclick=()=>{ if(idx<exam.questions.length-1){ idx++; exam.current=idx; write(KEYS.exam,exam); draw(); }};
      byId('clearAns').onclick=()=>{ delete answers[q.id]; exam.answers=answers; write(KEYS.exam,exam); drawPalette(); draw(); };
      byId('submitNow').onclick=submit;
      drawPalette();
    };
    const submit=()=>{ clearInterval(timerInt); const rows = exam.questions.map(q=>({ question:q, selected: answers[q.id] || 'No answer selected', isCorrect: answers[q.id]===q.correctAnswer })); updateSessionProgress(rows,{ type:'exam', name:'Final Exam', subject:'Mixed' }); write(KEYS.review,{ title:'Final Exam Review', subject:'Mixed', rows, type:'exam', back:'final-exam.html' }); localStorage.removeItem(KEYS.exam); location.href='review.html'; };
    byId('submitExam').onclick=submit; draw();
  }

  function renderSavedPage() {
    const progress = getProgress();
    const savedMap = progress.savedBank || {}; const noteMap = progress.savedNotes || {};
    const merged = {};
    Object.values(savedMap).forEach(q => merged[q.id] = { ...q, saved:true, note: noteMap[q.id]?.note || '' });
    Object.values(noteMap).forEach(q => merged[q.id] = { ...(merged[q.id] || q), note:q.note, saved: !!savedMap[q.id] });
    const items = Object.values(merged);
    layout(`
      <section class="headline"><h1>Saved Questions</h1><p>Your starred questions and notes are stored locally in this browser for quick review later.</p></section>
      <section class="panel saved-filters"><div class="tabs"><button class="tab active" data-filter="all">All</button><button class="tab" data-filter="saved">Starred</button><button class="tab" data-filter="notes">Notes</button><button class="tab" data-filter="both">Starred + Notes</button></div><div class="form-grid"><div><select id="savedSubject" class="field"><option value="">All Subjects</option>${[...new Set(items.map(i=>i.subject))].map(s=>`<option value="${s}">${label(s)}</option>`).join('')}</select></div><div><select id="savedTopic" class="field"><option value="">All Topics</option>${[...new Set(items.map(i=>i.topic))].map(s=>`<option value="${s}">${label(s)}</option>`).join('')}</select></div><div><input id="savedSearch" class="field" placeholder="Search saved questions or notes..." /></div></div></section>
      <section id="savedList" class="stack"></section>
    `);
    let filter='all';
    const draw=()=>{
      const subj=byId('savedSubject').value, topic=byId('savedTopic').value, search=byId('savedSearch').value.toLowerCase();
      const list = items.filter(item=>{
        if (filter==='saved' && !item.saved) return false;
        if (filter==='notes' && !item.note) return false;
        if (filter==='both' && !(item.saved && item.note)) return false;
        if (subj && item.subject!==subj) return false;
        if (topic && item.topic!==topic) return false;
        return `${item.question} ${item.note||''}`.toLowerCase().includes(search);
      });
      byId('savedList').innerHTML = list.map(item=>`<article class="panel saved-card"><div class="row-between"><div class="pill-row"><span class="pill ${item.subject}">${label(item.subject)}</span><span class="pill">${label(item.topic)}</span>${item.note?'<span class="pill">Noted</span>':''}</div><div class="action-row left"><button class="btn white small edit-note" data-id="${item.id}">${item.note?'Edit Note':'Add Note'}</button><button class="star small ${item.saved?'saved':''}" data-id="${item.id}">★</button></div></div><h3>${item.question}</h3><div class="review-row"><strong>Correct answer:</strong> <span>${item.correctAnswer}</span></div><div class="review-row"><strong>Explanation:</strong> <span>${item.explanation}</span></div>${item.note?`<div class="note-display"><strong>Your note</strong><p>${item.note}</p></div>`:''}<div class="action-row left"><a class="btn white" href="${pageHref('topic.html',{subject:item.subject, topic:item.topic})}">Open Topic</a></div></article>`).join('') || '<div class="empty">No saved questions found.</div>';
      qsa('.star.small').forEach(b=>b.onclick=()=>{ const q=findQuestionById(b.dataset.id) || items.find(i=>i.id===b.dataset.id); toggleSaved(q); location.reload(); });
      qsa('.edit-note').forEach(b=>b.onclick=()=>{ const q=items.find(i=>i.id===b.dataset.id); const note=prompt('Edit note', q.note||'') ?? q.note; setNote(q,note); location.reload(); });
    };
    qsa('.tab').forEach(t=>t.onclick=()=>{ qsa('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); filter=t.dataset.filter; draw(); });
    ['savedSubject','savedTopic','savedSearch'].forEach(id=>byId(id).addEventListener('input',draw));
    draw();
  }

  function renderDashboardPage() {
    const p = getProgress();
    const accuracy = getAccuracy(p.correctSelections, p.totalSelections);
    const topicStats = Object.entries(p.topics || {}).map(([key,val])=>({ key, ...val, accuracy:getAccuracy(val.correct,val.total) }));
    const weak = [...topicStats].sort((a,b)=>a.accuracy-b.accuracy).slice(0,4);
    const strong = [...topicStats].sort((a,b)=>b.accuracy-a.accuracy).slice(0,4);
    const cont = p.continueStudy;
    const recent = (p.recent||[]).slice(0,6);
    const last5 = recent.slice(0,5).map(r=>r.accuracy||0);
    const last5avg = last5.length ? Math.round(last5.reduce((a,b)=>a+b,0)/last5.length) : 0;
    const achievements = [
      ['Studied 100 Questions', p.studiedQuestions, 100],
      ['Completed 5 Study Sessions', p.studySessions, 5],
      ['Completed 3 Final Exams', p.finalExamsCompleted, 3],
      ['Reached 80%+ Overall', accuracy, 80],
    ];
    layout(`
      <section class="panel dash-hero"><span class="pill gold">Student Dashboard</span><h1>Your performance at a glance</h1><p>Provides continuous performance tracking, identifying core weaknesses and suggesting targeted interventions for optimization.</p><div class="mastery"><div class="ring"><strong>${accuracy}%</strong><span>OVERALL</span></div><div class="mastery-copy"><div class="pill ${accuracy>=50?'completed':'gold'}">${accuracy>=50?'Building momentum':'Just getting started'}</div><div class="progress-label"><span>Overall mastery progress</span><strong>${accuracy}%</strong></div><div class="progress"><div style="width:${accuracy}%"></div></div><div class="delta ${accuracy<20?'down':''}">${accuracy<20?'Down':'Up'} ${Math.abs(14-accuracy)}% from your previous sessions</div><div class="action-row left"><a class="btn gold" href="${continueLink()||'subjects.html'}">Resume Study</a><a class="btn white" href="${weak[0]?pageHref('topic.html',{subject:weak[0].key.split(':')[0],topic:weak[0].key.split(':')[1]}):'subjects.html'}">Weakest Topic</a><a class="btn white" href="saved.html">Saved & Notes</a></div></div></div></section>
      <section class="dash-next-grid"><div class="panel dark-panel"><span>Recommended next move</span><h3>${weak[0]?.topicName || 'Start a topic'}</h3><p>${weak[0]?.subjectName || 'No weak areas yet'} • ${weak[0]?.accuracy || 0}% accuracy • ${weak[0]?.correct || 0}/${weak[0]?.total || 0} correct</p>${weak[0]?`<a class="btn white" href="${pageHref('topic.html',{subject:weak[0].key.split(':')[0],topic:weak[0].key.split(':')[1]})}">Open Topic</a>`:''}</div><div class="panel"><span>Continue where you left off</span><h3>${cont?.topicName || 'No active topic'}</h3><p>${cont?`${cont.subjectName} • Set ${cont.setNumber} • Resume from question ${Math.min((cont.questionIndex||0)+1, cont.totalQuestions||1)}`:'Start any topic to create a resume point.'}</p>${cont?`<a class="btn white" href="${continueLink()}">Resume Now</a>`:''}</div></section>
      <section class="stats-four"><div class="panel"><span>Overall Success Rate</span><strong>${accuracy}%</strong></div><div class="panel"><span>Total Solved Questions</span><strong>${p.studiedQuestions}</strong></div><div class="panel"><span>Study Sessions</span><strong>${p.studySessions}</strong></div><div class="panel"><span>Final Exams Completed</span><strong>${p.finalExamsCompleted}</strong></div></section>
      <section class="panel"><h2>Performance breakdown</h2><p>A cleaner read on what is going well and what needs recovery.</p><div class="two-col"><div class="subpanel"><h3>Strength Areas</h3>${strong.map(i=>`<div class="perf-row"><div><strong>${i.topicName}</strong><span>${i.subjectName} • ${i.correct}/${i.total} correct • ${i.attempts} sessions</span></div><div class="perf-side"><strong>${i.accuracy}%</strong><div class="mini-bar"><div style="width:${i.accuracy}%"></div></div></div></div>`).join('')||'<div class="empty">No data yet.</div>'}</div><div class="subpanel"><h3>Weak Areas</h3>${weak.map(i=>`<div class="perf-row"><div><strong>${i.topicName}</strong><span>${i.subjectName} • ${i.correct}/${i.total} correct • ${i.attempts} sessions</span></div><div class="perf-side"><strong>${i.accuracy}%</strong><div class="mini-bar warn"><div style="width:${Math.max(i.accuracy,4)}%"></div></div></div></div>`).join('')||'<div class="empty">No data yet.</div>'}</div></div></section>
      <section class="panel"><h2>Recent activity</h2><p>Your latest study sessions and final exam attempts.</p>${recent.map(r=>`<div class="recent-row bordered"><div><strong>${r.name}</strong><span>${r.subject} • ${r.date}</span></div><div class="score-stack"><strong>${r.score}</strong><span>${r.accuracy||0}%</span></div></div>`).join('') || '<div class="empty">No recent activity yet.</div>'}</section>
      <section class="panel"><h2>Smart insights</h2><div class="stats-four"><div class="panel inner"><span>Last 5 sessions average</span><strong>${last5avg}%</strong></div><div class="panel inner"><span>Study sessions average</span><strong>${p.studySessions?Math.round((p.correctSelections/Math.max(p.totalSelections,1))*100):0}%</strong></div><div class="panel inner"><span>Saved questions</span><strong>${Object.keys(p.savedBank||{}).length}</strong></div><div class="panel inner"><span>Saved notes</span><strong>${Object.keys(p.savedNotes||{}).length}</strong></div></div></section>
      <section class="panel"><h2>Achievements</h2>${achievements.map(([name, value, goal])=>`<div class="ach-row ${value>=goal?'done':''}"><div><strong>${name}</strong><span>${value>=goal?'Unlocked':'In progress'} • ${value}/${goal}</span></div></div>`).join('')}</section>
      <section class="panel"><h2>Quick actions</h2><p>Open the most useful next page in one tap.</p><div class="quick-actions"><a class="btn gold full" href="${continueLink()||'subjects.html'}">Resume Study</a><a class="btn white full" href="final-exam.html">Start Final Exam</a><a class="btn white full" href="saved.html">Open Saved Questions</a></div></section>
    `);
  }

  async function renderAdminPage() {
    await loadIndex();
    layout(`
      <section class="headline"><h1>Admin</h1><p>Hidden management page for quick local additions while keeping the public design clean.</p></section>
      <section class="panel"><h2>Question Bank Overview</h2><div class="stats-four">${state.index.subjects.map(s=>`<div class="panel inner"><span>${s.name}</span><strong>${s.topics.reduce((a,t)=>a+t.questionCount,0)}</strong></div>`).join('')}</div></section>
      <section class="panel"><h2>Add Question Locally</h2><div class="form-grid"><div><label>Subject</label><select id="admSubject" class="field">${state.index.subjects.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div><div><label>Topic</label><select id="admTopic" class="field"></select></div><div><label>Difficulty</label><select id="admDifficulty" class="field"><option>easy</option><option selected>medium</option><option>hard</option></select></div><div><label>Type</label><input id="admType" class="field" value="mcq" /></div><div class="full"><label>Question</label><textarea id="admQuestion" class="field textarea"></textarea></div><div class="full"><label>Options (one per line)</label><textarea id="admOptions" class="field textarea"></textarea></div><div class="full"><label>Correct answer (must match one option)</label><input id="admCorrect" class="field" /></div><div class="full"><label>Explanation</label><textarea id="admExplanation" class="field textarea"></textarea></div></div><div class="action-row left"><button class="btn dark" id="admSave">Save Question</button><button class="btn white" id="admExport">Export Custom JSON</button></div><div id="admMsg"></div></section>
    `);
    const fillTopics = ()=>{ const s=state.subjects.get(byId('admSubject').value); byId('admTopic').innerHTML=s.topics.map(t=>`<option value="${t.id}">${t.name}</option>`).join(''); };
    byId('admSubject').onchange=fillTopics; fillTopics();
    byId('admSave').onclick=()=>{
      const subjectId=byId('admSubject').value, topicId=byId('admTopic').value;
      const subject=state.subjects.get(subjectId), topic=subject.topics.find(t=>t.id===topicId);
      const options=byId('admOptions').value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
      const correct=byId('admCorrect').value.trim();
      if (!byId('admQuestion').value.trim() || options.length<2 || !correct || !options.includes(correct) || !byId('admExplanation').value.trim()) { byId('admMsg').innerHTML='<div class="message error">Please complete all fields. Correct answer must match one option exactly.</div>'; return; }
      const bank=getCustomBank();
      bank.push({ id:`local-${Date.now()}`, subject:subjectId, subjectName:subject.name, topic:topicId, topicName:topic.name, difficulty:byId('admDifficulty').value, type:byId('admType').value.trim()||'mcq', question:byId('admQuestion').value.trim(), options, correctAnswer:correct, explanation:byId('admExplanation').value.trim(), caseScenario:'', imageUrl:'' });
      saveCustomBank(bank); byId('admMsg').innerHTML='<div class="message success">Question saved locally. Refresh topic pages to see updated counts.</div>'; loadIndex().then(()=>location.reload());
    };
    byId('admExport').onclick=()=>{
      const blob = new Blob([JSON.stringify(getCustomBank(), null, 2)], { type:'application/json' });
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='custom-questions.json'; a.click(); URL.revokeObjectURL(a.href);
    };
  }

  function renderAuthPage() {
    layout(`<section class="auth-wrap panel"><h1>Sign In</h1><p>This page is a visual placeholder for your future auth flow while keeping the new identity intact.</p><div class="form-grid"><div><label>Email</label><input class="field" placeholder="you@example.com" /></div><div><label>Password</label><input class="field" type="password" placeholder="••••••••" /></div></div><div class="action-row left"><button class="btn dark">Sign In</button><button class="btn white">Create Account</button></div></section>`);
  }

  async function boot() {
    if (PAGE === 'home') await renderHome();
    else if (PAGE === 'subjects') await renderSubjects();
    else if (PAGE === 'topics') await renderTopics();
    else if (PAGE === 'topic') await renderTopicPage();
    else if (PAGE === 'study') await renderStudyPage();
    else if (PAGE === 'final-exam') await renderFinalExamPage();
    else if (PAGE === 'review') renderReviewPage();
    else if (PAGE === 'saved') renderSavedPage();
    else if (PAGE === 'dashboard') renderDashboardPage();
    else if (PAGE === 'admin') await renderAdminPage();
    else if (PAGE === 'auth') renderAuthPage();

    document.addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='q') location.href='admin.html'; });
  }

  boot().catch(err => {
    console.error(err);
    document.body.innerHTML = `<div style="padding:40px;font-family:Inter,sans-serif">${err.message}</div>`;
  });
})();
