/**
 * Self-contained usage dashboard. No build step, no external assets —
 * it polls `/metrics/summary` and renders live consumption per provider
 * and per model. Served at `GET /dashboard`.
 */
export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Gateway · Consumo</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0f17; --card:#151b28; --line:#232c3d;
    --text:#e6edf3; --muted:#8b98ad; --accent:#5b9dff; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;
    background:var(--bg); color:var(--text); padding:32px; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 28px; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  .card .k { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:28px; font-weight:650; margin-top:6px; }
  section { margin-top:32px; }
  h2 { font-size:15px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:13px; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-right:8px; }
  footer { margin-top:36px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
  <h1><span class="dot"></span>AI Gateway — Consumo</h1>
  <p class="sub">Consumo em tempo real de todos os provedores · atualiza a cada 5s</p>

  <div class="grid" id="kpis"></div>

  <section>
    <h2>Por provedor</h2>
    <table><thead><tr><th>Provedor</th><th class="num">Requisições</th>
      <th class="num">Em cache</th><th class="num">Tokens</th><th class="num">Custo (USD)</th></tr></thead>
      <tbody id="providers"></tbody></table>
  </section>

  <section>
    <h2>Por modelo</h2>
    <table><thead><tr><th>Modelo</th><th class="num">Requisições</th>
      <th class="num">Tokens</th><th class="num">Custo (USD)</th></tr></thead>
      <tbody id="models"></tbody></table>
  </section>

  <footer>AI Gateway API · <a href="/docs" style="color:var(--accent)">Documentação da API →</a></footer>

<script>
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const usd = (n) => '$' + Number(n).toFixed(4);
  function card(k, v) { return '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }

  async function refresh() {
    try {
      const res = await fetch('/metrics/summary');
      const { totals } = await res.json();
      document.getElementById('kpis').innerHTML =
        card('Requisições', fmt(totals.requests)) +
        card('Em cache', fmt(totals.cachedRequests)) +
        card('Total de tokens', fmt(totals.totalTokens)) +
        card('Custo total', usd(totals.totalCostUsd));

      document.getElementById('providers').innerHTML =
        Object.entries(totals.byProvider).map(([name, a]) =>
          '<tr><td>'+name+'</td><td class="num">'+fmt(a.requests)+'</td><td class="num">'+
          fmt(a.cachedRequests)+'</td><td class="num">'+fmt(a.totalTokens)+'</td><td class="num">'+
          usd(a.totalCostUsd)+'</td></tr>').join('') || '<tr><td colspan="5">Sem dados ainda</td></tr>';

      document.getElementById('models').innerHTML =
        Object.entries(totals.byModel).map(([name, a]) =>
          '<tr><td>'+name+'</td><td class="num">'+fmt(a.requests)+'</td><td class="num">'+
          fmt(a.totalTokens)+'</td><td class="num">'+usd(a.totalCostUsd)+'</td></tr>').join('') ||
          '<tr><td colspan="4">Sem dados ainda</td></tr>';
    } catch (e) { /* keep last render on transient errors */ }
  }
  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`;
