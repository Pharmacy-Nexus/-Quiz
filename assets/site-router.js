
(function () {
  const CURRENT = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const routeForLabel = (raw) => {
    const text = (raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return null;

    const comingSoon = (section) => `coming-soon.html?section=${encodeURIComponent(section)}`;

    if (/\bhome\b/.test(text)) return 'index.html';
    if (/exam dashboard|\bdashboard\b|performance|leaderboard/.test(text)) return 'dashboard.html';
    if (/\bsubjects\b/.test(text)) return 'subjects.html';
    if (/curriculum|study plan/.test(text)) return 'curriculum.html';
    if (/topic sets/.test(text)) return 'topic-sets.html';
    if (/question bank/.test(text)) return 'subjects.html';
    if (/saved/.test(text)) return 'saved.html';
    if (/final exam|\bexams\b|exam simulator|mock exams/.test(text)) return 'final-exam.html';
    if (/review/.test(text)) return 'review.html';
    if (/flashcards/.test(text)) return comingSoon('Flashcards');
    if (/formulas|formulary/.test(text)) return comingSoon('Formulas');
    if (/drug interactions/.test(text)) return comingSoon('Drug Interactions');
    if (/resources|resource library|lab reports/.test(text)) return comingSoon('Resources');
    if (/support|help_outline/.test(text)) return comingSoon('Support');
    if (/settings/.test(text)) return comingSoon('Settings');
    if (/logout/.test(text)) return comingSoon('Logout');

    if (/new exam session/.test(text)) return 'final-exam.html';
    if (/start study session|resume set|continue\b|resume module/.test(text)) return 'study-session.html';
    if (/enter lab/.test(text)) return 'topic-sets.html';
    if (/continue review/.test(text)) return 'review.html';
    if (/back to curriculum/.test(text)) return 'curriculum.html';
    if (/retry wrong questions|start new practice/.test(text)) return 'study-session.html';
    if (/view all/.test(text)) return 'subjects.html';
    if (/review formulas/.test(text)) return 'pharmacology-topics.html';

    return null;
  };

  const makeClickable = (el, href) => {
    if (!href) return;
    const isAnchor = el.tagName.toLowerCase() === 'a';
    if (isAnchor) {
      const currentHref = (el.getAttribute('href') || '').trim();
      if (currentHref === '' || currentHref === '#') el.setAttribute('href', href);
    } else {
      const role = el.getAttribute('data-route-bound');
      if (role === '1') return;
      el.style.cursor = 'pointer';
      el.setAttribute('data-route-bound', '1');
      el.addEventListener('click', function (e) {
        const target = e.target.closest('button');
        if (!target || target.disabled) return;
        location.href = href;
      });
    }

    try {
      const normalizedHref = href.split('?')[0];
      if (normalizedHref === CURRENT && isAnchor) {
        el.setAttribute('aria-current', 'page');
      }
    } catch (_) {}
  };

  const bindRoutes = () => {
    document.querySelectorAll('a, button').forEach((el) => {
      const label = (el.innerText || el.textContent || '').trim();
      const href = routeForLabel(label);
      if (href) makeClickable(el, href);
    });
  };

  const buildSectionLabel = () => {
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    const title = document.querySelector('[data-coming-soon-title]');
    const subtitle = document.querySelector('[data-coming-soon-subtitle]');
    if (section && title) {
      title.textContent = section;
      document.title = `${section} - Pharmacy Scholar`;
    }
    if (section && subtitle) {
      subtitle.textContent = `${section} will be wired in next while keeping this design system.`;
    }
  };

  const addQuickLinks = () => {
    const host = document.querySelector('[data-quick-links]');
    if (!host) return;
    const links = [
      ['Home', 'index.html'],
      ['Dashboard', 'dashboard.html'],
      ['Subjects', 'subjects.html'],
      ['Curriculum', 'curriculum.html'],
      ['Topic Sets', 'topic-sets.html'],
      ['Session', 'study-session.html'],
      ['Review', 'review.html'],
      ['Saved', 'saved.html'],
      ['Final Exam', 'final-exam.html']
    ];
    host.innerHTML = links.map(([label, href]) => {
      const active = CURRENT === href ? 'style="background:#00151b;color:#fff;"' : '';
      return `<a href="${href}" ${active} class="inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold border border-black/10 hover:opacity-90 transition">${label}</a>`;
    }).join('');
  };

  document.addEventListener('DOMContentLoaded', function () {
    bindRoutes();
    buildSectionLabel();
    addQuickLinks();
  });
})();
