/* ─── app.js — Dashboard Logic ─── */

// ─── State ────────────────────────────────────────────
let rawData = [];
let filteredData = [];
let currentTimezone = 'Asia/Kolkata';
let currentGranularity = 'day';
let currentPreset = 'all';
let selectedPersons = [];
let searchQuery = '';
let dateRange = { start: null, end: null };
let sortCol = 'timestamp';
let sortDir = -1;
let currentPage = 1;
const PAGE_SIZE = 50;
let refreshInterval = null;

// Charts
let timeSeriesChart = null;
let peopleChart = null;
let hourChart = null;

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    restoreFromURL();
    loadData();
    refreshInterval = setInterval(loadData, 30000);
});

// ─── Data Loading ─────────────────────────────────────
async function loadData() {
    try {
        const res = await fetch('/api/data');
        const json = await res.json();
        rawData = json.rows.map(r => ({
            ...r,
            parsedDate: parseTimestamp(r.timestampRaw, currentTimezone),
        }));
        document.getElementById('lastUpdated').textContent =
            'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        buildFilterChips();
        applyFilters();
        hideLoading();
    } catch (err) {
        console.error('Failed to load data:', err);
        document.getElementById('lastUpdated').textContent = 'Error';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
}

// ─── Filter Chips ─────────────────────────────────────
function buildFilterChips() {
    const container = document.getElementById('personChips');
    container.innerHTML = PERSONS.map(p => {
        const active = selectedPersons.includes(p) ? ' active' : '';
        const color = PERSON_COLORS[p].border;
        return `<button class="chip${active}" onclick="togglePerson('${p}')">
      <span class="chip-dot" style="background:${color}"></span>${p}
    </button>`;
    }).join('');
}

// ─── Filter Logic ─────────────────────────────────────
function applyFilters() {
    filteredData = rawData.filter(r => {
        if (selectedPersons.length > 0 && !selectedPersons.includes(r.person)) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!(r.message || '').toLowerCase().includes(q) &&
                !(r.notes || '').toLowerCase().includes(q)) return false;
        }
        if (r.parsedDate && (dateRange.start || dateRange.end)) {
            const dk = getDateKey(r.parsedDate, currentTimezone);
            if (dateRange.start && dk < dateRange.start) return false;
            if (dateRange.end && dk > dateRange.end) return false;
        }
        return true;
    });

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
    updateHeatmap();
    updateHourChart();
    updateTable();
    updateURL();
}

// ─── KPIs ─────────────────────────────────────────────
function updateKPIs() {
    const withDates = filteredData.filter(r => r.parsedDate);
    const todayKey = getDateKey(new Date(), currentTimezone);

    document.getElementById('kpiTotal').textContent = filteredData.length.toLocaleString();
    document.getElementById('kpiTotalSub').textContent = `of ${rawData.length} total`;

    if (selectedPersons.length === 1) {
        const person = selectedPersons[0];
        const count = filteredData.filter(r => r.person === person).length;
        document.getElementById('kpiPersonLabel').textContent = person;
        document.getElementById('kpiPerson').textContent = count.toLocaleString();
        document.getElementById('kpiPersonSub').textContent = 'messages';
    } else {
        document.getElementById('kpiPersonLabel').textContent = 'All People';
        document.getElementById('kpiPerson').textContent = filteredData.length.toLocaleString();
        document.getElementById('kpiPersonSub').textContent = `${PERSONS.length} team members`;
    }

    const todayCount = withDates.filter(r => getDateKey(r.parsedDate, currentTimezone) === todayKey).length;
    document.getElementById('kpiToday').textContent = todayCount.toLocaleString();
    document.getElementById('kpiTodaySub').textContent = todayKey;

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

// ─── Time Series Chart ───────────────────────────────
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
            case 'week': key = getWeekKey(r.parsedDate, currentTimezone); break;
            case 'month': key = getMonthKey(r.parsedDate, currentTimezone); break;
            default: key = getDateKey(r.parsedDate, currentTimezone);
        }
        if (!key) return;
        if (!buckets[r.person]) buckets[r.person] = {};
        buckets[r.person][key] = (buckets[r.person][key] || 0) + 1;
    });

    const allKeys = new Set();
    Object.values(buckets).forEach(b => Object.keys(b).forEach(k => allKeys.add(k)));
    const labels = [...allKeys].sort();

    // Format labels for readability
    const displayLabels = labels.map(k => {
        if (currentGranularity === 'hour') {
            // "2026-02-26 10:00" -> "10:00"
            return k.split(' ').pop();
        }
        if (currentGranularity === 'day') {
            // "2026-02-26" -> "Feb 26"
            const d = new Date(k + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        if (currentGranularity === 'week') {
            return 'W' + k.split('-W')[1];
        }
        if (currentGranularity === 'month') {
            const [y, m] = k.split('-');
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return months[parseInt(m) - 1] + " '" + y.slice(2);
        }
        return k;
    });

    const datasets = PERSONS.map(p => ({
        label: p,
        data: labels.map(k => buckets[p]?.[k] || 0),
        backgroundColor: PERSON_COLORS[p].border + 'cc',
        borderColor: PERSON_COLORS[p].border,
        borderWidth: 1,
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 4, bottomRight: 4 },
        borderSkipped: false,
        barPercentage: labels.length <= 5 ? 0.4 : 0.7,
        categoryPercentage: labels.length <= 5 ? 0.5 : 0.8,
    }));

    const ctx = document.getElementById('timeSeriesChart');
    if (timeSeriesChart) timeSeriesChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();

    timeSeriesChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: displayLabels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: {
                        color: textColor,
                        font: { family: 'Inter', size: 11, weight: '500' },
                        usePointStyle: true, pointStyleWidth: 8, padding: 16,
                        boxWidth: 12, boxHeight: 12,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(5,13,31,0.95)',
                    titleFont: { family: 'Inter', size: 12, weight: '600' },
                    bodyFont: { family: 'Inter', size: 11 },
                    borderColor: 'rgba(37,99,235,0.2)', borderWidth: 1,
                    padding: 12, cornerRadius: 8,
                    callbacks: {
                        title: (items) => labels[items[0].dataIndex] || items[0].label,
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 }, maxRotation: 45 },
                    grid: { color: 'rgba(37,99,235,0.04)' },
                },
                y: {
                    stacked: true, beginAtZero: true,
                    ticks: { color: textColor, font: { size: 10 }, stepSize: 1, precision: 0 },
                    grid: { color: 'rgba(37,99,235,0.04)' },
                    title: { display: true, text: 'Messages', color: textColor, font: { family: 'Inter', size: 10 } },
                }
            }
        }
    });
}

// ─── People Chart ─────────────────────────────────────
function updatePeopleChart() {
    const counts = {};
    PERSONS.forEach(p => { counts[p] = 0; });
    filteredData.forEach(r => { counts[r.person] = (counts[r.person] || 0) + 1; });

    const ctx = document.getElementById('peopleChart');
    if (peopleChart) peopleChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();

    peopleChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: PERSONS,
            datasets: [{
                data: PERSONS.map(p => counts[p]),
                backgroundColor: PERSONS.map(p => PERSON_COLORS[p].bg),
                borderColor: PERSONS.map(p => PERSON_COLORS[p].border),
                borderWidth: 2, borderRadius: 8, borderSkipped: false,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(5,13,31,0.95)',
                    borderColor: 'rgba(37,99,235,0.2)', borderWidth: 1,
                    padding: 10, cornerRadius: 8,
                }
            },
            scales: {
                x: { beginAtZero: true, ticks: { color: textColor, font: { size: 10 } }, grid: { color: 'rgba(37,99,235,0.04)' } },
                y: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), font: { size: 11, weight: '600' } }, grid: { display: false } }
            },
            onClick(e, elements) {
                if (elements.length > 0) {
                    togglePerson(PERSONS[elements[0].index]);
                }
            }
        }
    });
}

// ─── Calendar Heatmap ─────────────────────────────────
function updateHeatmap() {
    const container = document.getElementById('heatmapContainer');
    const withDates = filteredData.filter(r => r.parsedDate);

    if (withDates.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div>No date data</div>';
        return;
    }

    const dayCounts = {};
    withDates.forEach(r => {
        const dk = getDateKey(r.parsedDate, currentTimezone);
        dayCounts[dk] = (dayCounts[dk] || 0) + 1;
    });

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 6);

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

    const weeks = [];
    let current = new Date(startDate);
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
    let html = '<div style="display:inline-block;padding:0 12px">';
    html += '<div style="display:flex;padding-left:28px;">';
    let prevIdx = 0;
    months.forEach(m => {
        const gap = m.index - prevIdx;
        html += `<div style="min-width:${gap * 15}px;font-size:0.58rem;color:var(--text-muted)">${m.label}</div>`;
        prevIdx = m.index;
    });
    html += '</div>';
    for (let d = 0; d < 7; d++) {
        html += '<div class="heatmap-row">';
        html += `<span class="heatmap-day-label">${dayLabels[d]}</span>`;
        weeks.forEach(w => {
            const cell = w[d];
            html += `<div class="heatmap-cell" data-level="${cell.level}" title="${cell.date}: ${cell.count} msgs"></div>`;
        });
        html += '</div>';
    }
    html += '<div class="heatmap-legend"><span>Less</span>';
    for (let l = 0; l <= 5; l++) html += `<div class="heatmap-cell heatmap-legend-cell" data-level="${l}"></div>`;
    html += '<span>More</span></div></div>';
    container.innerHTML = html;
}

// ─── Hour Distribution ───────────────────────────────
function updateHourChart() {
    const hourCounts = new Array(24).fill(0);
    filteredData.forEach(r => {
        if (!r.parsedDate) return;
        hourCounts[getHour(r.parsedDate, currentTimezone)]++;
    });

    const labels = hourCounts.map((_, i) => `${String(i).padStart(2, '0')}:00`);
    const ctx = document.getElementById('hourChart');
    if (hourChart) hourChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
    const max = Math.max(...hourCounts, 1);

    hourChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: hourCounts,
                backgroundColor: hourCounts.map(v => `rgba(37,99,235,${0.15 + (v / max) * 0.75})`),
                borderRadius: 3, borderSkipped: false,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 8 }, maxRotation: 0 }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: textColor, font: { size: 9 } }, grid: { color: 'rgba(37,99,235,0.04)' } }
            }
        }
    });
}

// ─── Table ────────────────────────────────────────────
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
            dateStr = r.hasTime
                ? formatDateISO(r.parsedDate, tz) + ' ' + tzAbbr
                : formatDateOnly(r.parsedDate, tz);
        } else {
            dateStr = r.timestampRaw || '—';
        }
        const msgTrunc = truncate(r.message, 90);
        const hasMore = r.message && r.message.length > 90;
        const personColor = PERSON_COLORS[r.person] || PERSON_COLORS.Anirudh;
        const rowIdx = start + i;
        const statusClass = (r.notes || '').toLowerCase().includes('complete') ? 'status-complete' : 'status-other';
        const statusText = r.notes || '—';

        html += `<tr>
      <td style="white-space:nowrap;font-size:0.75rem;font-variant-numeric:tabular-nums">${escapeHtml(dateStr)}</td>
      <td><span class="person-badge" style="background:${personColor.light};color:${personColor.border}">
        <span class="chip-dot" style="background:${personColor.border}"></span>${r.person}
      </span></td>
      <td>${r.link ? `<a href="${escapeHtml(r.link)}" target="_blank" rel="noopener" class="cell-link">↗ Open</a>` : '—'}</td>
      <td><div class="msg-preview" id="msg-${rowIdx}" onclick="toggleMsg(${rowIdx})">
        <span class="msg-truncated">${escapeHtml(msgTrunc)}${hasMore ? ' <button class="expand-btn">▼ more</button>' : ''}</span>
        <span class="msg-full">${escapeHtml(r.message)}</span>
      </div></td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(truncate(statusText, 20))}</span></td>
      <td>
        <button class="copy-btn" onclick="copyMsg(${rowIdx},this)" title="Copy message">📋</button>
      </td>
    </tr>`;
    });

    tbody.innerHTML = html || '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">📭</div>No messages match filters</div></td></tr>';

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE) || 1;
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('tableInfo').textContent = `${filteredData.length} rows`;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

// ─── Interactions ─────────────────────────────────────
function togglePerson(person) {
    const idx = selectedPersons.indexOf(person);
    if (idx >= 0) selectedPersons.splice(idx, 1);
    else selectedPersons.push(person);
    buildFilterChips();
    applyFilters();
}

let searchTimer;
function onSearchInput() {
    clearTimeout(searchTimer);
    searchQuery = document.getElementById('searchInput').value.trim();
    searchTimer = setTimeout(() => applyFilters(), 300);
}

function setPreset(preset, el) {
    currentPreset = preset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    else document.querySelectorAll(`.preset-btn[data-preset="${preset}"]`).forEach(b => b.classList.add('active'));

    // Show/hide date inputs
    const showCustom = preset === 'custom';
    document.getElementById('dateStart').style.display = showCustom ? '' : 'none';
    document.getElementById('dateEnd').style.display = showCustom ? '' : 'none';

    if (preset !== 'custom') {
        const range = getDateRangePreset(preset, currentTimezone);
        dateRange = range;
        document.getElementById('dateStart').value = range.start || '';
        document.getElementById('dateEnd').value = range.end || '';
    }
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
    updateTimeSeries();
}

function sortTable(col) {
    if (sortCol === col) sortDir *= -1;
    else { sortCol = col; sortDir = col === 'timestamp' ? -1 : 1; }
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

function copyMsg(idx, btn) {
    const msg = filteredData[idx]?.message || '';
    navigator.clipboard.writeText(msg).then(() => {
        btn.classList.add('copied');
        btn.textContent = '✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '📋'; }, 2000);
    });
}

function resetFilters() {
    selectedPersons = [];
    searchQuery = '';
    currentPreset = 'all';
    dateRange = { start: null, end: null };
    document.getElementById('searchInput').value = '';
    document.getElementById('dateStart').value = '';
    document.getElementById('dateEnd').value = '';
    document.getElementById('dateStart').style.display = 'none';
    document.getElementById('dateEnd').style.display = 'none';
    buildFilterChips();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.preset-btn[data-preset="all"]').classList.add('active');
    applyFilters();
}

// ─── Theme Toggle ─────────────────────────────────────
function toggleTheme() {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    setTimeout(() => {
        updateTimeSeries();
        updatePeopleChart();
        updateHourChart();
    }, 100);
}

// ─── Timezone ─────────────────────────────────────────
function changeTimezone() {
    currentTimezone = document.getElementById('tzSelect').value;
    rawData.forEach(r => { r.parsedDate = parseTimestamp(r.timestampRaw, currentTimezone); });
    applyFilters();
}

// ─── Share URL ────────────────────────────────────────
function updateURL() {
    const params = new URLSearchParams();
    if (selectedPersons.length) params.set('persons', selectedPersons.join(','));
    if (searchQuery) params.set('q', searchQuery);
    if (currentPreset !== 'all') params.set('preset', currentPreset);
    if (dateRange.start) params.set('from', dateRange.start);
    if (dateRange.end) params.set('to', dateRange.end);
    if (currentGranularity !== 'day') params.set('gran', currentGranularity);
    if (currentTimezone !== 'Asia/Kolkata') params.set('tz', currentTimezone);
    const qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
}

function restoreFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('persons')) selectedPersons = params.get('persons').split(',');
    if (params.has('q')) {
        searchQuery = params.get('q');
        document.getElementById('searchInput').value = searchQuery;
    }
    if (params.has('preset')) currentPreset = params.get('preset');
    if (params.has('from')) dateRange.start = params.get('from');
    if (params.has('to')) dateRange.end = params.get('to');
    if (params.has('gran')) currentGranularity = params.get('gran');
    if (params.has('tz')) {
        currentTimezone = params.get('tz');
        document.getElementById('tzSelect').value = currentTimezone;
    }
}

function shareView() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => showToast('Link copied!'));
}

function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
}

function exportData(format) {
    window.open(`/api/export?format=${format}`, '_blank');
}
