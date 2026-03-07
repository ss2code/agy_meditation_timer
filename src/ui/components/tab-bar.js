// tab-bar.js — Bottom navigation tab bar component

import { navigateTo } from '../router.js';

const TABS = [
    { view: 'timer',    label: 'Timer',    icon: '◷' },
    { view: 'history',  label: 'History',  icon: '☰' },
    { view: 'insights', label: 'Insights', icon: '◈' },
];

/**
 * Render and mount the tab bar into the given container element.
 * @param {HTMLElement} container
 */
export function mountTabBar(container) {
    const nav = document.createElement('nav');
    nav.className = 'tab-bar';

    TABS.forEach(({ view, label, icon }) => {
        const btn = document.createElement('button');
        btn.className = 'tab-bar__item';
        btn.dataset.view = view;
        btn.innerHTML = `<span class="tab-bar__icon">${icon}</span><span class="tab-bar__label">${label}</span>`;
        btn.addEventListener('click', () => navigateTo(view));
        nav.appendChild(btn);
    });

    container.appendChild(nav);
}
