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
let heatmapView = 'day';

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
        // Date filtering: if a date range is set, exclude rows without timestamps
        if (dateRange.start || dateRange.end) {
            if (!r.parsedDate) return false;
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

// ─── Messages Chart (4 bars — one per person) ──────
function updateTimeSeries() {
    const counts = {};
    PERSONS.forEach(p => { counts[p] = 0; });
    filteredData.forEach(r => { counts[r.person] = (counts[r.person] || 0) + 1; });

    const data = PERSONS.map(p => counts[p]);
    const total = data.reduce((a, b) => a + b, 0);

    const ctx = document.getElementById('timeSeriesChart');
    if (timeSeriesChart) timeSeriesChart.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();

    timeSeriesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: PERSONS,
            datasets: [{
                data,
                backgroundColor: PERSONS.map(p => PERSON_COLORS[p].border + 'cc'),
                borderColor: PERSONS.map(p => PERSON_COLORS[p].border),
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.55,
                categoryPercentage: 0.7,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(5,13,31,0.95)',
                    titleFont: { family: 'Inter', size: 13, weight: '600' },
                    bodyFont: { family: 'Inter', size: 12 },
                    borderColor: 'rgba(37,99,235,0.2)', borderWidth: 1,
                    padding: 12, cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: (items) => items[0].label,
                        label: (item) => `${item.raw} messages`,
                        afterLabel: (item) => total > 0 ? `${Math.round(item.raw / total * 100)}% of total` : '',
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: textColor,
                        font: { family: 'Inter', size: 12, weight: '600' },
                    },
                    grid: { display: false },
                },
                y: {
                    beginAtZero: true,
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
function setHeatmapView(view, el) {
    heatmapView = view;
    document.querySelectorAll('[data-hm]').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    updateHeatmap();
}

function updateHeatmap() {
    const container = document.getElementById('heatmapContainer');
    const allWithDates = rawData.filter(r => r.parsedDate);

    const hmStart = document.getElementById('hmDateStart')?.value || null;
    const hmEnd = document.getElementById('hmDateEnd')?.value || null;

    const withDates = allWithDates.filter(r => {
        const dk = getDateKey(r.parsedDate, currentTimezone);
        if (hmStart && dk < hmStart) return false;
        if (hmEnd && dk > hmEnd) return false;
        return true;
    });

    if (allWithDates.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div>No date data</div>';
        return;
    }

    const dayCounts = {};
    withDates.forEach(r => {
        const dk = getDateKey(r.parsedDate, currentTimezone);
        dayCounts[dk] = (dayCounts[dk] || 0) + 1;
    });

    let html = '<div style="position:relative">';

    if (heatmapView === 'day') {
        html += renderCalendarView(dayCounts, hmStart, hmEnd);
    } else if (heatmapView === 'week') {
        html += renderWeekBars(dayCounts, hmStart, hmEnd);
    } else {
        html += renderMonthBars(dayCounts, hmStart, hmEnd);
    }

    // Footer
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid rgba(37,99,235,0.06)">
        <div style="font-size:0.72rem;color:var(--text-muted)">${withDates.length} messages in range</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:0.65rem;color:var(--text-muted)">
            <span>Less</span>
            <div style="display:flex;gap:3px">
                ${[0,1,2,3,4,5].map(l => `<div class="heatmap-cell" data-level="${l}" style="width:12px;height:12px;border-radius:2px"></div>`).join('')}
            </div>
            <span>More</span>
        </div>
    </div>`;

    html += '<div id="hmTooltip" style="position:fixed;display:none;background:rgba(5,13,31,0.96);color:#f1f5f9;border:1px solid rgba(37,99,235,0.25);border-radius:8px;padding:8px 14px;font-size:0.78rem;pointer-events:none;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.5);white-space:nowrap"></div>';
    html += '</div>';
    container.innerHTML = html;
}

// ─── Day View: Monthly Calendar ──────────────────────
function renderCalendarView(dayCounts, hmStart, hmEnd) {
    const now = new Date();
    const endMonth = hmEnd ? new Date(hmEnd + 'T00:00:00') : now;
    const startMonth = hmStart ? new Date(hmStart + 'T00:00:00') : new Date(endMonth.getFullYear(), endMonth.getMonth() - 1, 1);

    // Collect months to show
    const months = [];
    let cur = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
    const endLimit = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0);
    while (cur <= endLimit) {
        months.push({ year: cur.getFullYear(), month: cur.getMonth() });
        cur.setMonth(cur.getMonth() + 1);
    }
    if (months.length > 3) months.splice(0, months.length - 3);

    const maxCount = Math.max(...Object.values(dayCounts), 1);
    const getLevel = (c) => {
        if (!c) return 0;
        const r = c / maxCount;
        return r <= 0.2 ? 1 : r <= 0.4 ? 2 : r <= 0.6 ? 3 : r <= 0.8 ? 4 : 5;
    };

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    let html = `<div style="display:grid;grid-template-columns:repeat(${Math.min(months.length, 3)},1fr);gap:24px">`;

    months.forEach(({ year, month }) => {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayKey = now.toISOString().slice(0, 10);

        html += '<div>';
        html += `<div style="text-align:center;font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:10px">${monthNames[month]} ${year}</div>`;

        // Day headers
        html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px">';
        dayNames.forEach(d => {
            html += `<div style="text-align:center;font-size:0.6rem;font-weight:500;color:var(--text-muted);padding:2px 0">${d}</div>`;
        });
        html += '</div>';

        // Calendar grid
        html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';

        for (let i = 0; i < firstDay; i++) {
            html += '<div style="aspect-ratio:1"></div>';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dk = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const count = dayCounts[dk] || 0;
            const level = getLevel(count);
            const isToday = dk === todayKey;
            const dayLabel = new Date(dk + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            const todayRing = isToday ? 'box-shadow:0 0 0 2px var(--accent);' : '';
            const countBadge = count > 0 ? `<div style="font-size:0.5rem;font-weight:700;color:rgba(255,255,255,0.9);line-height:1">${count}</div>` : '';

            html += `<div class="heatmap-cell" data-level="${level}" 
                onmouseenter="showHmTip(event,'${dayLabel}',${count})" 
                onmouseleave="hideHmTip()" 
                style="aspect-ratio:1;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;${todayRing}">
                <div style="font-size:0.62rem;font-weight:${count > 0 ? '600' : '400'};color:${count > 0 ? 'rgba(255,255,255,0.95)' : 'var(--text-muted)'};line-height:1">${day}</div>
                ${countBadge}
            </div>`;
        }
        html += '</div></div>';
    });

    html += '</div>';
    return html;
}

// ─── Week View: Horizontal Bars ──────────────────────
function renderWeekBars(dayCounts, hmStart, hmEnd) {
    const weekData = {};
    Object.entries(dayCounts).forEach(([dk, count]) => {
        if (hmStart && dk < hmStart) return;
        if (hmEnd && dk > hmEnd) return;
        const wk = getWeekKey(new Date(dk + 'T00:00:00Z'), 'UTC');
        weekData[wk] = (weekData[wk] || 0) + count;
    });

    const entries = Object.entries(weekData).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) return '<div style="text-align:center;padding:24px;color:var(--text-muted)">No data in selected range</div>';

    const maxVal = Math.max(...entries.map(e => e[1]), 1);

    let html = '<div style="display:flex;flex-direction:column;gap:6px">';
    entries.forEach(([wk, count]) => {
        const start = new Date(wk + 'T00:00:00Z');
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ' – ' + end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const pct = Math.max(6, (count / maxVal) * 100);

        html += `<div style="display:grid;grid-template-columns:130px 1fr 44px;align-items:center;gap:10px;padding:5px 8px;border-radius:6px;transition:background 0.15s" 
            onmouseenter="this.style.background='rgba(37,99,235,0.04)';showHmTip(event,'Week: ${label}',${count})" 
            onmouseleave="this.style.background='transparent';hideHmTip()">
            <div style="font-size:0.72rem;color:var(--text-secondary);text-align:right;font-weight:500">${label}</div>
            <div style="height:20px;border-radius:10px;overflow:hidden;background:rgba(37,99,235,0.06)">
                <div style="width:${pct}%;height:100%;border-radius:10px;background:linear-gradient(90deg,rgba(37,99,235,0.45),rgba(37,99,235,0.85));transition:width 0.4s ease"></div>
            </div>
            <div style="font-size:0.75rem;font-weight:700;color:var(--text-primary);text-align:center">${count}</div>
        </div>`;
    });
    html += '</div>';
    return html;
}

// ─── Month View: Horizontal Bars ─────────────────────
function renderMonthBars(dayCounts, hmStart, hmEnd) {
    const monthData = {};
    Object.entries(dayCounts).forEach(([dk, count]) => {
        if (hmStart && dk < hmStart) return;
        if (hmEnd && dk > hmEnd) return;
        monthData[dk.slice(0, 7)] = (monthData[dk.slice(0, 7)] || 0) + count;
    });

    const entries = Object.entries(monthData).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) return '<div style="text-align:center;padding:24px;color:var(--text-muted)">No data in selected range</div>';

    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    let html = '<div style="display:flex;flex-direction:column;gap:8px">';
    entries.forEach(([mk, count]) => {
        const [y, m] = mk.split('-');
        const label = monthNames[parseInt(m) - 1] + ' ' + y;
        const pct = Math.max(6, (count / maxVal) * 100);

        html += `<div style="display:grid;grid-template-columns:120px 1fr 44px;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;transition:background 0.15s" 
            onmouseenter="this.style.background='rgba(37,99,235,0.04)';showHmTip(event,'${label}',${count})" 
            onmouseleave="this.style.background='transparent';hideHmTip()">
            <div style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);text-align:right">${label}</div>
            <div style="height:24px;border-radius:12px;overflow:hidden;background:rgba(37,99,235,0.06)">
                <div style="width:${pct}%;height:100%;border-radius:12px;background:linear-gradient(90deg,rgba(37,99,235,0.4),rgba(37,99,235,0.9));transition:width 0.4s ease"></div>
            </div>
            <div style="font-size:0.82rem;font-weight:700;color:var(--text-primary);text-align:center">${count}</div>
        </div>`;
    });
    html += '</div>';
    return html;
}

function showHmTip(e, label, count) {
    const tip = document.getElementById('hmTooltip');
    if (!tip) return;
    tip.innerHTML = `<div style="font-weight:600;margin-bottom:2px">${label}</div><div style="color:var(--accent-light)">${count} message${count !== 1 ? 's' : ''}</div>`;
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY - 44) + 'px';
}

function hideHmTip() {
    const tip = document.getElementById('hmTooltip');
    if (tip) tip.style.display = 'none';
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
