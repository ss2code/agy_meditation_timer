// router.js — Hash-based single-page navigation
// Views: #timer (default), #history, #session/{id}, #insights

const VIEW_IDS = {
    timer: 'view-timer',
    history: 'view-history',
    session: 'view-session',
    insights: 'view-insights',
};

let _views = {};         // viewName -> DOM element
let _onNavigate = null;  // callback(viewName, params)

/**
 * Initialize the router. Call once on app boot.
 * @param {Object} viewHandlers - { timer, history, session, insights } -> function(params)
 */
export function initRouter(viewHandlers) {
    // Cache DOM elements
    for (const [name, id] of Object.entries(VIEW_IDS)) {
        _views[name] = document.getElementById(id);
    }
    _onNavigate = viewHandlers;

    window.addEventListener('hashchange', _handleHash);
    _handleHash(); // Navigate to current hash on load
}

function _parseHash() {
    const hash = window.location.hash.slice(1) || 'timer';
    const [view, ...parts] = hash.split('/');
    // Sanitize params — allow only safe characters to prevent future XSS vectors
    const params = parts.map(p => p.replace(/[^a-zA-Z0-9_-]/g, ''));
    return { view, params };
}

function _handleHash() {
    const { view, params } = _parseHash();
    const viewName = VIEW_IDS[view] ? view : 'timer';

    // Show active view, hide others
    for (const [name, el] of Object.entries(_views)) {
        if (el) el.classList.toggle('view--active', name === viewName);
    }

    // Update tab bar active state
    document.querySelectorAll('.tab-bar__item').forEach((btn) => {
        btn.classList.toggle('tab-bar__item--active', btn.dataset.view === viewName);
    });

    // Call view handler
    if (_onNavigate && _onNavigate[viewName]) {
        _onNavigate[viewName](params);
    }
}

/**
 * Navigate to a view.
 * @param {string} view - 'timer' | 'history' | 'session' | 'insights'
 * @param {string[]} [params] - extra path segments (e.g. session ID)
 */
export function navigateTo(view, params = []) {
    const hash = params.length ? `${view}/${params.join('/')}` : view;
    window.location.hash = hash;
}
