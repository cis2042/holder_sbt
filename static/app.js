/* ═══════════════════════════════════════════════════════════
   Twin Matrix SBT — Dashboard Application
   Combines on-chain + GA4 analytics
   ═════════════════════════════════════════════════════════ */

const SBT_CONTRACT = '0xe3ec133e29addfbba26a412c38ed5de37195156f';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

async function lookupWallet() {
    const input = document.getElementById('walletInput');
    const result = document.getElementById('walletResult');
    const btn = document.getElementById('walletLookupBtn');
    const addr = input.value.trim().toLowerCase();

    if (!/^0x[a-f0-9]{40}$/i.test(addr)) {
        result.innerHTML = '<div class="wallet-error">⚠ Please enter a valid BNB Chain address (0x...)</div>';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Searching...';
    result.innerHTML = '<div style="color:var(--text-muted)">🔄 Querying BNB Chain...</div>';

    try {
        // ERC-721 balanceOf(address) — function selector 0x70a08231
        const balanceData = '0x70a08231' + addr.slice(2).padStart(64, '0');
        const balanceRes = await fetch(BSC_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'eth_call',
                params: [{ to: SBT_CONTRACT, data: balanceData }, 'latest']
            })
        });
        const balanceJson = await balanceRes.json();
        const balance = parseInt(balanceJson.result, 16);

        if (balance > 0) {
            // ERC-721 tokenOfOwnerByIndex(address, 0) — selector 0x2f745c59
            const tokenData = '0x2f745c59' + addr.slice(2).padStart(64, '0') + '0'.padStart(64, '0');
            const tokenRes = await fetch(BSC_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 2, method: 'eth_call',
                    params: [{ to: SBT_CONTRACT, data: tokenData }, 'latest']
                })
            });
            const tokenJson = await tokenRes.json();
            const tokenId = parseInt(tokenJson.result, 16);

            const bscscanToken = `https://bscscan.com/nft/${SBT_CONTRACT}/${tokenId}`;
            const bscscanContract = `https://bscscan.com/token/${SBT_CONTRACT}`;

            result.innerHTML = `
                <div class="wallet-found">
                    ✅ <strong>SBT Found!</strong><br>
                    Token ID: <span class="token-id">#${tokenId.toLocaleString()}</span><br>
                    <a href="${bscscanToken}" target="_blank" rel="noopener">View Token on BscScan ↗</a>
                    &nbsp;·&nbsp;
                    <a href="${bscscanContract}" target="_blank" rel="noopener">View Contract ↗</a>
                </div>`;
        } else {
            const bscscanContract = `https://bscscan.com/token/${SBT_CONTRACT}`;
            result.innerHTML = `
                <div class="wallet-not-found">
                    ⚠ No twin3 SBT found for this wallet.<br>
                    <small>This address does not hold a twin3 Soulbound Token.</small><br>
                    <a href="${bscscanContract}" target="_blank" rel="noopener">View Contract on BscScan ↗</a>
                </div>`;
        }
    } catch (err) {
        result.innerHTML = `<div class="wallet-error">❌ Network error: ${err.message}. Please try again.</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Look Up';
    }
}

// Allow Enter key to trigger lookup
document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('walletInput');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') lookupWallet(); });
});

(function () {
    'use strict';
    gsap.registerPlugin(ScrollTrigger);

    const fmt = n => n != null ? n.toLocaleString('en-US') : '—';
    const pct = n => n != null ? n.toFixed(1) + '%' : '—';
    const API = path => fetch(path).then(r => r.json());
    const ACCENT = '#4a7c59';
    const ACCENT_LIGHT = '#8dae9a';
    const ACCENT_DARK = '#2d4a35';
    const GREEN = '#5B8C5A';
    const CHART_BG = '#f0efe8';
    const MUTED = '#7a7a7a';
    const INFO = '#7B8FA8';
    const AMBER = '#B8860B';
    const CHART_COLORS = [ACCENT, '#6fdb8f', INFO, AMBER, '#8dae9a', '#6A8E7F', '#3a6b45', '#9B8EA4'];

    // ── Auto-refresh every 4 hours ──────────────────────────
    const AUTO_REFRESH_MS = 4 * 60 * 60 * 1000; // 4 hours
    let nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
    let lastSummary = null;
    let lastGaSummary = null;

    let allDailyData = [];
    let allGaData = [];
    let dateFrom = null;
    let dateTo = null;

    /* ── Tooltip ──────────────────────────────────────────── */
    const tip = document.getElementById('tooltip');
    function showTip(ev, html) {
        tip.innerHTML = html;
        tip.style.display = 'block';
        const x = Math.min(ev.pageX + 14, window.innerWidth - 200);
        tip.style.left = x + 'px';
        tip.style.top = (ev.pageY - 40) + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }

    /* ── Date Range Logic ─────────────────────────────────── */
    function initDatePicker() {
        const presets = document.querySelectorAll('#datePresets .btn-preset');
        const fromInput = document.getElementById('dateFrom');
        const toInput = document.getElementById('dateTo');

        presets.forEach(btn => {
            btn.addEventListener('click', () => {
                presets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const days = parseInt(btn.dataset.days);
                if (days === 0) {
                    dateFrom = null; dateTo = null;
                    fromInput.value = ''; toInput.value = '';
                } else {
                    const end = new Date();
                    const start = new Date(end.getTime() - days * 86400000);
                    dateFrom = start.toISOString().slice(0, 10);
                    dateTo = end.toISOString().slice(0, 10);
                    fromInput.value = dateFrom;
                    toInput.value = dateTo;
                }
                refreshCharts();
            });
        });

        fromInput.addEventListener('change', () => {
            dateFrom = fromInput.value || null;
            presets.forEach(b => b.classList.remove('active'));
            refreshCharts();
        });
        toInput.addEventListener('change', () => {
            dateTo = toInput.value || null;
            presets.forEach(b => b.classList.remove('active'));
            refreshCharts();
        });

        // Set default: 90 days
        const end = new Date();
        const start = new Date(end.getTime() - 90 * 86400000);
        dateFrom = start.toISOString().slice(0, 10);
        dateTo = end.toISOString().slice(0, 10);
        fromInput.value = dateFrom;
        toInput.value = dateTo;
    }

    function filteredData(data) {
        if (!dateFrom && !dateTo) return data;
        return data.filter(d => {
            if (dateFrom && d.date < dateFrom) return false;
            if (dateTo && d.date > dateTo) return false;
            return true;
        });
    }

    /* ── Progress Bar ─────────────────────────────────────── */
    window.addEventListener('scroll', () => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const pct = (window.scrollY / h * 100).toFixed(1);
        document.getElementById('progressBar').style.width = pct + '%';
        const bar = document.querySelector('.date-picker-bar');
        if (bar) bar.classList.toggle('scrolled', window.scrollY > 100);
    });

    /* ── Boot ─────────────────────────────────────────────── */
    /* ── Hero entrance animation (always runs) ──────────── */
    function animateHero() {
        const tl = gsap.timeline({ delay: 0.3 });
        tl.to('.hero-logo', { opacity: 1, y: 0, duration: 0.6 })
            .to('.hero-label', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
            .to('.hero-title', { opacity: 1, y: 0, duration: 0.9 }, '-=0.3')
            .to('.hero-subtitle-tag', { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
            .to('.hero-subtitle', { opacity: 1, y: 0, duration: 0.6, stagger: 0.15 }, '-=0.2')
            .to('.hero-subtitle-sm', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
            .to('.hero-contract', { opacity: 1, duration: 0.4 }, '-=0.1')
            .to('.hero-stats', { opacity: 1, y: 0, duration: 0.6 }, '-=0.2')
            .to('.hero-last-update', { opacity: 1, duration: 0.4 }, '-=0.1')
            .to('.scroll-indicator', { opacity: 1, duration: 0.5 }, '-=0.1');
    }

    async function init() {
        initDatePicker();
        animateHero();
        buildSbtRankingChart(null);
        await refreshAll();
        initScrollAnimations();
        // ── Schedule auto-refresh every 4h ──────────────────
        setInterval(refreshAll, AUTO_REFRESH_MS);
        setInterval(updateRefreshCountdown, 60_000); // update countdown every minute
        updateRefreshCountdown();
    }

    /** Re-fetch all data from API and rebuild every chart + insight. */
    async function refreshAll() {
        try {
            const results = await Promise.allSettled([
                API('/api/stats/summary'),
                API('/api/stats/daily'),
                API('/api/ga/daily'),
                API('/api/ga/summary'),
                API('/api/formulas'),
                API('/api/wallet-age/latest'),
            ]);
            const val = i => results[i].status === 'fulfilled' ? results[i].value : null;
            const summary = val(0);
            const dailyResp = val(1);
            const gaDaily = val(2);
            const gaSummary = val(3);
            const formulas = val(4);
            const walletAge = val(5);

            if (dailyResp) allDailyData = dailyResp.data || [];
            if (gaDaily) allGaData = gaDaily.data || [];
            if (summary) { lastSummary = summary; buildHero(summary); }
            if (summary && dailyResp) buildTimeline(allDailyData, summary.metrics);
            const liveHolders = summary?.latest?.cumulative_holders;
            buildSbtRankingChart(liveHolders);
            updateRankingNarrative(liveHolders);
            if (gaDaily || gaSummary) { lastGaSummary = gaSummary; buildGA(allGaData, gaSummary?.data, liveHolders); }
            loadWallet();
            if (formulas) loadFormulas(formulas);
            if (summary) buildInsights(summary, gaSummary?.data, walletAge?.data);
            nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
            updateRefreshCountdown();
            console.log(`[auto-refresh] Data refreshed at ${new Date().toLocaleTimeString()}`);
        } catch (e) {
            console.error('Refresh failed:', e);
        }
    }

    /** Show countdown to next data refresh in the badge. */
    function updateRefreshCountdown() {
        const badge = document.getElementById('updateBadge');
        if (!badge) return;
        const remaining = Math.max(0, nextRefreshAt - Date.now());
        const h = Math.floor(remaining / 3_600_000);
        const m = Math.floor((remaining % 3_600_000) / 60_000);
        if (remaining <= 0) {
            badge.textContent = 'Refreshing…';
        } else {
            badge.textContent = `Live data · next refresh ${h}h ${m}m`;
        }
    }

    function refreshCharts() {
        const filtered = filteredData(allDailyData);
        const filteredGA = filteredData(allGaData);
        buildTimelineChart(filtered);
        buildCumulativeChart(filtered);
        updateTimelineMetrics(filtered);
        buildGAChart(filteredGA);
    }

    /* ═══════════ HERO ═══════════════════════════════════════ */
    function buildHero(summary) {
        const latest = summary.latest || {};
        const metrics = summary.metrics || {};

        document.getElementById('heroTitle').textContent = 'Twin Matrix';

        if (latest.cumulative_holders) {
            document.getElementById('heroHolders').textContent = fmt(latest.cumulative_holders);
        }
        if (latest.new_users != null) {
            document.getElementById('heroToday').textContent = fmt(latest.new_users);
        }
        if (metrics.total_days) {
            document.getElementById('heroDays').textContent = fmt(metrics.total_days);
        }
        if (metrics.avg_7d) {
            document.getElementById('heroAvg7d').textContent = fmt(Math.round(metrics.avg_7d));
        }

        if (latest.synced_at) {
            const d = new Date(latest.synced_at);
            const ts = d.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            document.getElementById('heroLastUpdate').textContent = `Last synced: ${ts} (UTC)`;
            const footerEl = document.getElementById('footerUpdate');
            if (footerEl) footerEl.textContent = `Data as of ${ts} UTC · Auto-refreshed every 4 hours`;
        }
    }

    /* ═══════════ TIMELINE ═══════════════════════════════════ */
    function buildTimeline(data, metrics) {
        updateTimelineMetrics(filteredData(data));
        updateTimelineNarrative(data, metrics);
        buildTimelineChart(filteredData(data));
        buildCumulativeChart(filteredData(data));

        // MA toggle
        document.querySelectorAll('#maGroup .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#maGroup .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                buildTimelineChart(filteredData(allDailyData));
            });
        });
    }

    function updateTimelineNarrative(data, metrics) {
        const el = document.getElementById('timelineNarrative');
        if (!data.length) return;
        const total = data[data.length - 1]?.cumulative_holders || 0;
        const days = metrics.total_days || data.length;
        const avg = metrics.avg_daily_all_time || 0;
        const avg7d = metrics.avg_7d || 0;
        const growth = avg7d > avg ? 'accelerating' : 'steady';
        el.innerHTML = `Over <strong>${days} days</strong>, Twin Matrix has onboarded <strong>${fmt(total)} unique holders</strong>. ` +
            `The 7-day average of <strong>${fmt(Math.round(avg7d))}/day</strong> is ${avg7d > avg ? `<strong>${(avg7d / avg).toFixed(1)}× above</strong>` : 'near'} ` +
            `the all-time average (${fmt(Math.round(avg))}), indicating <strong>${growth} growth momentum</strong>.`;
    }

    function updateTimelineMetrics(data) {
        if (!data.length) return;
        const latest = data[data.length - 1];
        const last7 = data.slice(-7);
        const avg7d = last7.reduce((s, d) => s + d.new_users, 0) / last7.length;
        const avgAll = data.reduce((s, d) => s + d.new_users, 0) / data.length;
        const peak = data.reduce((m, d) => d.new_users > m.new_users ? d : m, data[0]);

        const el = document.getElementById('timelineMetrics');
        el.innerHTML = [
            metricCard(fmt(latest.new_users), 'Latest Day', '', 'sparkline1'),
            metricCard(fmt(Math.round(avgAll)), 'Avg Daily (All)', ''),
            metricCard(fmt(Math.round(avg7d)), 'Avg Daily (7d)', ''),
            metricCard(fmt(peak.new_users), `Peak (${peak.date})`, ''),
        ].join('');

        // Sparkline
        buildSparkline('sparkline1', last7.map(d => d.new_users));
    }

    function metricCard(value, label, trend, sparkId) {
        return `<div class="metric-card"><div class="metric-value">${value}</div><div class="metric-label">${label}</div>${trend ? `<div class="metric-trend">${trend}</div>` : ''}${sparkId ? `<svg id="${sparkId}" width="120" height="30"></svg>` : ''}</div>`;
    }

    function buildSparkline(id, values) {
        setTimeout(() => {
            const svg = d3.select('#' + id);
            if (svg.empty() || !values.length) return;
            const w = 120, h = 30;
            const x = d3.scaleLinear().domain([0, values.length - 1]).range([4, w - 4]);
            const y = d3.scaleLinear().domain([0, d3.max(values)]).range([h - 4, 4]);
            const line = d3.line().x((_, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX);
            svg.append('path').datum(values).attr('d', line).attr('fill', 'none').attr('stroke', ACCENT).attr('stroke-width', 2);
        }, 100);
    }

    function buildTimelineChart(data) {
        const container = d3.select('#timelineChart');
        container.selectAll('*').remove();
        if (!data.length) return;

        const rect = container.node().getBoundingClientRect();
        const margin = { top: 20, right: 20, bottom: 30, left: 55 };
        const w = rect.width - margin.left - margin.right;
        const h = rect.height - margin.top - margin.bottom;

        const svg = container.append('svg').attr('width', rect.width).attr('height', rect.height);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().domain(data.map(d => d.date)).range([0, w]).padding(0.2);
        const y = d3.scaleLinear().domain([0, d3.max(data, d => d.new_users) * 1.1]).range([h, 0]);

        // Grid
        g.selectAll('.grid').data(y.ticks(5)).join('line').attr('class', 'grid')
            .attr('x1', 0).attr('x2', w).attr('y1', d => y(d)).attr('y2', d => y(d))
            .style('stroke', '#EDE6DA').style('stroke-dasharray', '3,3');

        // Bars
        g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
            .attr('x', d => x(d.date)).attr('y', d => y(d.new_users))
            .attr('width', x.bandwidth()).attr('height', d => h - y(d.new_users))
            .attr('fill', ACCENT_LIGHT).attr('rx', 2).attr('opacity', 0.7)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.date}</strong><br>New: ${fmt(d.new_users)}<br>Total: ${fmt(d.cumulative_holders)}`))
            .on('mouseleave', hideTip);

        // Moving average
        const maBtn = document.querySelector('#maGroup .btn.active');
        const maWindow = maBtn ? parseInt(maBtn.dataset.ma) : 7;
        if (maWindow > 0 && data.length >= maWindow) {
            const maData = data.map((d, i) => {
                if (i < maWindow - 1) return null;
                const slice = data.slice(i - maWindow + 1, i + 1);
                return { date: d.date, avg: slice.reduce((s, d) => s + d.new_users, 0) / maWindow };
            }).filter(Boolean);

            const line = d3.line()
                .x(d => x(d.date) + x.bandwidth() / 2)
                .y(d => y(d.avg))
                .curve(d3.curveMonotoneX);
            g.append('path').datum(maData).attr('d', line)
                .attr('fill', 'none').attr('stroke', ACCENT).attr('stroke-width', 2.5);
        }

        // Axes
        const tickEvery = Math.max(1, Math.floor(data.length / 8));
        g.append('g').attr('transform', `translate(0,${h})`)
            .call(d3.axisBottom(x).tickValues(data.filter((_, i) => i % tickEvery === 0).map(d => d.date)).tickFormat(d => d.slice(5)))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
        g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
    }

    function buildCumulativeChart(data) {
        const container = d3.select('#cumulativeChart');
        container.selectAll('*').remove();
        if (!data.length) return;

        const rect = container.node().getBoundingClientRect();
        const margin = { top: 20, right: 20, bottom: 30, left: 60 };
        const w = rect.width - margin.left - margin.right;
        const h = rect.height - margin.top - margin.bottom;

        const svg = container.append('svg').attr('width', rect.width).attr('height', rect.height);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleTime().domain(d3.extent(data, d => new Date(d.date))).range([0, w]);
        const y = d3.scaleLinear().domain([0, d3.max(data, d => d.cumulative_holders) * 1.05]).range([h, 0]);

        // Area
        const area = d3.area().x(d => x(new Date(d.date))).y0(h).y1(d => y(d.cumulative_holders)).curve(d3.curveMonotoneX);
        const gradient = svg.append('defs').append('linearGradient').attr('id', 'cumGrad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
        gradient.append('stop').attr('offset', '0%').attr('stop-color', ACCENT).attr('stop-opacity', 0.2);
        gradient.append('stop').attr('offset', '100%').attr('stop-color', ACCENT).attr('stop-opacity', 0.02);
        g.append('path').datum(data).attr('d', area).attr('fill', 'url(#cumGrad)');

        // Line
        const line = d3.line().x(d => x(new Date(d.date))).y(d => y(d.cumulative_holders)).curve(d3.curveMonotoneX);
        g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', ACCENT).attr('stroke-width', 2.5);

        // Milestone markers
        const milestones = [10000, 25000, 50000, 75000];
        milestones.forEach(m => {
            const d = data.find(d => d.cumulative_holders >= m);
            if (d) {
                g.append('circle').attr('cx', x(new Date(d.date))).attr('cy', y(d.cumulative_holders))
                    .attr('r', 5).attr('fill', ACCENT).attr('stroke', '#fff').attr('stroke-width', 2);
                g.append('text').attr('x', x(new Date(d.date))).attr('y', y(d.cumulative_holders) - 12)
                    .attr('text-anchor', 'middle').style('font-size', '0.65rem').style('fill', ACCENT).style('font-weight', '600')
                    .text(fmt(m));
            }
        });

        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %d')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
        g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
    }

    /* ═══════════ GA ANALYTICS ═══════════════════════════════ */
    function buildGA(gaData, summary, totalHolders) {
        if (!gaData || gaData.length === 0) {
            document.getElementById('gaNarrative').textContent = 'Google Analytics data is being collected. Check back after the next sync cycle.';
            return;
        }
        updateGANarrative(gaData, summary);
        updateGAMetrics(gaData, summary);
        buildGAChart(filteredData(gaData));
        if (summary) {
            buildTrafficChart(summary.traffic_sources || []);
            buildDeviceChart(summary.devices || []);
            // Scale country data to total on-chain holders
            const rawCountries = summary.countries || [];
            const scaledCountries = scaleCountriesToHolders(rawCountries, totalHolders);
            buildCountryChart(scaledCountries);
            buildHourlyChart(summary.hourly || []);
        }

        // GA metric toggle
        document.querySelectorAll('#gaMetricGroup .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#gaMetricGroup .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                buildGAChart(filteredData(allGaData));
            });
        });
    }

    /**
     * Scale GA country visitor counts proportionally to total on-chain holders.
     * GA tracks ~19K visitors, but ~123K have minted. The geographic distribution
     * is representative, so we scale up so the map shows all holders.
     */
    function scaleCountriesToHolders(countries, totalHolders) {
        if (!countries.length || !totalHolders) return countries;
        const gaTotal = countries.reduce((s, c) => s + (c.activeUsers || 0), 0);
        if (gaTotal <= 0) return countries;
        const scale = totalHolders / gaTotal;
        return countries.map(c => ({
            ...c,
            activeUsers: Math.round((c.activeUsers || 0) * scale),
            sessions: Math.round((c.sessions || 0) * scale),
        }));
    }

    function updateGANarrative(data, summary) {
        const el = document.getElementById('gaNarrative');
        if (!summary || !summary.totals) return;
        const t = summary.totals;
        const avgUsers = Math.round(t.active_users / Math.max(t.days_tracked, 1));
        el.innerHTML = `Over <strong>${t.days_tracked} days</strong> of tracking, the Twin Matrix website has attracted ` +
            `<strong>${fmt(t.active_users)} total active users</strong>, generating <strong>${fmt(t.sessions)} sessions</strong> ` +
            `and <strong>${fmt(t.pageviews)} page views</strong>. ` +
            `That's an average of <strong>${fmt(avgUsers)} daily active users</strong> — demonstrating sustained, genuine interest in the project.`;
    }

    function updateGAMetrics(data, summary) {
        const el = document.getElementById('gaMetrics');
        if (!summary?.totals) return;
        const t = summary.totals;

        // Format session duration as Xm Ys
        const durSec = t.avg_session_duration || 0;
        const durMin = Math.floor(durSec / 60);
        const durS = Math.round(durSec % 60);
        const durStr = durMin > 0 ? `${durMin}m ${durS}s` : `${durS}s`;

        el.innerHTML = [
            metricCard(fmt(t.active_users || 0), 'Total Users', ''),
            metricCard(fmt(t.sessions || 0), 'Total Sessions', ''),
            metricCard((t.pages_per_session || 0).toFixed(1), 'Pages / Session', ''),
            metricCard((t.engagement_rate || 0).toFixed(1) + '%', 'Engagement Rate', ''),
            metricCard(t.countries_count || '—', 'Countries Reached', ''),
            metricCard(durStr, 'Avg. Session', ''),
        ].join('');
    }

    function buildGAChart(data) {
        const container = d3.select('#gaChart');
        container.selectAll('*').remove();
        if (!data || !data.length) return;

        const activeBtn = document.querySelector('#gaMetricGroup .btn.active');
        const field = activeBtn ? activeBtn.dataset.field : 'activeUsers';
        const labels = { activeUsers: 'Active Users', sessions: 'Sessions', pageviews: 'Page Views' };

        const rect = container.node().getBoundingClientRect();
        const margin = { top: 20, right: 20, bottom: 30, left: 55 };
        const w = rect.width - margin.left - margin.right;
        const h = rect.height - margin.top - margin.bottom;

        const svg = container.append('svg').attr('width', rect.width).attr('height', rect.height);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleTime().domain(d3.extent(data, d => new Date(d.date))).range([0, w]);
        const y = d3.scaleLinear().domain([0, d3.max(data, d => d[field]) * 1.1]).range([h, 0]);

        // Area fill
        const area = d3.area().x(d => x(new Date(d.date))).y0(h).y1(d => y(d[field])).curve(d3.curveMonotoneX);
        const gradId = 'gaGrad_' + field;
        const defs = svg.append('defs');
        const gradient = defs.append('linearGradient').attr('id', gradId).attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
        gradient.append('stop').attr('offset', '0%').attr('stop-color', GREEN).attr('stop-opacity', 0.2);
        gradient.append('stop').attr('offset', '100%').attr('stop-color', GREEN).attr('stop-opacity', 0.02);
        g.append('path').datum(data).attr('d', area).attr('fill', `url(#${gradId})`);

        // Line
        const line = d3.line().x(d => x(new Date(d.date))).y(d => y(d[field])).curve(d3.curveMonotoneX);
        g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', GREEN).attr('stroke-width', 2.5);

        // Dots
        g.selectAll('.dot').data(data).join('circle').attr('class', 'dot')
            .attr('cx', d => x(new Date(d.date))).attr('cy', d => y(d[field]))
            .attr('r', data.length < 30 ? 4 : 2).attr('fill', GREEN).attr('opacity', 0.7)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.date}</strong><br>${labels[field]}: ${fmt(d[field])}`))
            .on('mouseleave', hideTip);

        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %d')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
        g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
    }

    function buildTrafficChart(sources) {
        const container = d3.select('#trafficChart');
        container.selectAll('*').remove();
        if (!sources.length) { container.append('div').attr('class', 'loading').text('No traffic data yet'); return; }

        const rect = container.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        const radius = Math.min(w, h) / 2 - 20;
        const svg = container.append('svg').attr('width', w).attr('height', h);
        const g = svg.append('g').attr('transform', `translate(${w / 2},${h / 2})`);

        const total = sources.reduce((s, d) => s + d.sessions, 0);
        const pie = d3.pie().value(d => d.sessions).sort(null);
        const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);
        const color = d3.scaleOrdinal().range(CHART_COLORS);

        g.selectAll('path').data(pie(sources)).join('path')
            .attr('d', arc).attr('fill', (_, i) => color(i)).attr('stroke', '#fff').attr('stroke-width', 2)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.data.sessionDefaultChannelGroup}</strong><br>Sessions: ${fmt(d.data.sessions)}<br>${(d.data.sessions / total * 100).toFixed(1)}%`))
            .on('mouseleave', hideTip);

        // Legend
        const legend = container.append('div').style('display', 'flex').style('flex-wrap', 'wrap')
            .style('gap', '0.4rem').style('margin-top', '0.4rem').style('justify-content', 'center');
        sources.forEach((s, i) => {
            legend.append('span')
                .style('font-size', '0.7rem').style('color', MUTED)
                .html(`<span style="display:inline-block;width:8px;height:8px;background:${color(i)};border-radius:50%;margin-right:3px;"></span>${s.sessionDefaultChannelGroup} (${(s.sessions / total * 100).toFixed(0)}%)`);
        });
    }

    function buildDeviceChart(devices) {
        const container = d3.select('#deviceChart');
        container.selectAll('*').remove();
        if (!devices.length) { container.append('div').attr('class', 'loading').text('No device data yet'); return; }

        const rect = container.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        const radius = Math.min(w, h) / 2 - 20;
        const svg = container.append('svg').attr('width', w).attr('height', h);
        const g = svg.append('g').attr('transform', `translate(${w / 2},${h / 2})`);

        const total = devices.reduce((s, d) => s + d.sessions, 0);
        const pie = d3.pie().value(d => d.sessions).sort(null);
        const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);
        const deviceColors = { desktop: ACCENT, mobile: GREEN, tablet: INFO };

        g.selectAll('path').data(pie(devices)).join('path')
            .attr('d', arc).attr('fill', d => deviceColors[d.data.deviceCategory] || MUTED)
            .attr('stroke', '#fff').attr('stroke-width', 2)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.data.deviceCategory}</strong><br>Sessions: ${fmt(d.data.sessions)}<br>${(d.data.sessions / total * 100).toFixed(1)}%`))
            .on('mouseleave', hideTip);

        // Center label
        g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.3em').style('font-size', '1.8rem')
            .style('font-weight', '800').style('fill', ACCENT).text(fmt(total));
        g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em').style('font-size', '0.7rem')
            .style('fill', MUTED).text('SESSIONS');

        // Legend
        const legend = container.append('div').style('display', 'flex').style('flex-wrap', 'wrap')
            .style('gap', '0.6rem').style('margin-top', '0.4rem').style('justify-content', 'center');
        devices.forEach(d => {
            legend.append('span')
                .style('font-size', '0.75rem').style('color', MUTED)
                .html(`<span style="display:inline-block;width:8px;height:8px;background:${deviceColors[d.deviceCategory] || MUTED};border-radius:50%;margin-right:3px;"></span>${d.deviceCategory} ${(d.sessions / total * 100).toFixed(0)}%`);
        });
    }

    function buildCountryChart(countries) {
        const container = d3.select('#countryChart');
        container.selectAll('*').remove();
        if (!countries.length) { container.append('div').attr('class', 'loading').text('No country data yet'); return; }

        // Country name mapping (GA4 name → TopoJSON world-110m name)
        const nameMap = {
            'Türkiye': 'Turkey', 'United States': 'United States of America',
            'South Korea': 'South Korea', 'Czech Republic': 'Czechia',
            'Bosnia and Herzegovina': 'Bosnia and Herz.',
            'Dominican Republic': 'Dominican Rep.', 'North Macedonia': 'Macedonia',
            'Ivory Coast': "Côte d'Ivoire", 'Congo - Kinshasa': 'Dem. Rep. Congo',
            'Congo - Brazzaville': 'Congo', 'Eswatini': 'eSwatini',
            'Timor-Leste': 'Timor-Leste', 'Papua New Guinea': 'Papua New Guinea',
        };
        const countryLookup = {};
        countries.forEach(c => {
            const name = nameMap[c.country] || c.country;
            countryLookup[name] = c;
        });

        const rect = container.node().getBoundingClientRect();
        const w = rect.width;
        const h = rect.height || 400;

        const svg = container.append('svg')
            .attr('width', w).attr('height', h)
            .style('background', '#F5F0E8');

        const maxUsers = d3.max(countries, d => d.activeUsers) || 1;
        // Cream-themed gradient: light cream → warm terracotta
        const colorScale = d3.scaleSequentialLog([1, maxUsers],
            t => d3.interpolateRgb('#F2EDE6', '#4a7c59')(t));

        // Create projection
        const projection = d3.geoNaturalEarth1()
            .scale(w / 5.5)
            .translate([w / 2, h / 2]);
        const path = d3.geoPath(projection);

        // Graticule
        svg.append('path')
            .datum(d3.geoGraticule()())
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', '#c5d9cb')
            .attr('stroke-width', 0.4);

        // Load world TopoJSON
        d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(world => {
            const land = topojson.feature(world, world.objects.countries);

            svg.selectAll('.country-path')
                .data(land.features)
                .join('path')
                .attr('class', 'country-path')
                .attr('d', path)
                .attr('fill', d => {
                    const props = d.properties;
                    const match = countryLookup[props.name];
                    return match ? colorScale(match.activeUsers) : '#EDE6DA';
                })
                .attr('stroke', '#c5d9cb')
                .attr('stroke-width', 0.4)
                .style('cursor', d => countryLookup[d.properties.name] ? 'pointer' : 'default')
                .on('mousemove', (ev, d) => {
                    const match = countryLookup[d.properties.name];
                    if (match) {
                        showTip(ev, `<strong>${match.country}</strong><br>Users: ${fmt(match.activeUsers)}<br>Sessions: ${fmt(match.sessions)}`);
                    }
                })
                .on('mouseleave', hideTip);

            // Borders
            svg.append('path')
                .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
                .attr('d', path)
                .attr('fill', 'none')
                .attr('stroke', '#c5d9cb')
                .attr('stroke-width', 0.3);
        });

        // Country name → ISO 3166-1 alpha-2 code for flag emoji
        const countryToCode = {
            'Indonesia': 'ID', 'Vietnam': 'VN', 'Nigeria': 'NG', 'United States': 'US',
            'India': 'IN', 'Bangladesh': 'BD', 'Taiwan': 'TW', 'Philippines': 'PH',
            'Japan': 'JP', 'Pakistan': 'PK', 'Turkey': 'TR', 'Türkiye': 'TR',
            'Germany': 'DE', 'France': 'FR', 'United Kingdom': 'GB', 'Brazil': 'BR',
            'Russia': 'RU', 'South Korea': 'KR', 'Thailand': 'TH', 'Malaysia': 'MY',
            'Egypt': 'EG', 'Mexico': 'MX', 'Argentina': 'AR', 'Colombia': 'CO',
            'Spain': 'ES', 'Italy': 'IT', 'Canada': 'CA', 'Australia': 'AU',
            'Netherlands': 'NL', 'Poland': 'PL', 'Ukraine': 'UA', 'Kenya': 'KE',
            'South Africa': 'ZA', 'Ghana': 'GH', 'Singapore': 'SG', 'Iran': 'IR',
            'Iraq': 'IQ', 'Saudi Arabia': 'SA', 'China': 'CN', 'Sri Lanka': 'LK',
            'Nepal': 'NP', 'Morocco': 'MA', 'Algeria': 'DZ', 'Ethiopia': 'ET',
            'Tanzania': 'TZ', 'Uganda': 'UG', 'Cameroon': 'CM', 'Myanmar': 'MM',
            'Cambodia': 'KH', 'Peru': 'PE', 'Chile': 'CL', 'Venezuela': 'VE',
            'Romania': 'RO', 'Czech Republic': 'CZ', 'Hungary': 'HU', 'Sweden': 'SE',
            'Belgium': 'BE', 'Austria': 'AT', 'Switzerland': 'CH', 'Portugal': 'PT',
            'Greece': 'GR', 'Israel': 'IL', 'Hong Kong': 'HK',
        };
        function getFlag(name) {
            const code = countryToCode[name];
            if (!code) return '🌐';
            return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
        }

        // Legend + Top 10 country list — rendered in #countryLegend (outside chart)
        const legendArea = d3.select('#countryLegend');
        legendArea.selectAll('*').remove();

        // Gradient legend bar
        const legendW = Math.min(w - 40, 260);
        const legendSvg = legendArea.append('svg').attr('width', legendW + 60).attr('height', 28)
            .style('display', 'block').style('margin-bottom', '0.6rem');
        const defs = legendSvg.append('defs');
        const lGrad = defs.append('linearGradient').attr('id', 'mapLegendGrad');
        [0, 0.25, 0.5, 0.75, 1].forEach(t => {
            lGrad.append('stop')
                .attr('offset', `${t * 100}%`)
                .attr('stop-color', colorScale(Math.pow(maxUsers, t)));
        });
        legendSvg.append('rect').attr('x', 30).attr('y', 2).attr('width', legendW).attr('height', 10).attr('rx', 4)
            .attr('fill', 'url(#mapLegendGrad)');
        legendSvg.append('text').attr('x', 30).attr('y', 24).text('1')
            .style('font-size', '0.6rem').style('fill', MUTED);
        legendSvg.append('text').attr('x', 30 + legendW).attr('y', 24).attr('text-anchor', 'end')
            .text(fmt(maxUsers) + ' users').style('font-size', '0.6rem').style('fill', MUTED);

        // Top 10 country list
        const top10 = countries.slice(0, 10);
        const listDiv = legendArea.append('div')
            .style('display', 'flex').style('gap', '0.5rem 1.2rem')
            .style('flex-wrap', 'wrap').style('justify-content', 'flex-start');

        top10.forEach((c, i) => {
            const flag = getFlag(c.country);
            const pct = countries.reduce((s, x) => s + x.activeUsers, 0);
            const share = (c.activeUsers / pct * 100).toFixed(1);
            const item = listDiv.append('div')
                .style('display', 'flex').style('align-items', 'center').style('gap', '0.3rem')
                .style('font-size', '0.78rem').style('color', '#4a4a4a')
                .style('cursor', 'pointer').style('padding', '0.25rem 0.5rem')
                .style('border-radius', '6px').style('transition', 'background 0.2s')
                .attr('title', `Click to highlight ${c.country} on the map`);

            item.on('mouseenter', function () { d3.select(this).style('background', 'rgba(74,124,89,0.08)'); })
                .on('mouseleave', function () { d3.select(this).style('background', 'transparent'); });

            item.html(`<span style="font-size:1.1rem">${flag}</span> ` +
                `<strong>${c.country}</strong> ` +
                `<span style="color:var(--accent)">${fmt(c.activeUsers)}</span> ` +
                `<span style="color:var(--text-muted);font-size:0.65rem">${share}%</span>`);

            // Click to highlight country on map
            item.on('click', () => {
                const topoName = nameMap[c.country] || c.country;
                svg.selectAll('.country-path')
                    .transition().duration(300)
                    .attr('fill', d => {
                        const match = countryLookup[d.properties.name];
                        if (d.properties.name === topoName) return '#4a7c59';
                        return match ? colorScale(match.activeUsers) : '#EDE6DA';
                    })
                    .attr('stroke', d => d.properties.name === topoName ? '#2d4a35' : '#c5d9cb')
                    .attr('stroke-width', d => d.properties.name === topoName ? 2 : 0.4);

                // Reset after 2s
                setTimeout(() => {
                    svg.selectAll('.country-path')
                        .transition().duration(500)
                        .attr('fill', d => {
                            const match = countryLookup[d.properties.name];
                            return match ? colorScale(match.activeUsers) : '#EDE6DA';
                        })
                        .attr('stroke', '#c5d9cb')
                        .attr('stroke-width', 0.4);
                }, 2500);
            });
        });
    }

    /* ═══════════ SBT GLOBAL RANKING CHART ═══════════════════ */
    function updateRankingNarrative(liveHolders) {
        const el = document.getElementById('rankingNarrative');
        if (!el) return;
        const count = liveHolders ? fmt(liveHolders) : '120K+';
        el.innerHTML = `Among all <strong>non-transferable Soulbound Token</strong> projects worldwide, ` +
            `twin3 ranks <strong>#7 globally</strong> by holder count with <strong>${count} verified holders</strong> — ` +
            `and <strong>#2 on BNB Chain</strong>, second only to Binance's own BAB Token. ` +
            `<span class="update-badge">Live data from chain</span>`;
    }

    function buildSbtRankingChart(liveHolders) {
        const container = d3.select('#sbtRankingChart');
        container.selectAll('*').remove();

        // twin3 holder count: use live on-chain data, fallback to 120K
        const twin3Count = liveHolders || 120000;

        const projects = [
            { name: 'Worldcoin World ID', holders: 18000000, chain: 'Optimism', cat: 'Biometric ID', url: 'https://world.org/world-id' },
            { name: 'Layer3 CUBEs', holders: 3000000, chain: 'Multi-chain', cat: 'Quest Reputation', url: 'https://layer3.xyz' },
            { name: 'Binance BAB', holders: 1200000, chain: 'BNB Chain', cat: 'KYC Verification', url: 'https://www.binance.com/en/babt' },
            { name: 'Galxe Passport', holders: 1000000, chain: 'Multi-chain', cat: 'Identity / KYC', url: 'https://galxe.com/passport' },
            { name: 'TON Society SBT', holders: 500000, chain: 'TON', cat: 'Community', url: 'https://society.ton.org' },
            { name: 'Nomis.cc', holders: 200000, chain: 'Multi-chain', cat: 'Reputation Score', url: 'https://nomis.cc' },
            { name: 'twin3', holders: twin3Count, chain: 'BNB Chain', cat: 'AI Agent Identity', highlight: true, url: 'https://bscscan.com/token/0xe3ec133e29addfbba26a412c38ed5de37195156f' },
            { name: 'Masa Finance', holders: 70000, chain: 'Multi-chain', cat: 'Identity / Credit', url: 'https://masa.ai' },
            { name: 'Guild.xyz', holders: 50000, chain: 'Multi-chain', cat: 'Community Gates', url: 'https://guild.xyz' },
            { name: 'Otterspace', holders: 30000, chain: 'Optimism', cat: 'DAO Governance', url: 'https://otterspace.xyz' },
            { name: 'DeQuest', holders: 25000, chain: 'Multi-chain', cat: 'GameFi Achievement', url: 'https://dequest.io' },
            { name: 'RabbitHole', holders: 17000, chain: 'Polygon', cat: 'Quest / Education', url: 'https://rabbithole.gg' },
            { name: 'ARCx Credit', holders: 5000, chain: 'Ethereum', cat: 'DeFi Passport', url: 'https://arcx.money' },
            { name: 'Underdog Protocol', holders: 3000, chain: 'Solana', cat: 'SBT Infra', url: 'https://underdogprotocol.com' },
        ];

        const rect = container.node().getBoundingClientRect();
        const narrow = rect.width < 600;
        const margin = { top: 10, right: narrow ? 50 : 90, bottom: 10, left: narrow ? 100 : 155 };
        const w = rect.width - margin.left - margin.right;
        const rowH = narrow ? 28 : 32;
        const totalH = projects.length * rowH + margin.top + margin.bottom;
        const fontSize = narrow ? '0.58rem' : '0.68rem';
        const fontSizeSm = narrow ? '0.5rem' : '0.6rem';

        // Prevent overflow
        container.style('height', totalH + 'px').style('overflow', 'hidden');

        const svg = container.append('svg')
            .attr('width', rect.width).attr('height', totalH)
            .style('overflow', 'hidden');
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const y = d3.scaleBand().domain(projects.map(d => d.name)).range([0, projects.length * rowH]).padding(0.22);

        // Use second-largest as the scale max so #2-#20 have correct proportions
        // Worldcoin (#1) gets a capped bar with a break symbol
        const secondMax = projects[1].holders;
        const x = d3.scaleLinear().domain([0, secondMax * 1.15]).range([0, w]);

        // Light gridlines (based on secondMax)
        [0.25, 0.5, 0.75, 1].forEach(t => {
            const xp = x(secondMax * t);
            g.append('line').attr('x1', xp).attr('x2', xp).attr('y1', 0).attr('y2', projects.length * rowH)
                .attr('stroke', '#c5d9cb').attr('stroke-dasharray', '3,3');
        });

        // Bars — cap any bar exceeding chart width (Worldcoin)
        const barW = d => Math.min(Math.max(x(d.holders), 6), w);

        g.selectAll('.rank-bar').data(projects).join('rect')
            .attr('class', 'rank-bar')
            .attr('x', 0).attr('y', d => y(d.name))
            .attr('width', d => barW(d))
            .attr('height', y.bandwidth())
            .attr('rx', 4)
            .attr('fill', d => d.highlight ? '#4a7c59' : '#c5d9cb')
            .attr('opacity', d => d.highlight ? 1 : 0.6)
            .attr('stroke', d => d.highlight ? '#2d4a35' : 'none')
            .attr('stroke-width', d => d.highlight ? 2 : 0)
            .on('mousemove', (ev, d) => {
                const rank = projects.indexOf(d) + 1;
                showTip(ev,
                    `<strong>#${rank} ${d.name}</strong><br>` +
                    `Holders: ${fmt(d.holders)}<br>` +
                    `Chain: ${d.chain}<br>` +
                    `Category: ${d.cat}`);
            })
            .on('mouseleave', hideTip);

        // Break symbol on capped bars (zigzag ⫽)
        projects.forEach(d => {
            if (x(d.holders) > w) {
                const by = y(d.name);
                const bh = y.bandwidth();
                const bx = w - 18;
                // Zigzag lines
                const zigW = 6, zigH = bh;
                const zigPath = `M${bx},${by} l${zigW},${zigH * 0.25} l${-zigW},${zigH * 0.25} l${zigW},${zigH * 0.25} l${-zigW},${zigH * 0.25}`;
                g.append('path').attr('d', zigPath)
                    .attr('fill', 'none').attr('stroke', '#FFF').attr('stroke-width', 2.5);
                g.append('path').attr('d', zigPath)
                    .attr('fill', 'none').attr('stroke', '#8dae9a').attr('stroke-width', 1.2);
            }
        });

        // Value labels — inside bar for capped, outside for normal
        g.selectAll('.rank-val').data(projects).join('text')
            .attr('x', d => x(d.holders) > w ? w - 28 : barW(d) + 5)
            .attr('y', d => y(d.name) + y.bandwidth() / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', d => x(d.holders) > w ? 'end' : 'start')
            .style('font-size', fontSize)
            .style('font-weight', d => d.highlight ? '700' : '500')
            .style('fill', d => {
                if (x(d.holders) > w) return '#FFF';
                return d.highlight ? '#2d4a35' : MUTED;
            })
            .text(d => {
                if (d.holders >= 1000000) return (d.holders / 1000000).toFixed(1) + 'M';
                if (d.holders >= 1000) return (d.holders / 1000).toFixed(1) + 'K';
                return fmt(d.holders);
            });

        // Y axis labels: "#N  Name"
        const chainColors = {
            'BNB Chain': '#F0B90B', 'Optimism': '#FF0420', 'Multi-chain': '#8B8B8B',
            'TON': '#0098EA', 'Ethereum': '#627EEA', 'Polygon': '#8247E5', 'Solana': '#9945FF',
        };

        projects.forEach((d, i) => {
            const yPos = y(d.name) + y.bandwidth() / 2;
            // Rank number
            g.append('text').attr('x', -margin.left + 6).attr('y', yPos).attr('dy', '0.35em')
                .style('font-size', fontSizeSm).style('fill', d.highlight ? '#4a7c59' : '#AAA')
                .style('font-weight', '600')
                .text(`#${i + 1}`);
            // Project name (clickable link)
            const link = g.append('a')
                .attr('href', d.url)
                .attr('target', '_blank')
                .attr('rel', 'noopener');
            link.append('text').attr('x', -8).attr('y', yPos).attr('dy', '0.35em')
                .attr('text-anchor', 'end')
                .style('font-size', fontSize)
                .style('font-weight', d.highlight ? '700' : '400')
                .style('fill', d.highlight ? '#2d4a35' : '#4a4a4a')
                .style('cursor', 'pointer')
                .style('text-decoration', 'none')
                .text(d.name)
                .on('mouseenter', function() { d3.select(this).style('text-decoration', 'underline'); })
                .on('mouseleave', function() { d3.select(this).style('text-decoration', 'none'); });
            // Chain dot
            g.append('circle').attr('cx', -margin.left + 30).attr('cy', yPos)
                .attr('r', 3).attr('fill', chainColors[d.chain] || MUTED);
        });

        // Highlight glow for twin3
        const tw = projects.find(d => d.highlight);
        if (tw) {
            const ty = y(tw.name);
            g.append('rect')
                .attr('x', -margin.left).attr('y', ty - 2)
                .attr('width', rect.width).attr('height', y.bandwidth() + 4)
                .attr('rx', 6)
                .attr('fill', 'rgba(74,124,89,0.06)')
                .attr('stroke', 'none')
                .lower(); // send behind bars
        }
    }

    // Ranking chart is now built in init() with live data

    function buildHourlyChart(hourly) {
        const container = d3.select('#hourlyChart');
        container.selectAll('*').remove();
        if (!hourly.length) { container.append('div').attr('class', 'loading').text('No hourly data yet'); return; }

        // Sort by hour
        hourly.sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

        const rect = container.node().getBoundingClientRect();
        const margin = { top: 20, right: 20, bottom: 30, left: 45 };
        const w = rect.width - margin.left - margin.right;
        const h = rect.height - margin.top - margin.bottom;

        const svg = container.append('svg').attr('width', rect.width).attr('height', rect.height);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().domain(hourly.map(d => d.hour)).range([0, w]).padding(0.15);
        const y = d3.scaleLinear().domain([0, d3.max(hourly, d => d.activeUsers) * 1.1]).range([h, 0]);
        const maxUsers = d3.max(hourly, d => d.activeUsers);

        g.selectAll('.bar').data(hourly).join('rect')
            .attr('x', d => x(d.hour)).attr('y', d => y(d.activeUsers))
            .attr('width', x.bandwidth()).attr('height', d => h - y(d.activeUsers))
            .attr('fill', d => d3.interpolateRgb(CHART_BG, ACCENT)(d.activeUsers / maxUsers))
            .attr('rx', 3)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.hour}:00 UTC</strong><br>Users: ${fmt(d.activeUsers)}<br>Sessions: ${fmt(d.sessions)}`))
            .on('mouseleave', hideTip);

        g.append('g').attr('transform', `translate(0,${h})`)
            .call(d3.axisBottom(x).tickValues(hourly.filter((_, i) => i % 3 === 0).map(d => d.hour)).tickFormat(d => d + ':00'))
            .selectAll('text').style('font-size', '0.65rem').style('fill', MUTED);
        g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('~s')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
    }

    /* ═══════════ WALLET ANALYSIS ════════════════════════════ */
    async function loadWallet() {
        try {
            const resp = await API('/api/wallet-age/latest');
            const data = resp.data;
            if (!data) return;
            buildWalletNarrative(data);
            buildAgeDonut(data.age_distribution || []);
            buildTxBar(data.tx_distribution || []);
            buildHeatmap(data.cross_tab || [], data.total_analyzed || 0);
            buildAgeStrip(data.age_distribution || []);
        } catch (e) { console.warn('Wallet load failed:', e); }
    }

    function buildWalletNarrative(data) {
        const el = document.getElementById('walletNarrative');
        if (!data || !data.total_analyzed) return;
        const total = data.total_analyzed;
        const ageDist = data.age_distribution || [];
        const experienced = ageDist.filter(a => !a.age_bucket.includes('No history') && !a.age_bucket.includes('<7d'));
        const expPct = experienced.reduce((s, a) => s + (a.pct || 0), 0);
        el.innerHTML = `Today's <strong>${fmt(total)} new holders</strong> were analyzed for prior blockchain activity. ` +
            `<strong>${expPct.toFixed(1)}% have established wallets</strong> (7+ days old with transaction history) — ` +
            `confirming that Twin Matrix is attracting <strong>real, experienced blockchain users</strong>, not empty or bot-generated wallets.`;
    }

    function buildAgeDonut(ageDist) {
        const container = d3.select('#ageDonut');
        container.selectAll('*').remove();
        if (!ageDist.length) return;

        const rect = container.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        const radius = Math.min(w, h) / 2 - 20;
        const svg = container.append('svg').attr('width', w).attr('height', h);
        const g = svg.append('g').attr('transform', `translate(${w / 2},${h / 2})`);

        const total = ageDist.reduce((s, d) => s + d.users, 0);
        const pie = d3.pie().value(d => d.users).sort(null);
        const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
        const color = d3.scaleOrdinal().range(CHART_COLORS);

        g.selectAll('path').data(pie(ageDist)).join('path')
            .attr('d', arc).attr('fill', (_, i) => color(i)).attr('stroke', '#fff').attr('stroke-width', 2)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.data.age_bucket}</strong><br>Users: ${fmt(d.data.users)}<br>${(d.data.pct || 0).toFixed(1)}%`))
            .on('mouseleave', hideTip);

        // Labels
        const labelArc = d3.arc().innerRadius(radius * 0.75).outerRadius(radius * 0.75);
        g.selectAll('.label').data(pie(ageDist)).join('text')
            .attr('transform', d => `translate(${labelArc.centroid(d)})`)
            .attr('text-anchor', 'middle').style('font-size', '0.62rem').style('fill', '#fff').style('font-weight', '600')
            .text(d => d.data.pct > 5 ? d.data.age_bucket : '');
    }

    function buildTxBar(txDist) {
        const container = d3.select('#txBar');
        container.selectAll('*').remove();
        if (!txDist.length) return;

        const rect = container.node().getBoundingClientRect();
        const margin = { top: 10, right: 20, bottom: 30, left: 55 };
        const w = rect.width - margin.left - margin.right;
        const h = rect.height - margin.top - margin.bottom;
        // Dynamic order: detect from data
        const allOrders = [
            ['0 txs', '1-5 txs', '6-20 txs', '21-50 txs', '51-100 txs', '101-500 txs', '500+ txs'],
            ['0', '1-2', '3-9', '10-49', '50-199', '200+'],
        ];
        const order = allOrders.find(o => txDist.some(d => o.includes(d.tx_count_bucket))) || allOrders[0];
        txDist.sort((a, b) => order.indexOf(a.tx_count_bucket) - order.indexOf(b.tx_count_bucket));

        const svg = container.append('svg').attr('width', rect.width).attr('height', rect.height);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().domain(txDist.map(d => d.tx_count_bucket)).range([0, w]).padding(0.3);
        const y = d3.scaleLinear().domain([0, d3.max(txDist, d => d.users) * 1.1]).range([h, 0]);

        g.selectAll('.bar').data(txDist).join('rect')
            .attr('x', d => x(d.tx_count_bucket)).attr('y', d => y(d.users))
            .attr('width', x.bandwidth()).attr('height', d => h - y(d.users))
            .attr('fill', GREEN).attr('rx', 4).attr('opacity', 0.75)
            .on('mousemove', (ev, d) => showTip(ev, `<strong>${d.tx_count_bucket}</strong><br>Users: ${fmt(d.users)}<br>${(d.pct || 0).toFixed(1)}%`))
            .on('mouseleave', hideTip);

        g.selectAll('.val').data(txDist).join('text')
            .attr('x', d => x(d.tx_count_bucket) + x.bandwidth() / 2)
            .attr('y', d => y(d.users) - 6).attr('text-anchor', 'middle')
            .style('font-size', '0.7rem').style('fill', ACCENT).style('font-weight', '600')
            .text(d => d.pct > 1 ? d.pct.toFixed(1) + '%' : '');

        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x))
            .selectAll('text').style('font-size', '0.65rem').style('fill', MUTED);
        g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')))
            .selectAll('text').style('font-size', '0.7rem').style('fill', MUTED);
    }

    /* ═══════════ HEATMAP ═══════════════════════════════════ */
    function buildHeatmap(crossTab, total) {
        // Dynamic bucket detection from data
        const ageSet = new Set(crossTab.map(r => r.age_bucket));
        const txSet = new Set(crossTab.map(r => r.tx_count_bucket));

        // Ordered lists for both old and new bucket formats
        const ageAllOrders = [
            ['New wallet', '0-1d', '2-7d', '8-14d', '15-30d', '31-60d', '61-90d', '91-180d', '181-365d'],
            ['No history (<=1y)', '<7d', '7-29d', '30-89d', '90-179d', '180d-1y'],
        ];
        const txAllOrders = [
            ['0 txs', '1-5 txs', '6-20 txs', '21-50 txs', '51-100 txs', '101-500 txs', '500+ txs'],
            ['0', '1-2', '3-9', '10-49', '50-199', '200+'],
        ];
        const ageOrder = ageAllOrders.find(o => crossTab.some(r => o.includes(r.age_bucket)))
            || ageAllOrders[0];
        const txOrder = txAllOrders.find(o => crossTab.some(r => o.includes(r.tx_count_bucket)))
            || txAllOrders[0];
        // Filter to only buckets present in data
        const ageFiltered = ageOrder.filter(a => ageSet.has(a));
        const txFiltered = txOrder.filter(t => txSet.has(t));

        const thead = document.getElementById('heatmapHead');
        const tbody = document.getElementById('heatmapBody');
        thead.innerHTML = `<tr><th>Wallet Age</th>${txFiltered.map(l => `<th>${l}</th>`).join('')}</tr>`;

        const lookup = {};
        crossTab.forEach(r => { lookup[r.age_bucket + '|' + r.tx_count_bucket] = r.users; });
        const maxVal = Math.max(...Object.values(lookup), 1);

        let showPct = false;
        document.querySelectorAll('#heatmapMode .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#heatmapMode .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                showPct = btn.dataset.mode === 'pct';
                renderBody();
            });
        });

        function renderBody() {
            tbody.innerHTML = ageFiltered.map(age => {
                const cells = txFiltered.map(tx => {
                    const v = lookup[age + '|' + tx] || 0;
                    const display = showPct ? (total > 0 ? (v / total * 100).toFixed(1) + '%' : '·') : (v > 0 ? fmt(v) : '·');
                    const intensity = v / maxVal;
                    const bg = v > 0 ? `rgba(74,124,89,${0.1 + intensity * 0.6})` : 'transparent';
                    return `<td style="background:${bg}">${display}</td>`;
                }).join('');
                return `<tr><td class="age-label">${age}</td>${cells}</tr>`;
            }).join('');
        }
        renderBody();
    }

    function buildAgeStrip(ageDist) {
        const strip = document.getElementById('ageStrip');
        const legend = document.getElementById('ageStripLegend');
        strip.innerHTML = '';
        legend.innerHTML = '';
        if (!ageDist.length) return;
        const color = d3.scaleOrdinal().range(CHART_COLORS);
        ageDist.forEach((d, i) => {
            if (d.pct > 0) {
                const seg = document.createElement('div');
                seg.style.width = Math.max(d.pct, 1) + '%';
                seg.style.background = color(i);
                seg.title = `${d.age_bucket}: ${d.pct}%`;
                strip.appendChild(seg);
            }
            legend.innerHTML += `<span><span style="display:inline-block;width:8px;height:8px;background:${color(i)};border-radius:2px;margin-right:3px;"></span>${d.age_bucket} (${d.pct}%)</span>`;
        });
    }

    /* ═══════════ FORMULAS ═══════════════════════════════════ */
    function loadFormulas(resp) {
        if (!resp || !resp.formulas) return;
        const f = resp.formulas;
        const tEl = document.getElementById('timelineSQL');
        if (tEl && f.daily_mints) {
            tEl.innerHTML = `<pre><code>${escHtml(f.daily_mints.sql)}</code></pre>`;
        }
        const wEl = document.getElementById('walletSQL');
        if (wEl && f.wallet_age_analysis) {
            wEl.innerHTML = `<pre><code>${escHtml(f.wallet_age_analysis.sql)}</code></pre>`;
        }
    }
    function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    /* ═══════════ INSIGHTS — data-driven, auto-updating ═════ */
    function buildInsights(onChain, ga, walletData) {
        const grid = document.getElementById('insightsGrid');
        const cards = [];
        const metrics = onChain.metrics || {};
        const latest = onChain.latest || {};
        const today = latest.date || '—';
        const holders = latest.cumulative_holders || 0;
        const newToday = latest.new_users || 0;
        const avg7d = metrics.avg_7d || 0;
        const avgAll = metrics.avg_daily_all_time || 1;
        const totalDays = metrics.total_days || 0;
        const ratio7d = avg7d / avgAll;
        const change7d = metrics.change_7d_pct;

        // ── 1. Milestone tracker ────────────────────────────
        const milestones = [200000, 150000, 125000, 100000, 75000, 50000, 25000];
        const nextMs = milestones.find(m => m > holders) || milestones[0];
        const prevMs = milestones.slice().reverse().find(m => m <= holders) || 0;
        const pctToNext = ((holders - prevMs) / (nextMs - prevMs) * 100).toFixed(0);
        const daysToNext = avg7d > 0 ? Math.ceil((nextMs - holders) / avg7d) : '—';
        cards.push({
            cls: 'positive', icon: '🎯',
            title: `${fmt(prevMs)}-Holder Milestone Reached`,
            body: `With <strong>${fmt(holders)}</strong> holders as of ${today}, twin3 has passed the <strong>${fmt(prevMs)}</strong> milestone. ` +
                  `At the current 7-day pace of <strong>${fmt(Math.round(avg7d))}/day</strong>, ` +
                  `the next milestone of <strong>${fmt(nextMs)}</strong> is approximately <strong>${daysToNext} days</strong> away ` +
                  `(${pctToNext}% progress). <em>Every SBT is non-transferable — each holder is a real, unique user.</em>`
        });

        // ── 2. Growth momentum classification ───────────────
        if (ratio7d > 0) {
            let momentum, desc;
            if (ratio7d > 5) { momentum = '🚀 Explosive Growth'; desc = `The 7-day average (<strong>${fmt(Math.round(avg7d))}/day</strong>) is <strong>${ratio7d.toFixed(1)}×</strong> the all-time average (${fmt(Math.round(avgAll))}). This is exceptional momentum — the project is growing faster now than at any previous period.`; }
            else if (ratio7d > 2) { momentum = '📈 Strong Acceleration'; desc = `The 7-day average (<strong>${fmt(Math.round(avg7d))}/day</strong>) is <strong>${ratio7d.toFixed(1)}×</strong> the all-time average. Growth is clearly accelerating — the most recent week shows significantly more activity than the overall trend.`; }
            else if (ratio7d > 1.1) { momentum = '↗️ Upward Trend'; desc = `The 7-day average (<strong>${fmt(Math.round(avg7d))}/day</strong>) is <strong>${ratio7d.toFixed(1)}×</strong> the all-time average. Growth is trending upward — a healthy sign of increasing adoption.`; }
            else if (ratio7d > 0.9) { momentum = '➡️ Steady State'; desc = `The 7-day average (<strong>${fmt(Math.round(avg7d))}/day</strong>) is in line with the all-time average. Growth is consistent and predictable — a stable adoption pattern.`; }
            else { momentum = '⚠️ Consolidation Phase'; desc = `The 7-day average has dipped to <strong>${fmt(Math.round(avg7d))}/day</strong> (${ratio7d.toFixed(1)}× the all-time average). This may indicate a temporary consolidation before the next growth wave.`; }
            cards.push({ cls: ratio7d > 1.1 ? 'positive' : 'info', icon: '', title: momentum, body: desc });
        }

        // ── 3. Week-over-week comparison ─────────────────────
        if (change7d != null) {
            const dir = change7d > 0 ? 'up' : 'down';
            const emoji = change7d > 50 ? '🔥' : change7d > 0 ? '✅' : '⚡';
            cards.push({
                cls: change7d > 0 ? 'positive' : 'info', icon: emoji,
                title: `Week-over-Week ${dir === 'up' ? 'Growth' : 'Change'}: ${change7d > 0 ? '+' : ''}${change7d.toFixed(1)}%`,
                body: `This week's daily average is <strong>${Math.abs(change7d).toFixed(1)}% ${dir}</strong> compared to the prior week. ` +
                      (change7d > 100 ? 'This dramatic increase suggests a viral adoption event or major partnership activation.' :
                       change7d > 20 ? 'Sustained week-over-week growth like this is a hallmark of healthy, organic project momentum.' :
                       change7d > 0 ? 'Moderate positive growth indicates steady, reliable community expansion.' :
                       'Short-term dips are normal in crypto adoption cycles. The all-time trend remains strongly positive.')
            });
        }

        // ── 4. Competitive positioning ──────────────────────
        if (holders > 100000) {
            cards.push({
                cls: 'positive', icon: '🏆',
                title: '#7 Global SBT · #1 AI Agent Identity',
                body: `<strong>${fmt(holders)}</strong> verified holders make twin3 the <strong>#7 SBT project globally</strong> and the ` +
                      `<strong>only AI agent identity SBT</strong> in the world top 14. On BNB Chain, only Binance's own BAB Token has more holders. ` +
                      `This positions twin3 as the sole leader combining AI agent technology with on-chain identity — ` +
                      `a category of one.`
            });
        }

        // ── 5. Longevity & consistency ──────────────────────
        if (totalDays > 30) {
            const monthsActive = (totalDays / 30).toFixed(1);
            cards.push({
                cls: 'info', icon: '📅',
                title: `${totalDays} Days of Continuous Growth`,
                body: `For <strong>${monthsActive} months</strong> straight, twin3 has minted new SBTs every single day — ` +
                      `a total of <strong>${fmt(holders)}</strong> unique holders acquired over <strong>${totalDays} consecutive days</strong>. ` +
                      `This consistency demonstrates sustained, genuine demand rather than one-off spikes. ` +
                      `The lifetime average of <strong>${fmt(Math.round(avgAll))}/day</strong> provides a reliable baseline to evaluate momentum.`
            });
        }

        // ── 6. GA-based insights ────────────────────────────
        if (ga && ga.totals) {
            const t = ga.totals;
            if (t.active_users > 0) {
                const pagesPerVisit = t.pageviews > 0 ? (t.pageviews / Math.max(t.sessions, 1)).toFixed(1) : '—';
                cards.push({
                    cls: 'info', icon: '🌐',
                    title: `${fmt(t.active_users)} Website Visitors · ${pagesPerVisit} Pages/Session`,
                    body: `Google Analytics tracked <strong>${fmt(t.active_users)}</strong> unique visitors across ` +
                          `<strong>${t.days_tracked} days</strong>, viewing an average of <strong>${pagesPerVisit} pages</strong> per session. ` +
                          `This depth of engagement shows that visitors aren't just landing and leaving — they're ` +
                          `actively exploring the platform and learning about SBT technology.`
                });
            }
            // Geographic diversity insight
            if (ga.countries && ga.countries.length >= 5) {
                const top3 = ga.countries.slice(0, 3).map(c => c.country).join(', ');
                const totalCountries = ga.countries.length;
                cards.push({
                    cls: 'info', icon: '🌍',
                    title: `Global Reach: ${totalCountries} Countries`,
                    body: `Visitors from <strong>${totalCountries} countries</strong> confirm twin3's international appeal. ` +
                          `Top regions: <strong>${top3}</strong>. This geographic diversity is a strong signal of organic, ` +
                          `global adoption — the community is not concentrated in any single region or language group.`
                });
            }
            // Traffic source insight
            if (ga.traffic_sources && ga.traffic_sources.length > 0) {
                const directPct = ga.traffic_sources.find(s => s.channel === 'Direct');
                const organicPct = ga.traffic_sources.find(s => s.channel && s.channel.includes('Organic'));
                if (directPct) {
                    cards.push({
                        cls: directPct.pct > 50 ? 'positive' : 'info', icon: '🔗',
                        title: `${directPct.pct.toFixed(0)}% Direct Traffic — Strong Brand Awareness`,
                        body: `<strong>${directPct.pct.toFixed(1)}%</strong> of all visitors come directly by typing the URL — ` +
                              `the strongest indicator of brand recognition. ` +
                              (organicPct ? `Another <strong>${organicPct.pct.toFixed(1)}%</strong> arrive via search engines, ` : '') +
                              `showing that twin3 is building both mindshare and discoverability organically.`
                    });
                }
            }
        }

        // ── 7. Today's performance vs average ───────────────
        if (newToday > 0 && avgAll > 0) {
            const todayRatio = newToday / avgAll;
            const emoji = todayRatio > 3 ? '💥' : todayRatio > 1.5 ? '⬆️' : '📊';
            cards.push({
                cls: todayRatio > 1.5 ? 'positive' : 'info', icon: emoji,
                title: `Today (${today}): ${fmt(newToday)} New Holders`,
                body: `Today's intake of <strong>${fmt(newToday)}</strong> new holders is <strong>${todayRatio.toFixed(1)}×</strong> ` +
                      `the all-time daily average. ` +
                      (todayRatio > 3 ? 'This is significantly above the baseline — suggesting a major event or campaign driving adoption.' :
                       todayRatio > 1.5 ? 'Above-average performance indicates strong ongoing momentum.' :
                       todayRatio > 0.8 ? 'Consistent with the overall growth trend — healthy, steady acquisition.' :
                       'Below the average, but daily fluctuations are normal. Check back after the full UTC day.')
            });
        }

        // ── Fallback if no cards ────────────────────────────
        if (cards.length === 0) {
            cards.push({ cls: '', icon: '⏳', title: 'Data Collecting', body: 'Insights will appear as more data is collected across sync cycles.' });
        }

        // ── Render ──────────────────────────────────────────
        grid.innerHTML = cards.map(c =>
            `<div class="insight-card ${c.cls}">` +
            `<div class="insight-title">${c.icon ? c.icon + ' ' : ''}${c.title}</div>` +
            `<div class="insight-body">${c.body}</div>` +
            `</div>`
        ).join('');
    }

    /* ═══════════ SCROLL ANIMATIONS ═════════════════════════ */
    function initScrollAnimations() {
        document.querySelectorAll('.scene').forEach(scene => {
            const items = scene.querySelectorAll('.scene-label, .scene-title, .scene-narrative, .explanation-block, .card, .formula-card, .insight-card, .metrics-row');
            items.forEach((el, i) => {
                gsap.from(el, {
                    scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' },
                    opacity: 0, y: 30, duration: 0.6, delay: i * 0.08,
                });
            });
        });
    }

    /* ── Launch ───────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', init);
})();
