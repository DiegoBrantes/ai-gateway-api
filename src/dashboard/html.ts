/**
 * Self-contained usage dashboard. No build step, no external assets —
 * it polls `/metrics/summary` and renders live consumption per provider
 * and per model. Served at `GET /dashboard`.
 */
export const dashboardHtml = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Gateway · Consumo</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0b0f17; --panel: #121826; --panel-2: #0e1420; --line: #212a3b;
    --text: #e6edf3; --muted: #8b98ad; --accent: #5b9dff; --accent-2: #7c5cff;
    --ok: #33d17a; --radius: 14px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f8fc; --panel: #ffffff; --panel-2: #fbfcfe; --line: #e5e9f0;
      --text: #0f1626; --muted: #5b6675; --accent: #2f6fed; --accent-2: #6b4dff;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 64px; }

  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .logo {
    width: 40px; height: 40px; border-radius: 11px; flex: none;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: grid; place-items: center; font-size: 20px;
    box-shadow: 0 6px 18px -6px var(--accent);
  }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13.5px; margin: 2px 0 0; }
  .pill {
    margin-left: auto; display: inline-flex; align-items: center; gap: 7px;
    background: color-mix(in srgb, var(--ok) 14%, transparent);
    color: var(--ok); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent);
    padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  }
  .pdot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent);
    animation: pulse 2s infinite; }
  @keyframes pulse { 70% { box-shadow: 0 0 0 7px transparent; } }

  .kpis { display: grid; gap: 16px; margin: 28px 0 8px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 18px 20px;
    transition: transform .15s ease, border-color .15s ease;
  }
  .card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.06em; font-weight: 600; }
  .card .v { font-size: 30px; font-weight: 680; margin-top: 8px;
    font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .card .c { color: var(--muted); font-size: 12.5px; margin-top: 4px; }

  section { margin-top: 34px; }
  .h2 { display: flex; align-items: baseline; justify-content: space-between; }
  h2 { font-size: 13px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.07em; margin: 0 0 12px; }
  .panel { background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); overflow: hidden; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 520px; }
  th, td { text-align: left; padding: 13px 18px; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: none; }
  thead th { color: var(--muted); font-weight: 600; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.04em; background: var(--panel-2); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .name { display: flex; align-items: center; gap: 10px; font-weight: 550; }
  .swatch { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; min-width: 80px; }
  .bar > span { display: block; height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .empty { padding: 26px 18px; color: var(--muted); text-align: center; }

  footer { margin-top: 40px; color: var(--muted); font-size: 12.5px;
    display: flex; gap: 16px; flex-wrap: wrap; }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">🧠</div>
      <div>
        <h1>AI Gateway — Consumo</h1>
        <p class="sub">Uso em tempo real de todos os provedores · atualiza a cada 5s</p>
      </div>
      <span class="pill"><span class="pdot dot"></span>Online</span>
    </header>

    <div class="kpis" id="kpis"></div>

    <section>
      <div class="h2"><h2>Por provedor</h2></div>
      <div class="panel scroll">
        <table>
          <thead><tr>
            <th>Provedor</th><th class="num">Requisições</th><th>Participação</th>
            <th class="num">Em cache</th><th class="num">Tokens</th><th class="num">Custo (USD)</th>
          </tr></thead>
          <tbody id="providers"></tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="h2"><h2>Por modelo</h2></div>
      <div class="panel scroll">
        <table>
          <thead><tr>
            <th>Modelo</th><th class="num">Requisições</th><th class="num">Tokens</th><th class="num">Custo (USD)</th>
          </tr></thead>
          <tbody id="models"></tbody>
        </table>
      </div>
    </section>

    <footer>
      <span>AI Gateway API</span>
      <a href="/docs">Documentação da API →</a>
      <a href="/health">Health →</a>
    </footer>
  </div>

<script>
  // Stable, distinguishable colors per provider (accessible against both themes).
  const COLORS = { openai: '#33d17a', anthropic: '#e0823d', gemini: '#5b9dff',
    mock: '#8b98ad' };
  const colorFor = (name) => COLORS[name] || '#7c5cff';
  const fmt = (n) => new Intl.NumberFormat('pt-BR').format(n);
  const usd = (n) => 'US$ ' + Number(n).toFixed(4);
  const pct = (n) => (n * 100).toFixed(0) + '%';

  function card(k, v, c) {
    return '<div class="card"><div class="k">' + k + '</div><div class="v">' + v +
      '</div><div class="c">' + (c || '&nbsp;') + '</div></div>';
  }

  async function refresh() {
    try {
      const res = await fetch('/metrics/summary');
      const { totals } = await res.json();
      const hitRate = totals.requests ? totals.cachedRequests / totals.requests : 0;

      document.getElementById('kpis').innerHTML =
        card('Requisições', fmt(totals.requests), 'total processado') +
        card('Cache hit rate', pct(hitRate), fmt(totals.cachedRequests) + ' servidas do cache') +
        card('Tokens', fmt(totals.totalTokens), 'entrada + saída') +
        card('Custo total', usd(totals.totalCostUsd), 'estimado');

      const maxReq = Math.max(1, ...Object.values(totals.byProvider).map((a) => a.requests));
      document.getElementById('providers').innerHTML =
        Object.entries(totals.byProvider).map(([name, a]) =>
          '<tr><td><span class="name"><span class="swatch" style="background:' + colorFor(name) +
          '"></span>' + name + '</span></td>' +
          '<td class="num">' + fmt(a.requests) + '</td>' +
          '<td><div class="bar"><span style="width:' + (a.requests / maxReq * 100) + '%"></span></div></td>' +
          '<td class="num">' + fmt(a.cachedRequests) + '</td>' +
          '<td class="num">' + fmt(a.totalTokens) + '</td>' +
          '<td class="num">' + usd(a.totalCostUsd) + '</td></tr>').join('') ||
          '<tr><td colspan="6" class="empty">Sem dados ainda — faça uma chamada em /v1/chat</td></tr>';

      document.getElementById('models').innerHTML =
        Object.entries(totals.byModel).map(([name, a]) =>
          '<tr><td class="name">' + name + '</td>' +
          '<td class="num">' + fmt(a.requests) + '</td>' +
          '<td class="num">' + fmt(a.totalTokens) + '</td>' +
          '<td class="num">' + usd(a.totalCostUsd) + '</td></tr>').join('') ||
          '<tr><td colspan="4" class="empty">Sem dados ainda</td></tr>';
    } catch (e) { /* keep last render on transient errors */ }
  }
  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`;
