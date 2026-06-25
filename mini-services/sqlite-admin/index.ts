import { Database } from 'bun:sqlite'
import { serve } from 'bun'

const PORT = 3031
const DB_PATH = new URL('../../db/custom.db', import.meta.url).pathname

// Try to open DB, handle missing file
let db: Database
try {
  db = new Database(DB_PATH, { readonly: false, create: false })
} catch {
  db = new Database(DB_PATH, { readonly: false, create: true })
}

// HTML page
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SQLite Admin - StreamVault</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d0d0d; color: #e0e0e0; min-height: 100vh; }
  .header { background: #141414; border-bottom: 1px solid #333; padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; color: #fff; }
  .header .db { color: #888; font-size: 12px; font-family: monospace; }
  .header .port { background: #e50914; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
  .container { padding: 16px 20px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 8px 16px; border: 1px solid #333; background: #1a1a1a; color: #aaa; cursor: pointer; border-radius: 6px; font-size: 13px; }
  .tab:hover { background: #252525; color: #fff; }
  .tab.active { background: #e50914; color: #fff; border-color: #e50914; }
  .panel { display: none; }
  .panel.active { display: block; }

  /* Tables panel */
  .tables-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .table-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.15s; }
  .table-card:hover { border-color: #e50914; transform: translateY(-1px); }
  .table-card h3 { font-size: 15px; color: #fff; margin-bottom: 4px; }
  .table-card .count { font-size: 12px; color: #888; }

  /* Data view */
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .toolbar button { padding: 6px 14px; border: 1px solid #333; background: #1a1a1a; color: #ddd; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover { background: #333; }
  .toolbar input { padding: 6px 10px; border: 1px solid #333; background: #1a1a1a; color: #fff; border-radius: 4px; font-size: 12px; width: 200px; }
  .table-wrapper { overflow-x: auto; border: 1px solid #333; border-radius: 8px; background: #111; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1a1a1a; color: #aaa; text-align: left; padding: 8px 12px; border-bottom: 1px solid #333; position: sticky; top: 0; white-space: nowrap; }
  td { padding: 6px 12px; border-bottom: 1px solid #222; white-space: nowrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
  tr:hover td { background: #1a1a1a; }
  td.truncated { color: #666; font-style: italic; }

  /* SQL console */
  .sql-area { display: flex; flex-direction: column; gap: 12px; }
  textarea { width: 100%; min-height: 100px; background: #1a1a1a; border: 1px solid #333; color: #0f0; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 13px; padding: 12px; border-radius: 8px; resize: vertical; }
  .sql-result { background: #111; border: 1px solid #333; border-radius: 8px; overflow: auto; max-height: 400px; }
  .sql-meta { padding: 8px 12px; background: #1a1a1a; border-bottom: 1px solid #333; font-size: 12px; color: #888; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-card .num { font-size: 28px; font-weight: bold; color: #fff; }
  .stat-card .label { font-size: 12px; color: #888; margin-top: 4px; }

  .btn-danger { border-color: #7f1d1d !important; color: #fca5a5 !important; }
  .btn-danger:hover { background: #7f1d1d !important; }

  .back-btn { font-size: 12px; color: #e50914; cursor: pointer; background: none; border: none; padding: 4px 0; }
  .back-btn:hover { text-decoration: underline; }
  .limit-info { font-size: 11px; color: #666; }
</style>
</head>
<body>

<div class="header">
  <h1>SQLite Admin</h1>
  <span class="port">Puerto ${PORT}</span>
  <span class="db">${DB_PATH.split('/').pop()}</span>
</div>

<div class="container">
  <div class="tabs">
    <button class="tab active" onclick="showPanel('stats')">Estadisticas</button>
    <button class="tab" onclick="showPanel('tables')">Tablas</button>
    <button class="tab" onclick="showPanel('sql')">SQL</button>
  </div>

  <!-- Stats -->
  <div id="panel-stats" class="panel active">
    <div class="stats-grid" id="stats-grid"></div>
    <div id="stats-details"></div>
  </div>

  <!-- Tables -->
  <div id="panel-tables" class="panel">
    <div class="tables-grid" id="tables-grid"></div>
    <div id="table-view" style="display:none">
      <div class="toolbar">
        <button class="back-btn" onclick="hideTableView()">&#8592; Volver</button>
        <span id="table-title" style="font-weight:600;color:#fff"></span>
        <input id="search-input" placeholder="Buscar..." oninput="filterTable()" />
        <button onclick="loadTable(currentTable)">Recargar</button>
        <span class="limit-info" id="row-info"></span>
      </div>
      <div class="table-wrapper" style="max-height:60vh;overflow:auto">
        <table id="data-table">
          <thead id="data-thead"></thead>
          <tbody id="data-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- SQL -->
  <div id="panel-sql" class="panel">
    <div class="sql-area">
      <textarea id="sql-input" placeholder="SELECT * FROM Movie WHERE type = 'movie' LIMIT 20;">SELECT * FROM Movie WHERE type = 'movie' LIMIT 20;</textarea>
      <div style="display:flex;gap:8px">
        <button onclick="runSQL()" style="background:#e50914;border-color:#e50914;color:#fff;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px">Ejecutar (Ctrl+Enter)</button>
        <span id="sql-time" style="font-size:12px;color:#888;line-height:32px"></span>
      </div>
      <div class="sql-result" id="sql-result" style="display:none">
        <div class="sql-meta" id="sql-meta"></div>
        <table>
          <thead id="sql-thead"></thead>
          <tbody id="sql-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script>
let currentTable = '';
let currentData = [];
let currentColumns = [];

// Ctrl+Enter shortcut
document.getElementById('sql-input').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') runSQL();
});

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'stats') loadStats();
  if (name === 'tables') loadTables();
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = data.stats.map(s =>
    '<div class="stat-card"><div class="num">' + s.count + '</div><div class="label">' + s.label + '</div></div>'
  ).join('');

  const details = document.getElementById('stats-details');
  if (data.enriched) {
    details.innerHTML = '<div style="margin-top:12px;padding:12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;font-size:12px;color:#aaa">' +
      '<strong style="color:#fff">Estado OMDB:</strong><br>' +
      'Con poster: <span style="color:#4ade80">' + data.enriched.withPoster + '</span> | ' +
      'Con descripcion: <span style="color:#4ade80">' + data.enriched.withDesc + '</span> | ' +
      'Con imdbId: <span style="color:#4ade80">' + data.enriched.withImdb + '</span> | ' +
      'Sin datos: <span style="color:#facc15">' + data.enriched.needsEnrich + '</span>' +
    '</div>';
  }
}

async function loadTables() {
  hideTableView();
  const res = await fetch('/api/tables');
  const data = await res.json();
  const grid = document.getElementById('tables-grid');
  grid.innerHTML = data.map(t =>
    '<div class="table-card" onclick="openTable(\\'' + t.name + '\\')"><h3>' + t.name + '</h3><div class="count">' + t.count + ' registros</div></div>'
  ).join('');
}

async function openTable(name) {
  currentTable = name;
  document.getElementById('tables-grid').style.display = 'none';
  document.getElementById('table-view').style.display = 'block';
  document.getElementById('table-title').textContent = name;
  await loadTable(name);
}

function hideTableView() {
  document.getElementById('tables-grid').style.display = '';
  document.getElementById('table-view').style.display = 'none';
}

async function loadTable(name) {
  const res = await fetch('/api/data?table=' + encodeURIComponent(name) + '&limit=500');
  const data = await res.json();
  currentColumns = data.columns;
  currentData = data.rows;
  renderTable(data.rows, data.columns);
}

function renderTable(rows, cols) {
  const thead = document.getElementById('data-thead');
  thead.innerHTML = '<tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '<th>Acciones</th></tr>';
  const tbody = document.getElementById('data-tbody');
  tbody.innerHTML = rows.map(row =>
    '<tr>' + cols.map(c => {
      const v = row[c];
      if (v === null) return '<td style="color:#555">NULL</td>';
      const s = String(v);
      const display = s.length > 80 ? s.substring(0, 80) + '...' : s;
      return '<td title="' + s.replace(/"/g, '&quot;') + '"' + (s.length > 80 ? ' class="truncated"' : '') + '>' + display.replace(/</g, '&lt;') + '</td>';
    }).join('') + '<td><button class="btn-danger" onclick="deleteRow(\\'' + row.id + '\\')" style="font-size:11px;padding:2px 8px">Eliminar</button></td></tr>'
  ).join('');
  document.getElementById('row-info').textContent = rows.length + ' filas';
}

function filterTable() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = currentData.filter(row =>
    currentColumns.some(c => String(row[c] || '').toLowerCase().includes(q))
  );
  renderTable(filtered, currentColumns);
}

async function deleteRow(id) {
  if (!confirm('Eliminar registro ' + id + '?')) return;
  await fetch('/api/data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: currentTable, id })
  });
  loadTable(currentTable);
}

async function runSQL() {
  const sql = document.getElementById('sql-input').value.trim();
  if (!sql) return;
  const start = performance.now();
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    const data = await res.json();
    const elapsed = (performance.now() - start).toFixed(1);
    document.getElementById('sql-time').textContent = elapsed + 'ms';
    const resultDiv = document.getElementById('sql-result');
    const metaDiv = document.getElementById('sql-meta');

    if (data.error) {
      metaDiv.innerHTML = '<span style="color:#f87171">Error: ' + data.error + '</span>';
      resultDiv.style.display = 'block';
      document.getElementById('sql-thead').innerHTML = '';
      document.getElementById('sql-tbody').innerHTML = '';
      return;
    }

    if (data.rows) {
      const cols = data.columns;
      metaDiv.textContent = data.rows.length + ' filas en ' + elapsed + 'ms';
      document.getElementById('sql-thead').innerHTML = '<tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>';
      document.getElementById('sql-tbody').innerHTML = data.rows.map(row =>
        '<tr>' + cols.map(c => {
          const v = row[c];
          if (v === null) return '<td style="color:#555">NULL</td>';
          const s = String(v);
          const display = s.length > 100 ? s.substring(0, 100) + '...' : s;
          return '<td title="' + s.replace(/"/g, '&quot;') + '">' + display.replace(/</g, '&lt;') + '</td>';
        }).join('') + '</tr>'
      ).join('');
    } else {
      metaDiv.textContent = 'OK: ' + data.changes + ' fila(s) afectada(s) en ' + elapsed + 'ms';
      document.getElementById('sql-thead').innerHTML = '';
      document.getElementById('sql-tbody').innerHTML = '';
    }
    resultDiv.style.display = 'block';
  } catch (err) {
    document.getElementById('sql-meta').innerHTML = '<span style="color:#f87171">Error: ' + err.message + '</span>';
    document.getElementById('sql-result').style.display = 'block';
  }
}

// Load stats on start
loadStats();
</script>
</body>
</html>`

// ─── API Routes ────────────────────────────────────────────────────

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Serve HTML page
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Stats
    if (url.pathname === '/api/stats') {
      try {
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
        const stats = tables.map(t => {
          const count = (db.query("SELECT COUNT(*) as c FROM [" + t.name + "]").get() as { c: number }).c
          return { label: t.name, count }
        })

        let enriched: Record<string, number> | null = null
        try {
          const all = db.query("SELECT * FROM Movie WHERE local = 1").all() as any[]
          enriched = {
            withPoster: all.filter(m => m.coverImage && !m.coverImage.includes('default')).length,
            withDesc: all.filter(m => m.description && m.description.length > 0).length,
            withImdb: all.filter(m => m.imdbId).length,
            needsEnrich: all.filter(m => !m.imdbId || !m.coverImage || m.coverImage.includes('default')).length,
          }
        } catch {}

        return Response.json({ stats, enriched })
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    // Tables list
    if (url.pathname === '/api/tables') {
      try {
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
        const result = tables.map(t => {
          const count = (db.query("SELECT COUNT(*) as c FROM [" + t.name + "]").get() as { c: number }).c
          return { name: t.name, count }
        })
        return Response.json(result)
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    // Table data
    if (url.pathname === '/api/data' && req.method === 'GET') {
      const table = url.searchParams.get('table')
      const limit = parseInt(url.searchParams.get('limit') || '500')
      if (!table) return Response.json({ error: 'Missing table' }, { status: 400 })
      try {
        // Validate table name (prevent SQL injection)
        const validTables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
        if (!validTables.some(t => t.name === table)) {
          return Response.json({ error: 'Invalid table' }, { status: 400 })
        }
        const rows = db.query("SELECT * FROM [" + table + "] LIMIT " + limit).all()
        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
        return Response.json({ rows, columns })
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    // Delete row
    if (url.pathname === '/api/data' && req.method === 'DELETE') {
      try {
        const body = await req.json()
        const { table, id } = body
        if (!table || !id) return Response.json({ error: 'Missing table or id' }, { status: 400 })
        const validTables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
        if (!validTables.some(t => t.name === table)) {
          return Response.json({ error: 'Invalid table' }, { status: 400 })
        }
        db.query("DELETE FROM [" + table + "] WHERE id = ?").run(id)
        return Response.json({ success: true })
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    // SQL query
    if (url.pathname === '/api/query' && req.method === 'POST') {
      try {
        const body = await req.json()
        const sql: string = body.sql?.trim()
        if (!sql) return Response.json({ error: 'Empty query' }, { status: 400 })

        // Prevent dangerous operations
        const upper = sql.toUpperCase()
        if (upper.includes('DROP TABLE') || upper.includes('ALTER TABLE')) {
          return Response.json({ error: 'DROP TABLE y ALTER TABLE no permitidos. Usa el boton "Limpiar Base de Datos" en StreamVault.' }, { status: 400 })
        }

        if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA')) {
          const rows = db.query(sql).all()
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []
          return Response.json({ rows, columns })
        } else {
          const result = db.query(sql).run()
          return Response.json({ changes: result.changes })
        }
      } catch (e: any) {
        return Response.json({ error: e.message || String(e) })
      }
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log('[SQLite Admin] Corriendo en http://localhost:' + PORT)