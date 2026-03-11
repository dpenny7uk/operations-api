import { esc } from './utils.js';

export function syncCardSelection(containerId, level) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.card').forEach(c => c.classList.remove('card-selected'));
  if (level) {
    const match = Array.from(container.querySelectorAll('.card[data-filter]'))
      .find(c => c.dataset.filter === level);
    if (match) match.classList.add('card-selected');
  }
}

export function renderTimeline(containerId, segments) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  segments.filter(s => s.pct > 0).forEach(s => {
    const div = document.createElement('div');
    div.className = 'segment';
    div.style.width = `${Number(s.pct)}%`;
    div.style.background = s.color;
    div.title = s.label;
    el.appendChild(div);
  });
  const legendEl = document.getElementById(containerId + 'Legend');
  if (legendEl) {
    legendEl.innerHTML = segments.filter(s => s.pct > 0).map(s =>
      `<span class="timeline-legend-item"><span class="timeline-legend-dot" style="background:${s.color}"></span>${esc(s.label)}</span>`
    ).join('');
  }
}

export function wireCardFilters(containerId, filterFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      const isActive = card.classList.contains('card-selected');
      container.querySelectorAll('.card').forEach(c => c.classList.remove('card-selected'));
      if (isActive) {
        filterFn(null);
      } else {
        card.classList.add('card-selected');
        filterFn(filter);
      }
    });
  });
}

export function wireCriticalCardFilters(containerId, filterFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.critical-card[data-filter]').forEach(card => {
    if (!card.hasAttribute('tabindex')) card.tabIndex = 0;
    if (!card.hasAttribute('role')) card.setAttribute('role', 'button');
    const handler = () => {
      const filter = card.dataset.filter;
      const isActive = card.classList.contains('card-selected');
      container.querySelectorAll('.critical-card').forEach(c => c.classList.remove('card-selected'));
      if (isActive) {
        filterFn(null);
      } else {
        card.classList.add('card-selected');
        filterFn(filter);
      }
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

export function syncCriticalCardSelection(containerId, level) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.critical-card').forEach(c => c.classList.remove('card-selected'));
  if (level) {
    const match = Array.from(container.querySelectorAll('.critical-card[data-filter]'))
      .find(c => c.dataset.filter === level);
    if (match) match.classList.add('card-selected');
  }
}
