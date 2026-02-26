/* ─── app.js — Main Dashboard Logic ─── */

// ─── State ────────────────────────────────────────────────
let rawData = [];
let filteredData = [];
let currentTimezone = 'Asia/Kolkata';
let currentGranularity = 'day';
let currentPreset = 'all';
let selectedPersons = [];
let selectedIndustries = [];
let searchQuery = '';
let dateRange = { start: null, end: null };
let sortCol = 'timestamp';
let sortDir = -1; // -1 = desc
let currentPage = 1;
const PAGE_SIZE = 50;
let allIndustries = [];
let refreshInterval = null;

// Charts
let timeSeriesChart = null;
let peopleChart = null;
let industryChart = null;
let hourChart = null;

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    restoreFromURL();
    loadData();
    refreshInterval = setInterval(loadData, 30000);
    document.getElementById('embedUrl').textContent = window.location.origin;
});

// ─── Data Loading ─────────────────────────────────────────
async function loadData() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        rawData = json.rows.map(r => ({
            ...r,
            parsedDate: parseTimestamp(r.timestampRaw, currentTimezone),
        }));
        document.getElementById('lastUpdated').textContent =
            'Updated ' + new Date().toLocaleTimeString();

        // Collect all unique industries
        const indSet = new Set();
        rawData.forEach(r => { if (r.industry) indSet.add(r.industry); });
        allIndustries = [...indSet].sort();

        buildFilterChips();
        applyFilters();
        hideLoading();
    } catch (err) {
        console.error('Failed to load data:', err);
        document.getElementById('lastUpdated').textContent = 'Error loading data';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
}

// ─── Filter Chips ─────────────────────────────────────────
function buildFilterChips() {
    // Person chips
    const personContainer = document.getElementById('personChips');
    personContainer.innerHTML = PERSONS.map(p => {
        const active = selectedPersons.includes(p) ? ' active' : '';
        const color = PERSON_COLORS[p].border;
        return `<button class="chip${active}" data-person="${p}" onclick="togglePerson('${p}',this)">
      <span class="chip-dot" style="background:${color}"></span>${p}
    </button>`;
    }).join('');

    // Industry chips
    const indContainer = document.getElementById('industryChips');
    indContainer.innerHTML = allIndustries.map(ind => {
        const active = selectedIndustries.includes(ind) ? ' active' : '';
        return `<button class="chip${active}" data-industry="${ind}" onclick="toggleIndustry('${ind}',this)">${ind}</button>`;
    }).join('');
}

// ─── Filter Logic ─────────────────────────────────────────
function applyFilters() {
    const hideDups = document.getElementById('hideDuplicates').checked;
    const todayKey = getDateKey(new Date(), currentTimezone);

    filteredData = rawData.filter(r => {
        // Duplicates
        if (hideDups && r.isDuplicate) return false;

        // Person filter
        if (selectedPersons.length > 0 && !selectedPersons.includes(r.person)) return false;

        // Industry filter
        if (selectedIndustries.length > 0 && !selectedIndustries.includes(r.industry)) return false;

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!(r.message || '').toLowerCase().includes(q) &&
                !(r.notes || '').toLowerCase().includes(q)) return false;
        }

        // Date range (only for rows with valid dates)
        if (r.parsedDate && (dateRange.start || dateRange.end)) {
            const dk = getDateKey(r.parsedDate, currentTimezone);
            if (dateRange.start && dk < dateRange.start) return false;
            if (dateRange.end && dk > dateRange.end) return false;
        }

        return true;
    });

    // Sort
    filteredData.sort((a, b) => {
        if (sortCol === 'timestamp') {
            const ta = a.parsedDate ? a.parsedDate.getTime() : 0;
            const tb = b.parsedDate ? b.parsedDate.getTime() : 0;
            return (ta - tb) * sortDir;
        }
        const va = (a[sortCol] || '').toLowerCase();
        const vb = (b[sortCol] || '').toLowerCase();
        return va.localeCompare(vb) * sortDir;
    });

    currentPage = 1;
    updateKPIs();
    updateTimeSeries();
    updatePeopleChart();
    updateIndustryChart();
    updateHeatmap();
    updateHourChart();
    updateTable();
    updateDerivedMetrics();
    updateURL();
}

// ─── KPIs ─────────────────────────────────────────────────
function updateKPIs() {
    const withDates = filteredData.filter(r => r.parsedDate);
    const todayKey = getDateKey(new Date(), currentTimezone);

    // Total
    document.getElementById('kpiTotal').textContent = filteredData.length.toLocaleString();
    document.getElementById('kpiTotalSub').textContent = `of ${rawData.length.toLocaleString()} total`;

    // Per person
    if (selectedPersons.length === 1) {
        const person = selectedPersons[0];
        const count = filteredData.filter(r => r.person === person).length;
        document.getElementById('kpiPersonLabel').textContent = person;
        document.getElementById('kpiPerson').textContent = count.toLocaleString();
        document.getElementById('kpiPersonSub').textContent = 'messages in range';
    } else {
        document.getElementById('kpiPersonLabel').textContent = 'All People';
        document.getElementById('kpiPerson').textContent = filteredData.length.toLocaleString();
        document.getElementById('kpiPersonSub').textContent = `${PERSONS.length} contributors`;
    }

    // Today
    const todayCount = withDates.filter(r => getDateKey(r.parsedDate, currentTimezone) === todayKey).length;
    document.getElementById('kpiToday').textContent = todayCount.toLocaleString();
    document.getElementById('kpiTodaySub').textContent = todayKey;

    // Avg per day
    if (withDates.length > 0) {
        const dateKeys = new Set(withDates.map(r => getDateKey(r.parsedDate, currentTimezone)));
        const avg = (withDates.length / dateKeys.size).toFixed(1);
        document.getElementById('kpiAvg').textContent = avg;
        document.getElementById('kpiAvgSub').textContent = `across ${dateKeys.size} days`;
    } else {
        document.getElementById('kpiAvg').textContent = '0';
        document.getElementById('kpiAvgSub').textContent = 'no data';
    }
}

// ─── Time Series Chart ───────────────────────────────────
function updateTimeSeries() {
    const withDates = filteredData.filter(r => r.parsedDate);
    const buckets = {};

    PERSONS.forEach(p => { buckets[p] = {}; });

    withDates.forEach(r => {
        let key;
        switch (currentGranularity) {
            case 'hour':
                key = getDateKey(r.parsedDate, currentTimezone) + ' ' +
                    String(getHour(r.parsedDate, currentTimezone)).padStart(2, '0') + ':00';
                break;
            case 'week':
                key = getWeekKey(r.parsedDate, currentTimezone);
                break;
            case 'month':
                key = getMonthKey(r.parsedDate, currentTimezone);
                break;
            default:
                key = getDateKey(r.parsedDate, currentTimezone);
        }
        if (!key) return;
        if (!buckets[r.person]) buckets[r.person] = {};
        buckets[r.person][key] = (buckets[r.person][key] || 0) + 1;
    });

    // Collect all keys sorted
    const allKeys = new Set();
    Object.values(buckets).forEach(b => Object.keys(b).forEach(k => allKeys.add(k)));
    const labels = [...allKeys].sort();

    const datasets = PERSONS.map(p => ({
        label: p,
        data: labels.map(k => buckets[p]?.[k] || 0),
        borderColor: PERSON_COLORS[p].border,
        backgroundColor: PERSON_COLORS[p].bg,
        fill: true,
        tension: 0.3,
        pointRadius: labels.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2,
    }));

    const ctx = document.getElementById('timeSeriesChart');
    if (timeSeriesChart) timeSeriesChart.destroy();

    timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    titleFont: { family: 'Inter', size: 12 },
                    bodyFont: { family: 'Inter', size: 11 },
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    callbacks: {
                        afterBody(items) {
                            const total = items.reduce((s, i) => s + (i.raw || 0), 0);
                            return items.map(i => {
                                const pct = total > 0 ? ((i.raw / total) * 100).toFixed(1) : 0;
                                return `  ${i.dataset.label}: ${pct}%`;
                            });
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), font: { size: 10 }, maxRotation: 45 },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            },
            onClick(e, elements) {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const label = labels[idx];
                    showToast(`Showing rows for ${label}`);
                    // Could drill down
                }
            }
        }
    });
}

// ─── People Chart ─────────────────────────────────────────
function updatePeopleChart() {
    const counts = {};
    PERSONS.forEach(p => { counts[p] = 0; });
    filteredData.forEach(r => { counts[r.person] = (counts[r.person] || 0) + 1; });

    const ctx = document.getElementById('peopleChart');
    if (peopleChart) peopleChart.destroy();

    peopleChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: PERSONS,
            datasets: [{
                data: PERSONS.map(p => counts[p]),
                backgroundColor: PERSONS.map(p => PERSON_COLORS[p].bg),
                borderColor: PERSONS.map(p => PERSON_COLORS[p].border),
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                },
                y: {
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), font: { size: 11, weight: '600' } },
                    grid: { display: false }
                }
            },
            onClick(e, elements) {
                if (elements.length > 0) {
                    const person = PERSONS[elements[0].index];
                    togglePerson(person);
                }
            }
        }
    });
}

// ─── Industry Chart ───────────────────────────────────────
function updateIndustryChart() {
    const counts = {};
    filteredData.forEach(r => {
        if (r.industry) counts[r.industry] = (counts[r.industry] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => s[1]);

    const ctx = document.getElementById('industryChart');
    if (industryChart) industryChart.destroy();

    industryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: INDUSTRY_COLORS.slice(0, labels.length),
                borderWidth: 0,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
                        font: { family: 'Inter', size: 10 },
                        padding: 8,
                        usePointStyle: true,
                        pointStyleWidth: 8,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    callbacks: {
                        label(ctx) {
                            const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        }
                    }
                }
            },
            onClick(e, elements) {
                if (elements.length > 0) {
                    const industry = labels[elements[0].index];
                    toggleIndustry(industry);
                }
            }
        }
    });
}

// ─── Calendar Heatmap ─────────────────────────────────────
function updateHeatmap() {
    const container = document.getElementById('heatmapContainer');
    const withDates = filteredData.filter(r => r.parsedDate);

    if (withDates.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div>No date data available</div>';
        return;
    }

    // Build day counts
    const dayCounts = {};
    withDates.forEach(r => {
        const dk = getDateKey(r.parsedDate, currentTimezone);
        dayCounts[dk] = (dayCounts[dk] || 0) + 1;
    });

    const allDates = Object.keys(dayCounts).sort();
    if (allDates.length === 0) {
        container.innerHTML = '<div class="empty-state">No data</div>';
        return;
    }

    // Show last ~6 months
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 6);
    const startKey = startDate.toISOString().slice(0, 10);

    const maxCount = Math.max(...Object.values(dayCounts), 1);
    const getLevel = (count) => {
        if (!count) return 0;
        const ratio = count / maxCount;
        if (ratio <= 0.2) return 1;
        if (ratio <= 0.4) return 2;
        if (ratio <= 0.6) return 3;
        if (ratio <= 0.8) return 4;
        return 5;
    };

    // Build weeks grid
    const weeks = [];
    let current = new Date(startDate);
    // Align to Sunday
    current.setDate(current.getDate() - current.getDay());

    while (current <= endDate) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const dk = current.toISOString().slice(0, 10);
            week.push({ date: dk, count: dayCounts[dk] || 0, level: getLevel(dayCounts[dk]) });
            current.setDate(current.getDate() + 1);
        }
        weeks.push(week);
    }

    // Month labels
    const months = [];
    let lastMonth = '';
    weeks.forEach((w, i) => {
        const m = w[0].date.slice(0, 7);
        if (m !== lastMonth) {
            months.push({ index: i, label: new Date(w[0].date + 'T00:00:00Z').toLocaleString('en', { month: 'short' }) });
            lastMonth = m;
        }
    });

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    let html = '<div style="display:inline-block">';

    // Month labels row
    html += '<div style="display:flex;padding-left:28px;">';
    let prevIdx = 0;
    months.forEach((m, i) => {
        const gap = m.index - prevIdx;
        html += `<div style="min-width:${gap * 17}px;font-size:0.65rem;color:var(--text-muted)">${m.label}</div>`;
        prevIdx = m.index;
    });
    html += '</div>';

    // Grid rows (7 rows for days of week)
    for (let d = 0; d < 7; d++) {
        html += `<div class="heatmap-row">`;
        html += `<span class="heatmap-day-label">${dayLabels[d]}</span>`;
        weeks.forEach(w => {
            const cell = w[d];
            html += `<div class="heatmap-cell" data-level="${cell.level}" title="${cell.date}: ${cell.count} messages"></div>`;
        });
        html += '</div>';
    }

    // Legend
    html += '<div class="heatmap-legend"><span>Less</span>';
    for (let l = 0; l <= 5; l++) {
        html += `<div class="heatmap-cell heatmap-legend-cell" data-level="${l}"></div>`;
    }
    html += '<span>More</span></div>';
    html += '</div>';

    container.innerHTML = html;
}

// ─── Hour Distribution ───────────────────────────────────
function updateHourChart() {
    const hourCounts = new Array(24).fill(0);
    filteredData.forEach(r => {
        if (!r.parsedDate) return;
        const h = getHour(r.parsedDate, currentTimezone);
        hourCounts[h]++;
    });

    const labels = hourCounts.map((_, i) => `${String(i).padStart(2, '0')}:00`);
    const ctx = document.getElementById('hourChart');
    if (hourChart) hourChart.destroy();

    hourChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: hourCounts,
                backgroundColor: hourCounts.map((v, i) => {
                    const max = Math.max(...hourCounts, 1);
                    const ratio = v / max;
                    return `rgba(99,102,241,${0.2 + ratio * 0.8})`;
                }),
                borderRadius: 4,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), font: { size: 9 }, maxRotation: 0 },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), font: { size: 9 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            }
        }
    });
}

// ─── Table ────────────────────────────────────────────────
function updateTable() {
    const tbody = document.getElementById('tableBody');
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageData = filteredData.slice(start, end);
    const tz = currentTimezone;
    const tzAbbr = getTimezoneAbbr(tz);

    let html = '';
    pageData.forEach((r, i) => {
        let dateStr;
        if (r.parsedDate) {
            if (r.hasTime) {
                dateStr = formatDateISO(r.parsedDate, tz) + ' ' + tzAbbr;
            } else {
                dateStr = formatDateOnly(r.parsedDate, tz);
            }
        } else {
            dateStr = r.timestampRaw || '—';
        }
        const msgTrunc = truncate(r.message, 80);
        const hasMore = r.message && r.message.length > 80;
        const personColor = PERSON_COLORS[r.person] || PERSON_COLORS.Anirudh;
        const rowIdx = start + i;

        html += `<tr${r.isDuplicate ? ' style="opacity:0.5"' : ''}>
      <td style="white-space:nowrap;font-size:0.75rem">${escapeHtml(dateStr)}</td>
      <td><span class="person-badge" style="background:${personColor.light};color:${personColor.border}">
        <span class="chip-dot" style="background:${personColor.border}"></span>${r.person}
      </span>${r.isDuplicate ? ' <span class="dup-badge">DUP</span>' : ''}</td>
      <td>${r.link ? `<a href="${escapeHtml(r.link)}" target="_blank" rel="noopener" class="cell-link" title="${escapeHtml(r.link)}">↗ Open</a>` : '—'}</td>
      <td><div class="msg-preview" id="msg-${rowIdx}" onclick="toggleMsg(${rowIdx})">
        <span class="msg-truncated">${escapeHtml(msgTrunc)}${hasMore ? ' <button class="expand-btn">▼ more</button>' : ''}</span>
        <span class="msg-full">${escapeHtml(r.message)}</span>
      </div></td>
      <td style="font-size:0.75rem;color:var(--text-secondary)">${escapeHtml(truncate(r.notes, 60))}</td>
      <td><span style="font-size:0.72rem">${escapeHtml(r.industry)}</span></td>
      <td>
        <button class="copy-btn" onclick="copyMsg(${rowIdx},'${escapeHtml((r.message || '').replace(/'/g, "\\'").replace(/\n/g, ' '))}',this)" title="Copy message">📋</button>
      </td>
    </tr>`;
    });

    tbody.innerHTML = html || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📭</div>No messages match your filters</div></td></tr>';

    // Page info
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE) || 1;
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('tableInfo').textContent = `${filteredData.length.toLocaleString()} rows`;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

// ─── Derived Metrics ─────────────────────────────────────
function updateDerivedMetrics() {
    updateTopLinks();
    updatePerPersonDay();
}

function updateTopLinks() {
    const container = document.getElementById('topLinksContainer');
    const linkCounts = {};
    filteredData.forEach(r => {
        if (r.link) linkCounts[r.link] = (linkCounts[r.link] || 0) + 1;
    });

    const sorted = Object.entries(linkCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:16px"><div class="empty-state-icon">🔗</div>No links</div>';
        return;
    }

    let html = '<table class="data-table" style="font-size:0.72rem"><thead><tr><th>Link</th><th>Count</th></tr></thead><tbody>';
    sorted.forEach(([link, count]) => {
        const short = link.length > 40 ? link.slice(0, 40) + '…' : link;
        html += `<tr><td><a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="cell-link">${escapeHtml(short)}</a></td><td>${count}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function updatePerPersonDay() {
    const container = document.getElementById('perPersonDayContainer');
    const withDates = filteredData.filter(r => r.parsedDate);

    const personDays = {};
    PERSONS.forEach(p => { personDays[p] = new Set(); });

    withDates.forEach(r => {
        const dk = getDateKey(r.parsedDate, currentTimezone);
        if (personDays[r.person]) personDays[r.person].add(dk);
    });

    const personCounts = {};
    PERSONS.forEach(p => {
        personCounts[p] = filteredData.filter(r => r.person === p).length;
    });

    let html = '<table class="data-table" style="font-size:0.72rem"><thead><tr><th>Person</th><th>Total</th><th>Active Days</th><th>Avg/Day</th></tr></thead><tbody>';
    PERSONS.forEach(p => {
        const total = personCounts[p] || 0;
        const days = personDays[p].size || 1;
        const avg = (total / days).toFixed(1);
        const color = PERSON_COLORS[p].border;
        html += `<tr>
      <td><span style="color:${color};font-weight:600">${p}</span></td>
      <td>${total}</td>
      <td>${days}</td>
      <td>${avg}</td>
    </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ─── Interactions ─────────────────────────────────────────
function togglePerson(person, el) {
    const idx = selectedPersons.indexOf(person);
    if (idx >= 0) {
        selectedPersons.splice(idx, 1);
    } else {
        selectedPersons.push(person);
    }
    buildFilterChips();
    applyFilters();
}

function toggleIndustry(industry, el) {
    const idx = selectedIndustries.indexOf(industry);
    if (idx >= 0) {
        selectedIndustries.splice(idx, 1);
    } else {
        selectedIndustries.push(industry);
    }
    buildFilterChips();
    applyFilters();
}

function onSearchInput() {
    searchQuery = document.getElementById('searchInput').value.trim();
    debounce(() => applyFilters(), 300)();
}

// Debounced search
let searchTimer;
function onSearchInput() {
    clearTimeout(searchTimer);
    searchQuery = document.getElementById('searchInput').value.trim();
    searchTimer = setTimeout(() => applyFilters(), 300);
}

function setPreset(preset, el) {
    currentPreset = preset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.preset-btn[data-preset="${preset}"]`).forEach(b => b.classList.add('active'));

    if (preset === 'custom') {
        // Use whatever is in the date inputs
        onDateChange();
        return;
    }

    const range = getDateRangePreset(preset, currentTimezone);
    dateRange = range;
    document.getElementById('dateStart').value = range.start || '';
    document.getElementById('dateEnd').value = range.end || '';
    applyFilters();
}

function onDateChange() {
    dateRange.start = document.getElementById('dateStart').value || null;
    dateRange.end = document.getElementById('dateEnd').value || null;
    currentPreset = 'custom';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.preset-btn[data-preset="custom"]').forEach(b => b.classList.add('active'));
    applyFilters();
}

function setGranularity(gran, el) {
    currentGranularity = gran;
    document.querySelectorAll('.gran-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.gran-btn[data-gran="${gran}"]`).forEach(b => b.classList.add('active'));
    applyFilters();
}

function sortTable(col) {
    if (sortCol === col) {
        sortDir *= -1;
    } else {
        sortCol = col;
        sortDir = col === 'timestamp' ? -1 : 1;
    }
    applyFilters();
}

function changePage(delta) {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE) || 1;
    currentPage = Math.max(1, Math.min(totalPages, currentPage + delta));
    updateTable();
}

function toggleMsg(idx) {
    const el = document.getElementById(`msg-${idx}`);
    if (el) el.classList.toggle('expanded');
}

function copyMsg(idx, msg, btn) {
    // Get actual message from filteredData
    const actualMsg = filteredData[idx]?.message || msg;
    navigator.clipboard.writeText(actualMsg).then(() => {
        btn.classList.add('copied');
        btn.textContent = '✓';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = '📋';
        }, 2000);
    });
}

function resetFilters() {
    selectedPersons = [];
    selectedIndustries = [];
    searchQuery = '';
    currentPreset = 'all';
    dateRange = { start: null, end: null };
    document.getElementById('searchInput').value = '';
    document.getElementById('dateStart').value = '';
    document.getElementById('dateEnd').value = '';
    document.getElementById('hideDuplicates').checked = false;
    buildFilterChips();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.preset-btn[data-preset="all"]').classList.add('active');
    applyFilters();
}

// ─── Theme Toggle ─────────────────────────────────────────
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    // Re-render charts with new colors
    setTimeout(() => {
        updateTimeSeries();
        updatePeopleChart();
        updateIndustryChart();
        updateHourChart();
    }, 100);
}

// ─── Timezone Change ─────────────────────────────────────
function changeTimezone() {
    currentTimezone = document.getElementById('tzSelect').value;
    // Re-parse all dates
    rawData.forEach(r => {
        r.parsedDate = parseTimestamp(r.timestampRaw, currentTimezone);
    });
    applyFilters();
}

// ─── Help Drawer ──────────────────────────────────────────
function toggleHelp() {
    document.getElementById('helpDrawer').classList.toggle('open');
    document.getElementById('helpOverlay').classList.toggle('open');
}

// ─── Sidebar Toggle (mobile) ─────────────────────────────
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('mobile-open');
}

// ─── Export ───────────────────────────────────────────────
function exportData(format) {
    window.open(`/api/export?format=${format}`, '_blank');
}

// ─── URL State ────────────────────────────────────────────
function updateURL() {
    const params = new URLSearchParams();
    if (selectedPersons.length) params.set('persons', selectedPersons.join(','));
    if (selectedIndustries.length) params.set('industries', selectedIndustries.join(','));
    if (searchQuery) params.set('q', searchQuery);
    if (dateRange.start) params.set('from', dateRange.start);
    if (dateRange.end) params.set('to', dateRange.end);
    if (currentGranularity !== 'day') params.set('gran', currentGranularity);
    if (currentTimezone !== 'Asia/Kolkata') params.set('tz', currentTimezone);
    if (currentPreset !== 'all') params.set('preset', currentPreset);

    const newUrl = params.toString() ? `${location.pathname}?${params}` : location.pathname;
    history.replaceState(null, '', newUrl);
}

function restoreFromURL() {
    const params = new URLSearchParams(location.search);

    if (params.get('persons')) {
        selectedPersons = params.get('persons').split(',').filter(p => PERSONS.includes(p));
    }
    if (params.get('industries')) {
        selectedIndustries = params.get('industries').split(',');
    }
    if (params.get('q')) {
        searchQuery = params.get('q');
        document.getElementById('searchInput').value = searchQuery;
    }
    if (params.get('from')) {
        dateRange.start = params.get('from');
        document.getElementById('dateStart').value = dateRange.start;
    }
    if (params.get('to')) {
        dateRange.end = params.get('to');
        document.getElementById('dateEnd').value = dateRange.end;
    }
    if (params.get('gran')) {
        currentGranularity = params.get('gran');
        document.querySelectorAll('.gran-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`.gran-btn[data-gran="${currentGranularity}"]`).forEach(b => b.classList.add('active'));
    }
    if (params.get('tz')) {
        currentTimezone = params.get('tz');
        document.getElementById('tzSelect').value = currentTimezone;
    }
    if (params.get('preset')) {
        currentPreset = params.get('preset');
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.preset-btn[data-preset="${currentPreset}"]`);
        if (activeBtn) activeBtn.classList.add('active');
    }

    const theme = params.get('theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);
}

// ─── Share ────────────────────────────────────────────────
function shareView() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        showToast('🔗 Dashboard link copied to clipboard!');
    }).catch(() => {
        showToast('URL: ' + url);
    });
}

// ─── Toast ────────────────────────────────────────────────
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}
