const express = require('express');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ──────────────────────────────────────────────
const SHEET_ID = '1e2LZH_zWNWOz4gVNXcA7bKzX_I2ZlB2YHAZ5qET0jkU';
const TABS = [
  { name: 'Anirudh',  startRow: 1839 },
  { name: 'Kaushik',  startRow: 28 },
  { name: 'Pranav',   startRow: 4 },
  { name: 'Varshith', startRow: 23 },
];

// ─── Cache ───────────────────────────────────────────────
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 30 * 1000; // 30 seconds

function buildSheetUrl(tabName, startRow) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}&range=A${startRow}:E`;
}

function parseGvizValue(cell) {
  if (!cell) return { value: '', hasTime: false };
  // If it's a date type: cell.v = "Date(2026,1,26)" or "Date(2026,1,26,9,15,15)"
  if (cell.v && typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
    const nums = cell.v.replace('Date(', '').replace(')', '').split(',').map(Number);
    const year = nums[0];
    const month = nums[1] + 1; // gviz months are 0-indexed
    const day = nums[2];
    const hour = nums[3] || 0;
    const min = nums[4] || 0;
    const sec = nums[5] || 0;
    const hasTime = nums.length > 3;
    const ts = `${month}/${day}/${year}${hasTime ? ` ${hour}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : ''}`;
    return { value: ts, hasTime };
  }
  // Formatted value fallback
  const f = (cell.f || cell.v || '').toString().trim();
  const hasTime = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(f);
  return { value: f, hasTime };
}

function parseGvizText(cell) {
  if (!cell) return '';
  return (cell.f || cell.v || '').toString().trim();
}

async function fetchTabData(tab) {
  const url = buildSheetUrl(tab.name, tab.startRow);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let text = await res.text();
    // Strip the JSONP wrapper: /*O_o*/google.visualization.Query.setResponse({...});
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1) throw new Error('Invalid response');
    const json = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

    const tableRows = json.table?.rows || [];
    const rows = [];

    for (const row of tableRows) {
      const cells = row.c || [];
      const link    = parseGvizText(cells[0]);
      const message = parseGvizText(cells[1]);
      const notes   = parseGvizText(cells[2]);
      const industry = parseGvizText(cells[3]);
      const tsInfo  = parseGvizValue(cells[4]);

      // Skip rows without meaningful content
      if (!link && !message) continue;

      rows.push({
        person:   tab.name,
        link,
        message,
        notes,
        industry: industry.toUpperCase(),
        timestampRaw: tsInfo.value,
        hasTime: tsInfo.hasTime,
      });
    }
    return rows;
  } catch (err) {
    console.error(`Error fetching ${tab.name}:`, err.message);
    return [];
  }
}

async function fetchAllData() {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const results = await Promise.all(TABS.map(t => fetchTabData(t)));
  const allRows = results.flat();

  // Deduplicate: flag rows with same link + timestampRaw
  const seen = new Map();
  for (const row of allRows) {
    const key = `${row.link}|${row.timestampRaw}`;
    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key).push(row);
  }
  for (const [key, group] of seen.entries()) {
    if (group.length > 1) {
      group.forEach((r, i) => { r.isDuplicate = i > 0; });
    }
  }

  cache.data = allRows;
  cache.timestamp = now;
  return allRows;
}

// ─── API: Get all data ───────────────────────────────────
app.get('/api/data', async (req, res) => {
  try {
    const data = await fetchAllData();
    res.json({
      rows: data,
      lastUpdated: new Date().toISOString(),
      tabs: TABS.map(t => t.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Force refresh ─────────────────────────────────
app.get('/api/refresh', async (req, res) => {
  cache.data = null;
  cache.timestamp = 0;
  try {
    const data = await fetchAllData();
    res.json({
      rows: data,
      lastUpdated: new Date().toISOString(),
      tabs: TABS.map(t => t.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Export CSV ─────────────────────────────────────
app.get('/api/export', async (req, res) => {
  try {
    const data = await fetchAllData();
    const format = req.query.format || 'csv';

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(data.map(r => ({
        Person: r.person,
        Link: r.link,
        Message: r.message,
        Notes: r.notes,
        Industry: r.industry,
        Timestamp: r.timestampRaw,
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Messages');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=messages_export.xlsx');
      return res.send(buf);
    }

    // CSV
    const header = 'Person,Link,Message,Notes,Industry,Timestamp\n';
    const csvRows = data.map(r =>
      [r.person, r.link, `"${(r.message||'').replace(/"/g,'""')}"`, `"${(r.notes||'').replace(/"/g,'""')}"`, r.industry, r.timestampRaw].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=messages_export.csv');
    res.send(header + csvRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve SPA ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
