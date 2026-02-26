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
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&range=A${startRow}:E`;
}

async function fetchTabData(tab) {
  const url = buildSheetUrl(tab.name, tab.startRow);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    const records = parse(csv, {
      relax_column_count: true,
      skip_empty_lines: false,
      relax_quotes: true,
    });
    const rows = [];
    for (const r of records) {
      const link      = (r[0] || '').trim();
      const message   = (r[1] || '').trim();
      const notes     = (r[2] || '').trim();
      const industry  = (r[3] || '').trim();
      const tsRaw     = (r[4] || '').trim();

      // Skip rows without meaningful content (must have link or message)
      if (!link && !message) continue;

      // Detect if timestamp has time component
      const hasTime = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(tsRaw);

      rows.push({
        person:   tab.name,
        link,
        message,
        notes,
        industry: industry.toUpperCase(),
        timestampRaw: tsRaw,
        hasTime,
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
