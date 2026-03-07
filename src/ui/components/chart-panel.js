// chart-panel.js — Chart.js wrapper for bio-signal time-series charts

/**
 * Create or update a chart on a canvas element.
 * Lazily imports Chart.js + annotation plugin + date adapter.
 * @param {HTMLCanvasElement} canvas
 * @param {Object} config - Chart.js config object
 * @returns {Promise<import('chart.js').Chart>}
 */
export async function createChart(canvas, config) {
    const [{ Chart }, { default: Annotation }] = await Promise.all([
        import('chart.js/auto'),
        import('chartjs-plugin-annotation'),
        import('chartjs-adapter-date-fns'),
    ]);
    Chart.register(Annotation);
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    return new Chart(canvas, config);
}

/**
 * Build a bar chart config for daily/longitudinal data.
 * @param {string[]} labels - x-axis labels
 * @param {number[]} data - y values
 * @param {Object} [opts]
 * @returns {Object} Chart.js config
 */
export function barChartConfig(labels, data, opts = {}) {
    const activeColor = opts.color || '#A5D6A7';
    return {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: data.map((v) => v > 0 ? `${activeColor}CC` : '#ECEFF1'),
                borderRadius: 3,
                borderSkipped: false,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.raw}m` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#78909C',
                        font: { size: 10 },
                        maxTicksLimit: 7,
                        maxRotation: 0,
                    },
                },
                y: {
                    grid: { color: '#F5F5F5' },
                    ticks: { color: '#78909C', font: { size: 10 } },
                    beginAtZero: true,
                    title: {
                        display: !!opts.yLabel,
                        text: opts.yLabel || '',
                        color: '#78909C',
                        font: { size: 10 },
                    },
                },
            },
        },
    };
}

/**
 * Format elapsed seconds as a concise label: "0m", "0:30", "1m", "1:30", "10m" etc.
 * @param {number} secs
 * @returns {string}
 */
function _formatElapsed(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    if (s === 0) return `${m}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Shared x-axis config for elapsed-seconds mode (linear scale).
 * @param {number} [xMax] - explicit end of session in seconds; ensures all charts share the same range
 */
function _elapsedXScale(xMax) {
    return {
        type: 'linear',
        min: 0,
        ...(xMax != null ? { max: xMax } : {}),
        grid: { display: false },
        ticks: {
            color: '#78909C',
            font: { size: 10 },
            maxTicksLimit: 5,
            maxRotation: 0,
            callback: (v) => v >= 0 ? _formatElapsed(v) : '',
        },
    };
}

/** Shared x-axis config for wall-clock time mode. */
function _timeXScale() {
    return {
        type: 'time',
        grid: { display: false },
        time: {
            displayFormats: { second: 'h:mm', minute: 'h:mm', hour: 'h:mm a' },
        },
        ticks: { color: '#78909C', font: { size: 10 }, maxTicksLimit: 5, maxRotation: 0 },
    };
}

/**
 * Build a line chart config for bio time-series.
 * @param {string} label
 * @param {Array<{x: string|number, y: number}>} data - x = ISO timestamp or elapsed seconds
 * @param {Object} [opts]
 * @param {boolean} [opts.xElapsed] - if true, x values are elapsed seconds (linear axis)
 * @returns {Object} Chart.js config
 */
export function lineChartConfig(label, data, opts = {}) {
    return {
        type: 'line',
        data: {
            datasets: [{
                label,
                data,
                borderColor: opts.color || '#A5D6A7',
                backgroundColor: opts.fill ? `${opts.color || '#A5D6A7'}33` : 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: opts.xElapsed
                        ? { title: (items) => _formatElapsed(items[0]?.parsed?.x ?? 0) }
                        : {},
                },
            },
            scales: {
                x: opts.xElapsed ? _elapsedXScale(opts.xMax) : _timeXScale(),
                y: {
                    grid: { color: '#F5F5F5' },
                    ticks: { color: '#78909C', font: { size: 10 } },
                    title: { display: !!opts.yLabel, text: opts.yLabel || '', color: '#78909C', font: { size: 10 } },
                },
            },
        },
    };
}

/**
 * Line chart with vertical-line and/or box annotations.
 *
 * @param {string} label
 * @param {Array<{x: string|number, y: number}>} data
 * @param {Array<{
 *   type?: 'line'|'box',
 *   x?: string|number,   // for type='line': timestamp or elapsed seconds
 *   xMin?: string|number,
 *   xMax?: string|number,
 *   label?: string,
 *   color?: string
 * }>} annotations
 * @param {Object} [opts]
 * @param {boolean} [opts.xElapsed] - if true, x values are elapsed seconds (linear axis)
 * @returns {Object} Chart.js config
 */
export function annotatedLineChartConfig(label, data, annotations = [], opts = {}) {
    const annotationObjs = {};
    annotations.forEach((ann, i) => {
        if (ann.type === 'box') {
            annotationObjs[`box${i}`] = {
                type: 'box',
                xMin: ann.xMin,
                xMax: ann.xMax,
                backgroundColor: ann.color || 'rgba(255,112,67,0.12)',
                borderWidth: 0,
            };
        } else {
            annotationObjs[`vline${i}`] = {
                type: 'line',
                xMin: ann.x,
                xMax: ann.x,
                borderColor: ann.color || '#FF7043',
                borderWidth: 1.5,
                borderDash: [4, 4],
                label: {
                    display: !!ann.label,
                    content: ann.label || '',
                    position: 'start',
                    color: '#FF7043',
                    font: { size: 10 },
                    backgroundColor: 'rgba(255,255,255,0.8)',
                    padding: 4,
                },
            };
        }
    });

    return {
        type: 'line',
        data: {
            datasets: [{
                label,
                data,
                borderColor: opts.color || '#A5D6A7',
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: opts.xElapsed
                        ? { title: (items) => _formatElapsed(items[0]?.parsed?.x ?? 0) }
                        : {},
                },
                annotation: { annotations: annotationObjs },
            },
            scales: {
                x: opts.xElapsed ? _elapsedXScale(opts.xMax) : _timeXScale(),
                y: {
                    grid: { color: '#F5F5F5' },
                    ticks: { color: '#78909C', font: { size: 10 } },
                    title: { display: !!opts.yLabel, text: opts.yLabel || '', color: '#78909C', font: { size: 10 } },
                },
            },
        },
    };
}

/**
 * Dual-line chart: two datasets on separate left/right y-axes.
 * @param {string} label1
 * @param {Array<{x: string|number, y: number}>} data1
 * @param {string} label2
 * @param {Array<{x: string|number, y: number}>} data2
 * @param {Object} [opts]
 * @param {boolean} [opts.xElapsed] - if true, x values are elapsed seconds (linear axis)
 * @returns {Object} Chart.js config
 */
export function dualLineChartConfig(label1, data1, label2, data2, opts = {}) {
    return {
        type: 'line',
        data: {
            datasets: [
                {
                    label: label1,
                    data: data1,
                    borderColor: opts.color1 || '#42A5F5',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'y',
                    spanGaps: true,
                },
                {
                    label: label2,
                    data: data2,
                    borderColor: opts.color2 || '#66BB6A',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'y2',
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: { boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: opts.xElapsed
                        ? { title: (items) => _formatElapsed(items[0]?.parsed?.x ?? 0) }
                        : {},
                },
            },
            scales: {
                x: opts.xElapsed ? _elapsedXScale(opts.xMax) : _timeXScale(),
                y: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: '#F5F5F5' },
                    ticks: { color: '#78909C', font: { size: 10 } },
                    title: { display: !!opts.yLabel1, text: opts.yLabel1 || '', color: '#78909C', font: { size: 10 } },
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: '#78909C', font: { size: 10 } },
                    title: { display: !!opts.yLabel2, text: opts.yLabel2 || '', color: '#78909C', font: { size: 10 } },
                },
            },
        },
    };
}
