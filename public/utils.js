/* ─── utils.js — Timestamp parsing & helpers ─── */

const PERSONS = ['Anirudh', 'Kaushik', 'Pranav', 'Varshith'];
const PERSON_COLORS = {
    Anirudh: { bg: 'rgba(37,99,235,0.8)', border: '#2563eb', light: 'rgba(37,99,235,0.12)' },
    Kaushik: { bg: 'rgba(59,130,246,0.8)', border: '#3b82f6', light: 'rgba(59,130,246,0.12)' },
    Pranav: { bg: 'rgba(99,102,241,0.8)', border: '#6366f1', light: 'rgba(99,102,241,0.12)' },
    Varshith: { bg: 'rgba(34,211,238,0.8)', border: '#22d3ee', light: 'rgba(34,211,238,0.12)' },
};

const INDUSTRY_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#22d3ee', '#f59e0b',
    '#10b981', '#f43f5e', '#3b82f6', '#a855f7', '#14b8a6',
    '#ef4444', '#84cc16', '#f97316', '#06b6d4', '#e879f9',
];

/**
 * Parse timestamp in M/D/YYYY H:mm:ss format
 * Returns a Date object or null if invalid
 */
function parseTimestamp(raw, tzName = 'Asia/Kolkata') {
    if (!raw || typeof raw !== 'string') return null;
    raw = raw.trim();

    // Try M/D/YYYY H:mm:ss or M/D/YYYY (date only)
    const matchFull = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    const matchDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const match = matchFull || matchDate;
    if (!match) return null;

    const [, month, day, year] = match;
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    const y = parseInt(year, 10);
    const h = matchFull ? parseInt(matchFull[4], 10) : 0;
    const mi = matchFull ? parseInt(matchFull[5], 10) : 0;
    const s = matchFull ? parseInt(matchFull[6], 10) : 0;

    if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

    // Create date string in the source timezone
    const isoStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // Use Intl to get offset for the timezone, then create proper Date
    try {
        // Create a temporary date to get the timezone offset
        const tempDate = new Date(isoStr + 'Z');
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tzName,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        });

        // We need to find the UTC offset for the given timezone
        // Strategy: the date isoStr is in the given timezone, so we need to convert it
        const parts = formatter.formatToParts(tempDate);
        const getPart = (type) => parts.find(p => p.type === type)?.value;

        // Get offset by comparing
        const utcDate = new Date(isoStr + 'Z');
        const tzDate = new Date(
            `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}Z`
        );
        const offsetMs = utcDate - tzDate;

        // The actual UTC time = local time in tzName - offset
        // Since isoStr is the local time in tzName:
        const localAsUTC = new Date(isoStr + 'Z');
        const actualUTC = new Date(localAsUTC.getTime() + offsetMs);

        if (isNaN(actualUTC.getTime())) return null;
        return actualUTC;
    } catch (e) {
        return null;
    }
}

/**
 * Format date for display in given timezone
 */
function formatDate(date, tzName = 'Asia/Kolkata') {
    if (!date) return '—';
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: tzName,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(date);
    } catch {
        return date.toISOString();
    }
}

function formatDateISO(date, tzName = 'Asia/Kolkata') {
    if (!date) return '';
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tzName,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        }).formatToParts(date);
        const get = t => parts.find(p => p.type === t)?.value;
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    } catch {
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }
}

function formatDateOnly(date, tzName = 'Asia/Kolkata') {
    if (!date) return '';
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tzName,
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(date);
        const get = t => parts.find(p => p.type === t)?.value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

function getTimezoneAbbr(tzName) {
    const abbrs = {
        'Asia/Kolkata': 'IST',
        'America/New_York': 'EST',
        'America/Chicago': 'CST',
        'America/Denver': 'MST',
        'America/Los_Angeles': 'PST',
        'Europe/London': 'GMT',
        'Europe/Berlin': 'CET',
        'Asia/Tokyo': 'JST',
        'Australia/Sydney': 'AEDT',
        'UTC': 'UTC',
    };
    return abbrs[tzName] || tzName;
}

/**
 * Get date key (YYYY-MM-DD) in timezone
 */
function getDateKey(date, tzName = 'Asia/Kolkata') {
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tzName,
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = t => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function getHour(date, tzName = 'Asia/Kolkata') {
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzName,
        hour: '2-digit', hour12: false,
    }).formatToParts(date);
    return parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
}

function getWeekKey(date, tzName = 'Asia/Kolkata') {
    const dk = getDateKey(date, tzName);
    if (!dk) return null;
    const d = new Date(dk + 'T00:00:00Z');
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setUTCDate(diff);
    return monday.toISOString().slice(0, 10);
}

function getMonthKey(date, tzName = 'Asia/Kolkata') {
    const dk = getDateKey(date, tzName);
    return dk ? dk.slice(0, 7) : null;
}

/**
 * Date range presets
 */
function getDateRangePreset(preset, tzName = 'Asia/Kolkata') {
    const now = new Date();
    const todayKey = getDateKey(now, tzName);
    const todayDate = new Date(todayKey + 'T00:00:00Z');

    switch (preset) {
        case 'today':
            return { start: todayKey, end: todayKey };
        case 'week': {
            const d = new Date(todayDate);
            const day = d.getUTCDay();
            const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
            d.setUTCDate(diff);
            return { start: d.toISOString().slice(0, 10), end: todayKey };
        }
        case 'month':
            return { start: todayKey.slice(0, 7) + '-01', end: todayKey };
        case 'year':
            return { start: todayKey.slice(0, 4) + '-01-01', end: todayKey };
        case 'all':
        default:
            return { start: null, end: null };
    }
}

function truncate(str, len = 80) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
