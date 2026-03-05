/**
 * BSC Token Growth Dashboard — Interactive D3.js + GSAP Engine
 *
 * Features:
 *   - Zoomable/brushable timeline
 *   - Animated cumulative growth curve
 *   - Interactive donut (click to drill)
 *   - Animated bar chart
 *   - Heatmap with hover tooltips
 *   - Rolling average toggles
 *   - Sparkline mini-charts
 *   - Scroll-triggered initialization
 */

(function () {
    'use strict';
    gsap.registerPlugin(ScrollTrigger);

    // ── Palette ──────────────────────────────────────────────
    const C = {
        accent: '#C0785C', accentLight: '#D4A574', accentDark: '#A06040',
        green: '#5B8C5A', amber: '#B8860B', info: '#7B8FA8',
        grid: '#EDE6DA', bg: '#FBF8F1', text: '#2D2A26', muted: '#7A746A',
    };
    const WARM = ['#C0785C', '#D4A574', '#B8860B', '#5B8C5A', '#7B8FA8', '#9B7DB8'];

    // ── State ────────────────────────────────────────────────
    let dailyData = [];
    let walletAge = null;
    let formulas = {};
    let currentMA = 7;
    let heatmapMode = 'count';
    const tooltip = d3.select('#tooltip');

    // ── Progress bar ─────────────────────────────────────────
    window.addEventListener('scroll', () => {
        const h = document.documentElement;
        const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
        document.getElementById('progressBar').style.width = pct + '%';
    });

    // ── Helpers ──────────────────────────────────────────────
    const fmt = n => n >= 1000 ? d3.format(',.0f')(n) : String(n);
    const fmtPct = n => n.toFixed(1) + '%';
    const parseDay = d => new Date(d.date || d.day);

    function movingAvg(data, window) {
        if (!window) return data.map(d => d.new_users);
        return data.map((_, i) => {
            const start = Math.max(0, i - window + 1);
            const slice = data.slice(start, i + 1);
            return slice.reduce((s, d) => s + d.new_users, 0) / slice.length;
        });
    }

    function showTooltip(html, event) {
        tooltip.html(html).classed('visible', true)
            .style('left', (event.clientX + 14) + 'px')
            .style('top', (event.clientY - 10) + 'px');
    }
    function hideTooltip() { tooltip.classed('visible', false); }

    function animateCount(el, target) {
        const dur = 1200;
        const start = performance.now();
        const isFloat = target % 1 !== 0;
        (function tick(now) {
            const p = Math.min((now - start) / dur, 1);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = isFloat
                ? (target * e).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                : Math.round(target * e).toLocaleString('en-US');
            if (p < 1) requestAnimationFrame(tick);
        })(start);
    }

    // ── Data fetching ────────────────────────────────────────
    async function loadAll() {
        const [statsRes, summaryRes, waRes, formulaRes] = await Promise.all([
            fetch('/api/stats/daily').then(r => r.json()),
            fetch('/api/stats/summary').then(r => r.json()),
            fetch('/api/wallet-age/latest').then(r => r.json()).catch(() => null),
            fetch('/api/formulas').then(r => r.json()),
        ]);

        dailyData = statsRes.data || [];
        walletAge = waRes?.data || null;
        formulas = formulaRes?.formulas || {};
        const summary = summaryRes;

        initHero(summary);
        initScrollAnimations();
    }

    // ── Hero ─────────────────────────────────────────────────
    function initHero(summary) {
        const latest = summary.latest || {};
        const metrics = summary.metrics || {};

        document.getElementById('heroTitle').textContent = 'Twin Matrix';

        if (latest.cumulative_holders) {
            document.getElementById('heroHolders').textContent = fmt(latest.cumulative_holders);
        }
        if (latest.new_users !== undefined) {
            document.getElementById('heroToday').textContent = fmt(latest.new_users);
        }
        document.getElementById('heroDays').textContent = fmt(metrics.total_days || dailyData.length);
        if (metrics.avg_7d) {
            document.getElementById('heroAvg7d').textContent = fmt(Math.round(metrics.avg_7d));
        }

        // Last update timestamp
        if (latest.synced_at) {
            const d = new Date(latest.synced_at);
            const ts = d.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            document.getElementById('heroLastUpdate').textContent = `Last synced: ${ts} (UTC)`;
            const footerEl = document.getElementById('footerUpdate');
            if (footerEl) footerEl.textContent = `Data as of ${ts} UTC · Auto-refreshed every 4 hours`;
        }

        // Hero entrance animation
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
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

    // ── Scroll-Triggered Init ────────────────────────────────
    const initState = {};
    function once(id, fn) {
        if (initState[id]) return;
        initState[id] = true;
        fn();
    }

    function initScrollAnimations() {
        // Animate scene labels/titles + explanation blocks + formula cards
        document.querySelectorAll('.scene').forEach(scene => {
            const inner = scene.querySelector('.scene-inner');
            if (!inner) return;
            ['.scene-label', '.scene-title', '.scene-narrative'].forEach((sel, i) => {
                const el = inner.querySelector(sel);
                if (el) {
                    gsap.fromTo(el, { opacity: 0, y: 25 }, {
                        opacity: 1, y: 0, duration: 0.7, delay: i * 0.12,
                        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
                    });
                }
            });
            inner.querySelectorAll('.explanation-block').forEach(el => {
                gsap.fromTo(el, { opacity: 0, y: 15 }, {
                    opacity: 1, y: 0, duration: 0.6,
                    scrollTrigger: { trigger: el, start: 'top 85%', once: true },
                });
            });
            inner.querySelectorAll('.card, .metric-card').forEach((el, i) => {
                gsap.fromTo(el, { opacity: 0, y: 30 }, {
                    opacity: 1, y: 0, duration: 0.6, delay: i * 0.1,
                    scrollTrigger: { trigger: el, start: 'top 85%', once: true },
                });
            });
            inner.querySelectorAll('.formula-card').forEach(el => {
                gsap.fromTo(el, { opacity: 0, y: 20 }, {
                    opacity: 1, y: 0, duration: 0.6,
                    scrollTrigger: { trigger: el, start: 'top 90%', once: true },
                });
            });
            inner.querySelectorAll('.insight-card').forEach((el, i) => {
                gsap.fromTo(el, { opacity: 0, x: -20 }, {
                    opacity: 1, x: 0, duration: 0.5, delay: i * 0.12,
                    scrollTrigger: { trigger: el, start: 'top 90%', once: true },
                });
            });
        });

        // Timeline chart (scroll-triggered)
        ScrollTrigger.create({
            trigger: '#timelineCard', start: 'top 85%', once: true,
            onEnter: () => once('timeline', () => {
                buildTimelineMetrics();
                buildTimelineChart();
                buildCumulativeChart();
                buildTimelineFormulas();
            }),
        });

        // Wallet charts
        ScrollTrigger.create({
            trigger: '#ageDonutCard', start: 'top 85%', once: true,
            onEnter: () => once('wallet', () => {
                buildWalletCharts();
                buildWalletFormulas();
            }),
        });

        // Heatmap
        ScrollTrigger.create({
            trigger: '#heatmapCard', start: 'top 85%', once: true,
            onEnter: () => once('heatmap', () => {
                buildHeatmap();
                buildAgeStrip();
            }),
        });

        // Insights
        ScrollTrigger.create({
            trigger: '#insightsGrid', start: 'top 85%', once: true,
            onEnter: () => once('insights', buildInsights),
        });
    }

    // ══════════════════════════════════════════════════════════
    // TIMELINE CHART (D3 brush + zoom + MA toggle)
    // ══════════════════════════════════════════════════════════

    function buildTimelineMetrics() {
        const container = document.getElementById('timelineMetrics');
        if (!dailyData.length) return;

        const last = dailyData[dailyData.length - 1];
        const avg = dailyData.reduce((s, d) => s + d.new_users, 0) / dailyData.length;
        const last7 = dailyData.slice(-7);
        const avg7 = last7.reduce((s, d) => s + d.new_users, 0) / last7.length;

        const peak = dailyData.reduce((m, d) => d.new_users > m.new_users ? d : m, dailyData[0]);

        const cards = [
            { value: last.new_users, label: 'Latest Day', spark: last7 },
            { value: Math.round(avg), label: 'Avg. Daily (All-Time)', spark: null },
            { value: Math.round(avg7), label: 'Avg. Daily (7d)', spark: null },
            { value: peak.new_users, label: `Peak (${peak.date})`, spark: null },
        ];

        container.innerHTML = cards.map((c, i) => `
            <div class="metric-card" id="mc${i}">
                <div class="metric-value" data-count="${c.value}">0</div>
                <div class="metric-label">${c.label}</div>
                ${c.spark ? `<div class="metric-spark" id="spark${i}"></div>` : ''}
            </div>
        `).join('');

        // Count-up animation
        container.querySelectorAll('.metric-card').forEach((el, i) => {
            ScrollTrigger.create({
                trigger: el, start: 'top 90%', once: true,
                onEnter: () => {
                    gsap.fromTo(el, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 });
                    animateCount(el.querySelector('.metric-value'), cards[i].value);
                },
            });
        });

        // Sparkline
        if (last7.length > 1) {
            const sparkEl = document.getElementById('spark0');
            if (sparkEl) buildSparkline(sparkEl, last7.map(d => d.new_users));
        }

        // Narrative
        const changeDir = avg7 > avg ? 'above' : 'below';
        document.getElementById('timelineNarrative').textContent =
            `Over ${dailyData.length} days, the contract has onboarded ${fmt(last.cumulative_holders)} unique holders. ` +
            `The 7-day average (${fmt(Math.round(avg7))}/day) is ${changeDir} the all-time average (${fmt(Math.round(avg))}/day).`;
    }

    function buildSparkline(container, vals) {
        const w = container.clientWidth || 120, h = 30;
        const svg = d3.select(container).append('svg').attr('width', w).attr('height', h);
        const x = d3.scaleLinear().domain([0, vals.length - 1]).range([2, w - 2]);
        const y = d3.scaleLinear().domain([d3.min(vals) * 0.9, d3.max(vals) * 1.1]).range([h - 2, 2]);
        const line = d3.line().x((_, i) => x(i)).y(d => y(d)).curve(d3.curveCatmullRom);
        svg.append('path').datum(vals).attr('fill', 'none')
            .attr('stroke', C.accent).attr('stroke-width', 1.5).attr('d', line);
    }

    let mainChartSvg, mainX, mainY, brushX;
    function buildTimelineChart() {
        if (!dailyData.length) return;
        const container = document.getElementById('timelineChart');
        const margin = { top: 12, right: 20, bottom: 30, left: 50 };
        const W = container.clientWidth;
        const H = 320;
        const w = W - margin.left - margin.right;
        const h = H - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const dates = dailyData.map(d => new Date(d.date));
        mainX = d3.scaleTime().domain(d3.extent(dates)).range([0, w]);
        mainY = d3.scaleLinear().domain([0, d3.max(dailyData, d => d.new_users) * 1.1]).nice().range([h, 0]);

        // Grid
        g.append('g').attr('class', 'grid').call(d3.axisLeft(mainY).tickSize(-w).tickFormat(''))
            .selectAll('line').attr('stroke', C.grid).attr('stroke-dasharray', '2,3');
        g.selectAll('.grid .domain').remove();

        // Axes
        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(mainX).ticks(8).tickFormat(d3.timeFormat('%b %d')))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');
        g.append('g').call(d3.axisLeft(mainY).ticks(6).tickFormat(d3.format(',.0f')))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');
        g.selectAll('.domain').attr('stroke', C.grid);

        // Bars
        const barW = Math.max(1, w / dailyData.length - 1);
        const bars = g.selectAll('.bar').data(dailyData).enter().append('rect')
            .attr('class', 'bar')
            .attr('x', d => mainX(new Date(d.date)) - barW / 2)
            .attr('width', barW)
            .attr('y', h).attr('height', 0)
            .attr('fill', (d, i) => i === dailyData.length - 1 ? C.accent : 'rgba(192,120,92,0.25)')
            .attr('rx', Math.min(barW / 2, 2));

        bars.transition().duration(1000).delay((_, i) => i * 3)
            .attr('y', d => mainY(d.new_users))
            .attr('height', d => h - mainY(d.new_users));

        // Hover
        bars.on('mousemove', function (event, d) {
            d3.select(this).attr('fill', C.accentDark);
            showTooltip(`<strong>${d.date}</strong><br>New users: ${fmt(d.new_users)}<br>Total: ${fmt(d.cumulative_holders)}`, event);
        }).on('mouseout', function (event, d) {
            const i = dailyData.indexOf(d);
            d3.select(this).attr('fill', i === dailyData.length - 1 ? C.accent : 'rgba(192,120,92,0.25)');
            hideTooltip();
        });

        // MA line
        const maVals = movingAvg(dailyData, currentMA);
        const maLine = d3.line()
            .x((_, i) => mainX(dates[i]))
            .y((d) => mainY(d))
            .curve(d3.curveCatmullRom);

        const maPath = g.append('path')
            .datum(maVals)
            .attr('fill', 'none')
            .attr('stroke', C.accentDark)
            .attr('stroke-width', 2)
            .attr('d', maLine);

        // Animate MA path
        const pathLen = maPath.node().getTotalLength();
        maPath.attr('stroke-dasharray', pathLen)
            .attr('stroke-dashoffset', pathLen)
            .transition().duration(1500).attr('stroke-dashoffset', 0);

        mainChartSvg = { g, bars, maPath, maLine, dates, h, w, margin, svg };

        // MA toggle
        document.querySelectorAll('#maGroup .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#maGroup .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMA = parseInt(btn.dataset.ma);
                updateMALine();
            });
        });

        // Brush for zoom
        buildBrushChart(dates);
    }

    function updateMALine() {
        if (!mainChartSvg) return;
        const ma = movingAvg(dailyData, currentMA);
        mainChartSvg.maPath.datum(ma)
            .transition().duration(600).attr('d', mainChartSvg.maLine)
            .attr('stroke-dasharray', 'none');
    }

    function buildBrushChart(dates) {
        const container = document.getElementById('brushChart');
        const margin = { top: 2, right: 20, bottom: 2, left: 50 };
        const W = container.clientWidth;
        const H = 48;
        const w = W - margin.left - margin.right;
        const h = H - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        brushX = d3.scaleTime().domain(d3.extent(dates)).range([0, w]);
        const brushY = d3.scaleLinear().domain(mainY.domain()).range([h, 0]);

        // Mini area
        const area = d3.area()
            .x((_, i) => brushX(dates[i]))
            .y0(h).y1(d => brushY(d.new_users))
            .curve(d3.curveCatmullRom);

        g.append('path').datum(dailyData)
            .attr('fill', 'rgba(192,120,92,0.2)')
            .attr('stroke', C.accent).attr('stroke-width', 0.5).attr('d', area);

        // Brush
        const brush = d3.brushX().extent([[0, 0], [w, h]])
            .on('brush end', ({ selection }) => {
                if (!selection) {
                    mainX.domain(d3.extent(dates));
                } else {
                    mainX.domain(selection.map(brushX.invert));
                }
                updateMainChart();
            });

        g.append('g').attr('class', 'brush').call(brush);
    }

    function updateMainChart() {
        if (!mainChartSvg) return;
        const { g, bars, maPath, maLine, dates, h, w } = mainChartSvg;
        const barW = Math.max(1, w / dailyData.length - 1);

        bars.transition().duration(400)
            .attr('x', d => mainX(new Date(d.date)) - barW / 2)
            .attr('y', d => mainY(d.new_users))
            .attr('height', d => h - mainY(d.new_users));

        g.select('g:nth-child(3)').transition().duration(400) // x axis
            .call(d3.axisBottom(mainX).ticks(8).tickFormat(d3.timeFormat('%b %d')));

        const ma = movingAvg(dailyData, currentMA);
        maPath.datum(ma).transition().duration(400).attr('d', maLine);
    }

    // ── Cumulative Growth ────────────────────────────────────
    function buildCumulativeChart() {
        if (!dailyData.length) return;
        const container = document.getElementById('cumulativeChart');
        const margin = { top: 12, right: 20, bottom: 30, left: 55 };
        const W = container.clientWidth;
        const H = 280;
        const w = W - margin.left - margin.right;
        const h = H - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const dates = dailyData.map(d => new Date(d.date));
        const x = d3.scaleTime().domain(d3.extent(dates)).range([0, w]);
        const y = d3.scaleLinear().domain([0, d3.max(dailyData, d => d.cumulative_holders) * 1.05]).nice().range([h, 0]);

        // Grid
        g.append('g').call(d3.axisLeft(y).tickSize(-w).tickFormat(''))
            .selectAll('line').attr('stroke', C.grid).attr('stroke-dasharray', '2,3');
        g.selectAll('.domain').remove();

        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');
        g.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(',.0f')))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');

        // Area
        const area = d3.area()
            .x((d, i) => x(dates[i])).y0(h).y1(d => y(d.cumulative_holders))
            .curve(d3.curveCatmullRom);
        g.append('path').datum(dailyData)
            .attr('fill', 'rgba(192,120,92,0.1)')
            .attr('d', area);

        // Line
        const line = d3.line().x((d, i) => x(dates[i])).y(d => y(d.cumulative_holders)).curve(d3.curveCatmullRom);
        const path = g.append('path').datum(dailyData)
            .attr('fill', 'none').attr('stroke', C.accent).attr('stroke-width', 2.5).attr('d', line);
        const len = path.node().getTotalLength();
        path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
            .transition().duration(2000).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

        // Milestone markers
        const milestones = [10000, 25000, 50000, 75000];
        milestones.forEach(m => {
            const pt = dailyData.find(d => d.cumulative_holders >= m);
            if (pt) {
                const cx = x(new Date(pt.date)), cy = y(pt.cumulative_holders);
                g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 4)
                    .attr('fill', C.accent).attr('stroke', '#fff').attr('stroke-width', 2)
                    .style('opacity', 0).transition().delay(1500).duration(500).style('opacity', 1);
                g.append('text').attr('x', cx).attr('y', cy - 10)
                    .attr('text-anchor', 'middle').attr('fill', C.muted)
                    .attr('font-size', '9px').attr('font-weight', 600)
                    .text(fmt(m));
            }
        });

        // Hover
        const hoverLine = g.append('line').attr('y1', 0).attr('y2', h).attr('stroke', C.muted).attr('stroke-dasharray', '3,3').style('opacity', 0);
        const hoverCircle = g.append('circle').attr('r', 5).attr('fill', C.accent).attr('stroke', '#fff').attr('stroke-width', 2).style('opacity', 0);
        svg.on('mousemove', function (event) {
            const [mx] = d3.pointer(event, g.node());
            const date = x.invert(mx);
            const bisect = d3.bisector(d => new Date(d.date)).left;
            const idx = Math.min(bisect(dailyData, date), dailyData.length - 1);
            const d = dailyData[idx];
            hoverLine.attr('x1', x(new Date(d.date))).attr('x2', x(new Date(d.date))).style('opacity', 1);
            hoverCircle.attr('cx', x(new Date(d.date))).attr('cy', y(d.cumulative_holders)).style('opacity', 1);
            showTooltip(`<strong>${d.date}</strong><br>Total holders: ${fmt(d.cumulative_holders)}`, event);
        }).on('mouseout', () => {
            hoverLine.style('opacity', 0); hoverCircle.style('opacity', 0); hideTooltip();
        });
    }

    // ══════════════════════════════════════════════════════════
    // WALLET ANALYSIS (Donut + Bar)
    // ══════════════════════════════════════════════════════════

    function buildWalletCharts() {
        if (!walletAge) {
            document.getElementById('walletNarrative').textContent = 'No wallet age data available yet. Run a daily sync first.';
            return;
        }

        const ageDist = walletAge.age_distribution || [];
        const txDist = walletAge.tx_distribution || [];
        const total = walletAge.total_analyzed || 0;

        // Narrative
        const noHist = ageDist.find(d => d.age_bucket === 'No history (<=1y)');
        const noHistPct = noHist ? noHist.pct : 0;
        document.getElementById('walletNarrative').textContent =
            `Of ${fmt(total)} analyzed wallets, ${fmtPct(noHistPct)} are brand-new with no prior history. ` +
            `${noHistPct > 50 ? 'High proportion of fresh wallets may indicate new-to-crypto users.' : 'Majority are existing wallet users, suggesting organic adoption.'}`;

        buildDonut(ageDist);
        buildTxBars(txDist);
    }

    function buildDonut(data) {
        const container = document.getElementById('ageDonut');
        const size = Math.min(container.clientWidth, 300);
        const radius = size / 2 - 10;

        const svg = d3.select(container).append('svg')
            .attr('width', size).attr('height', size)
            .append('g').attr('transform', `translate(${size / 2},${size / 2})`);

        const pie = d3.pie().value(d => d.users).sort(null);
        const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);
        const arcHover = d3.arc().innerRadius(radius * 0.55).outerRadius(radius + 8);
        const color = d3.scaleOrdinal().range(WARM);

        const arcs = svg.selectAll('.arc').data(pie(data)).enter().append('g');

        arcs.append('path')
            .attr('d', arc).attr('fill', (d, i) => color(i))
            .attr('stroke', C.bg).attr('stroke-width', 2)
            .style('opacity', 0)
            .transition().duration(800).delay((_, i) => i * 100)
            .style('opacity', 1)
            .attrTween('d', function (d) {
                const i = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
                return t => arc(i(t));
            });

        // Hover
        arcs.selectAll('path')
            .on('mousemove', function (event, d) {
                d3.select(this).transition().duration(150).attr('d', arcHover);
                showTooltip(`<strong>${d.data.age_bucket}</strong><br>${fmt(d.data.users)} users (${fmtPct(d.data.pct)})`, event);
            })
            .on('mouseout', function () {
                d3.select(this).transition().duration(150).attr('d', arc);
                hideTooltip();
            });

        // Center text
        svg.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
            .attr('fill', C.text).attr('font-size', '1.3rem').attr('font-weight', 800)
            .text(fmt(data.reduce((s, d) => s + d.users, 0)));
        svg.append('text').attr('text-anchor', 'middle').attr('dy', '1.3em')
            .attr('fill', C.muted).attr('font-size', '0.65rem').attr('letter-spacing', '0.1em')
            .text('WALLETS');
    }

    function buildTxBars(data) {
        const container = document.getElementById('txBar');
        const margin = { top: 10, right: 15, bottom: 30, left: 45 };
        const W = container.clientWidth;
        const H = 300;
        const w = W - margin.left - margin.right;
        const h = H - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().domain(data.map(d => d.tx_count_bucket)).range([0, w]).padding(0.3);
        const y = d3.scaleLinear().domain([0, d3.max(data, d => d.users) * 1.1]).nice().range([h, 0]);

        g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');
        g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(',.0f')))
            .selectAll('text').attr('fill', C.muted).attr('font-size', '10px');
        g.selectAll('.domain').attr('stroke', C.grid);

        g.selectAll('.bar').data(data).enter().append('rect')
            .attr('x', d => x(d.tx_count_bucket))
            .attr('width', x.bandwidth())
            .attr('y', h).attr('height', 0)
            .attr('fill', C.accent).attr('rx', 4)
            .on('mousemove', (event, d) => showTooltip(`<strong>${d.tx_count_bucket} txs</strong><br>${fmt(d.users)} users (${fmtPct(d.pct)})`, event))
            .on('mouseout', hideTooltip)
            .transition().duration(800).delay((_, i) => i * 80)
            .attr('y', d => y(d.users)).attr('height', d => h - y(d.users));
    }

    // ══════════════════════════════════════════════════════════
    // HEATMAP
    // ══════════════════════════════════════════════════════════

    function buildHeatmap() {
        if (!walletAge || !walletAge.cross_tab) return;
        const data = walletAge.cross_tab;
        const AGE = ['No history (<=1y)', '<7d', '7-29d', '30-89d', '90-179d', '180d-1y'];
        const TX = ['0', '1-2', '3-9', '10-49', '50-199', '200+'];

        const lookup = {};
        let maxVal = 0, total = 0;
        data.forEach(d => {
            lookup[d.age_bucket + '|' + d.tx_count_bucket] = d.users;
            total += d.users;
            if (d.users > maxVal) maxVal = d.users;
        });

        function render(mode) {
            const thead = document.getElementById('heatmapHead');
            const tbody = document.getElementById('heatmapBody');
            thead.innerHTML = `<tr><th>Wallet Age</th>${TX.map(t => `<th>${t} txs</th>`).join('')}</tr>`;
            tbody.innerHTML = '';

            AGE.forEach(age => {
                const tr = document.createElement('tr');
                const td0 = document.createElement('td');
                td0.className = 'row-label'; td0.textContent = age;
                tr.appendChild(td0);

                TX.forEach(tx => {
                    const td = document.createElement('td');
                    const val = lookup[age + '|' + tx] || 0;
                    if (mode === 'pct') {
                        const pct = total > 0 ? val / total * 100 : 0;
                        td.textContent = pct > 0 ? fmtPct(pct) : '·';
                    } else {
                        td.textContent = val > 0 ? fmt(val) : '·';
                    }
                    if (val > 0 && maxVal > 0) {
                        const intensity = val / maxVal;
                        td.style.background = `rgba(192,120,92,${0.1 + intensity * 0.6})`;
                        td.style.color = intensity > 0.5 ? '#FBF8F1' : '#5A5550';
                    }
                    td.addEventListener('mousemove', e => {
                        showTooltip(`<strong>${age}</strong> × <strong>${tx} txs</strong><br>Users: ${fmt(val)} (${fmtPct(total > 0 ? val / total * 100 : 0)})`, e);
                    });
                    td.addEventListener('mouseout', hideTooltip);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        render(heatmapMode);

        document.querySelectorAll('#heatmapMode .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#heatmapMode .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                heatmapMode = btn.dataset.mode;
                render(heatmapMode);
            });
        });
    }

    function buildAgeStrip() {
        if (!walletAge || !walletAge.age_distribution) return;
        const data = walletAge.age_distribution;
        const total = data.reduce((s, d) => s + d.users, 0);
        const strip = document.getElementById('ageStrip');
        const legend = document.getElementById('ageStripLegend');
        strip.innerHTML = ''; legend.innerHTML = '';

        data.forEach((d, i) => {
            const pct = total > 0 ? d.users / total * 100 : 0;
            if (pct <= 0) return;
            const seg = document.createElement('div');
            seg.style.width = pct + '%';
            seg.style.background = WARM[i % WARM.length];
            seg.style.transition = 'width 1s ease';
            seg.title = `${d.age_bucket}: ${fmtPct(pct)}`;
            strip.appendChild(seg);

            const item = document.createElement('span');
            item.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${WARM[i % WARM.length]};margin-right:3px;vertical-align:middle;"></span>${d.age_bucket} (${fmtPct(pct)})`;
            legend.appendChild(item);
        });
    }

    // ══════════════════════════════════════════════════════════
    // INSIGHTS
    // ══════════════════════════════════════════════════════════

    function buildInsights() {
        const grid = document.getElementById('insightsGrid');
        const insights = [];

        if (dailyData.length >= 7) {
            const last = dailyData[dailyData.length - 1];
            const avg = dailyData.reduce((s, d) => s + d.new_users, 0) / dailyData.length;
            const ratio = last.new_users / avg;
            if (ratio > 1.5) {
                insights.push({
                    type: 'positive', title: 'Above-Average Day',
                    detail: `Latest day (${fmt(last.new_users)}) is ${ratio.toFixed(1)}x the all-time avg (${fmt(Math.round(avg))}). Growth is accelerating.`
                });
            } else if (ratio < 0.5) {
                insights.push({
                    type: 'warning', title: 'Below-Average Day',
                    detail: `Latest day (${fmt(last.new_users)}) is ${ratio.toFixed(1)}x the all-time avg (${fmt(Math.round(avg))}). May warrant investigation.`
                });
            }

            const last14 = dailyData.slice(-14);
            if (last14.length >= 14) {
                const r7 = last14.slice(7).reduce((s, d) => s + d.new_users, 0) / 7;
                const p7 = last14.slice(0, 7).reduce((s, d) => s + d.new_users, 0) / 7;
                const chg = p7 > 0 ? ((r7 - p7) / p7 * 100) : 0;
                if (chg > 20) {
                    insights.push({
                        type: 'positive', title: 'Strong Growth Momentum',
                        detail: `7-day average is up ${fmtPct(Math.abs(chg))} vs prior week. Momentum is building.`
                    });
                } else if (chg < -20) {
                    insights.push({
                        type: 'warning', title: 'Growth Deceleration',
                        detail: `7-day average is down ${fmtPct(Math.abs(chg))} vs prior week. Review acquisition channels.`
                    });
                }
            }
        }

        if (walletAge) {
            const noHist = (walletAge.age_distribution || []).find(d => d.age_bucket === 'No history (<=1y)');
            if (noHist && noHist.pct > 70) {
                insights.push({
                    type: 'info', title: 'High New-Wallet Proportion',
                    detail: `${fmtPct(noHist.pct)} of new users have no prior history. Could indicate bot activity or genuinely new crypto users.`
                });
            }
        }

        if (!insights.length) {
            insights.push({
                type: 'info', title: 'Data Collection In Progress',
                detail: 'More insights will be generated as historical data accumulates.'
            });
        }

        grid.innerHTML = insights.map(ins => `
            <div class="insight-card ${ins.type}">
                <div class="title">${ins.title}</div>
                <div class="detail">${ins.detail}</div>
            </div>
        `).join('');

        // Animate
        grid.querySelectorAll('.insight-card').forEach((el, i) => {
            gsap.fromTo(el, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, delay: i * 0.12 });
        });
    }

    // ── Formulas ─────────────────────────────────────────────
    function buildTimelineFormulas() {
        const f = formulas.daily_mints;
        if (!f) return;
        const el = document.getElementById('timelineSQL');
        if (el) el.innerHTML = `<div class="desc">${f.description}</div><pre>${escHtml(f.sql)}</pre>`;
    }
    function buildWalletFormulas() {
        const f = formulas.wallet_age_analysis;
        if (!f) return;
        const el = document.getElementById('walletSQL');
        if (el) el.innerHTML = `<div class="desc">${f.description}</div><pre>${escHtml(f.sql)}</pre>`;
    }
    function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    // ── Boot ─────────────────────────────────────────────────
    loadAll().catch(err => {
        console.error('Failed to load data:', err);
        document.getElementById('heroTitle').textContent = 'Error Loading Data';
    });

})();
