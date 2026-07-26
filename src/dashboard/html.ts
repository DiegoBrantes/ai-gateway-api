/**
 * Self-contained usage dashboard. No build step, no external assets — it polls
 * `/metrics/summary` for consumption and `/ready` for a real health signal,
 * and renders loading / empty / error / populated states. Served at
 * `GET /dashboard` (which may be auth-protected via DASHBOARD_PUBLIC).
 *
 * Security note: all provider/model names from the API are inserted via
 * `textContent` / an escaper, never as raw HTML.
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
    --text: #e6edf3; --muted: #97a3b6; --accent: #5b9dff; --accent-2: #7c5cff;
    --ok: #33d17a; --warn: #e0a53d; --err: #f0616d; --radius: 14px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f8fc; --panel: #ffffff; --panel-2: #fbfcfe; --line: #e5e9f0;
      --text: #0f1626; --muted: #4a5566; --accent: #2f6fed; --accent-2: #6b4dff;
      --warn: #b9791f; --err: #d13440;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; overflow-x: hidden;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }

  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .logo {
    width: 40px; height: 40px; border-radius: 11px; flex: none;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: grid; place-items: center; font-size: 20px;
    box-shadow: 0 6px 18px -6px var(--accent);
  }
  .head-text { min-width: 0; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13.5px; margin: 2px 0 0;
    overflow: hidden; text-overflow: ellipsis; }
  .actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  button.ctl {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 9px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  button.ctl:hover { border-color: var(--accent); }
  button.ctl:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
    border: 1px solid var(--line);
  }
  .pill.ok  { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
  .pill.warn { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent); }
  .pill.err { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err);
    border-color: color-mix(in srgb, var(--err) 35%, transparent); }
  .pdot { width: 8px; height: 8px; border-radius: 50%; background: currentColor;
    box-shadow: 0 0 0 0 currentColor; animation: pulse 2s infinite; }
  @keyframes pulse { 70% { box-shadow: 0 0 0 7px transparent; } }
  @media (prefers-reduced-motion: reduce) { .pdot { animation: none; } .card { transition: none; } }

  .notice { margin: 18px 0 0; font-size: 12.5px; color: var(--muted);
    background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
    padding: 9px 13px; }
  .banner { margin: 18px 0 0; display: none; align-items: center; gap: 12px; flex-wrap: wrap;
    background: color-mix(in srgb, var(--err) 10%, var(--panel)); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--err) 40%, var(--line));
    border-radius: 10px; padding: 12px 14px; font-size: 13.5px; }
  .banner.show { display: flex; }

  .kpis { display: grid; gap: 14px; margin: 22px 0 8px;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 16px 18px;
    transition: transform .15s ease, border-color .15s ease;
  }
  .card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.06em; font-weight: 600; }
  .card .v { font-size: 28px; font-weight: 680; margin-top: 8px;
    font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .card .c { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .skeleton .v, .skeleton .k, .skeleton .c { color: transparent;
    background: linear-gradient(90deg, var(--line), var(--panel-2), var(--line));
    background-size: 200% 100%; border-radius: 6px; animation: shimmer 1.3s infinite; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .skeleton .v, .skeleton .k, .skeleton .c { animation: none; } }

  section { margin-top: 30px; }
  h2 { font-size: 13px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.07em; margin: 0 0 12px; }
  .panel { background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); overflow: hidden; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 520px; }
  caption { text-align: left; padding: 12px 18px 0; color: var(--muted); font-size: 12px; }
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
    display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); white-space: nowrap; }

  @media (max-width: 480px) {
    .wrap { padding: 20px 14px 48px; }
    .actions { width: 100%; margin-left: 0; }
    .card .v { font-size: 24px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo" aria-hidden="true">🧠</div>
      <div class="head-text">
        <h1>AI Gateway — Consumo</h1>
        <p class="sub">Uso e saúde em tempo real dos provedores</p>
      </div>
      <div class="actions">
        <span class="pill warn" id="status" role="status" aria-live="polite">
          <span class="pdot" aria-hidden="true"></span><span id="status-text">Verificando…</span>
        </span>
        <button class="ctl" id="pause" type="button" aria-pressed="false">⏸ Pausar</button>
        <button class="ctl" id="refresh" type="button">↻ Atualizar</button>
      </div>
    </header>

    <p class="notice" id="notice">
      As métricas são mantidas <strong>em memória</strong> nesta instância: zeram no
      reinício e não somam entre múltiplas instâncias.
    </p>

    <div class="banner" id="banner" role="alert">
      <span id="banner-text">Não foi possível carregar as métricas.</span>
      <button class="ctl" id="retry" type="button">Tentar novamente</button>
    </div>

    <div class="kpis" id="kpis" aria-busy="true"></div>

    <section>
      <h2>Por provedor</h2>
      <div class="panel scroll">
        <table>
          <caption class="visually-hidden">Consumo por provedor</caption>
          <thead><tr>
            <th scope="col">Provedor</th><th class="num" scope="col">Requisições</th>
            <th scope="col">Participação</th>
            <th class="num" scope="col">Em cache</th><th class="num" scope="col">Tokens</th>
            <th class="num" scope="col">Custo (USD)</th>
          </tr></thead>
          <tbody id="providers"></tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Por modelo</h2>
      <div class="panel scroll">
        <table>
          <caption class="visually-hidden">Consumo por modelo</caption>
          <thead><tr>
            <th scope="col">Modelo</th><th class="num" scope="col">Requisições</th>
            <th class="num" scope="col">Tokens</th><th class="num" scope="col">Custo (USD)</th>
          </tr></thead>
          <tbody id="models"></tbody>
        </table>
      </div>
    </section>

    <footer>
      <span id="updated">—</span>
      <a href="/openapi.json">OpenAPI →</a>
      <a href="/health">Health →</a>
    </footer>
  </div>

<script>
  const COLORS = { openai: '#33d17a', anthropic: '#e0823d', gemini: '#5b9dff', mock: '#8b98ad' };
  const colorFor = (name) => COLORS[name] || '#7c5cff';
  const fmt = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
  const usd = (n) => 'US$ ' + Number(n || 0).toFixed(4);
  const pct = (n) => (n * 100).toFixed(0) + '%';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let paused = false;
  let timer = null;

  function setStatus(kind, text) {
    const el = document.getElementById('status');
    el.className = 'pill ' + kind;
    document.getElementById('status-text').textContent = text;
  }
  function showBanner(msg) {
    document.getElementById('banner-text').textContent = msg;
    document.getElementById('banner').classList.add('show');
  }
  function hideBanner() { document.getElementById('banner').classList.remove('show'); }

  function skeleton() {
    const kpis = document.getElementById('kpis');
    kpis.setAttribute('aria-busy', 'true');
    kpis.innerHTML = Array.from({ length: 4 }, () =>
      '<div class="card skeleton"><div class="k">·····</div><div class="v">····</div><div class="c">···</div></div>').join('');
  }

  function card(k, v, c) {
    return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      '</div><div class="c">' + (c ? esc(c) : '&nbsp;') + '</div></div>';
  }

  async function refreshHealth() {
    try {
      const res = await fetch('/ready', { cache: 'no-store' });
      const body = await res.json();
      if (body.status === 'ready') setStatus('ok', 'Online');
      else if (body.status === 'degraded') setStatus('warn', 'Degradado');
      else setStatus('err', 'Indisponível');
    } catch { setStatus('err', 'Offline'); }
  }

  async function refresh() {
    await refreshHealth();
    try {
      const res = await fetch('/metrics/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { totals } = await res.json();
      hideBanner();

      const kpis = document.getElementById('kpis');
      kpis.setAttribute('aria-busy', 'false');
      const hitRate = totals.requests ? totals.cachedRequests / totals.requests : 0;
      kpis.innerHTML =
        card('Requisições', fmt(totals.requests), 'total processado') +
        card('Cache hit rate', pct(hitRate), fmt(totals.cachedRequests) + ' do cache') +
        card('Tokens', fmt(totals.totalTokens), 'entrada + saída') +
        card('Custo estimado', usd(totals.totalCostUsd),
          (totals.unpricedRequests ? fmt(totals.unpricedRequests) + ' sem preço' : 'estimado'));

      const provs = Object.entries(totals.byProvider || {});
      const maxReq = Math.max(1, ...provs.map(([, a]) => a.requests));
      document.getElementById('providers').innerHTML = provs.map(([name, a]) =>
        '<tr><td><span class="name"><span class="swatch" style="background:' + colorFor(name) +
        '"></span>' + esc(name) + '</span></td>' +
        '<td class="num">' + fmt(a.requests) + '</td>' +
        '<td><div class="bar" role="img" aria-label="' + pct(a.requests / maxReq) +
        ' das requisições"><span style="width:' + (a.requests / maxReq * 100) + '%"></span></div></td>' +
        '<td class="num">' + fmt(a.cachedRequests) + '</td>' +
        '<td class="num">' + fmt(a.totalTokens) + '</td>' +
        '<td class="num">' + usd(a.totalCostUsd) + '</td></tr>').join('') ||
        '<tr><td colspan="6" class="empty">Sem tráfego ainda — faça uma chamada em /v1/chat</td></tr>';

      document.getElementById('models').innerHTML = Object.entries(totals.byModel || {}).map(([name, a]) =>
        '<tr><td class="name">' + esc(name) + '</td>' +
        '<td class="num">' + fmt(a.requests) + '</td>' +
        '<td class="num">' + fmt(a.totalTokens) + '</td>' +
        '<td class="num">' + usd(a.totalCostUsd) + '</td></tr>').join('') ||
        '<tr><td colspan="4" class="empty">Sem dados ainda</td></tr>';

      document.getElementById('updated').textContent =
        'Última atualização: ' + new Date().toLocaleTimeString('pt-BR');
    } catch (e) {
      document.getElementById('kpis').setAttribute('aria-busy', 'false');
      setStatus('err', 'Offline');
      showBanner('Não foi possível carregar as métricas (' +
        (e && e.message ? e.message : 'erro') + ').');
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    if (!paused) timer = setInterval(refresh, 5000);
  }

  document.getElementById('pause').addEventListener('click', (ev) => {
    paused = !paused;
    ev.target.setAttribute('aria-pressed', String(paused));
    ev.target.textContent = paused ? '▶ Retomar' : '⏸ Pausar';
    schedule();
  });
  document.getElementById('refresh').addEventListener('click', refresh);
  document.getElementById('retry').addEventListener('click', refresh);

  skeleton();
  refresh();
  schedule();
</script>
</body>
</html>`;
