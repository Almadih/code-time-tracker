(function() {
    const vscode = acquireVsCodeApi();
    
    let rawStats = {};
    let rawHeartbeats = [];
    
    let weeklyChart = null;
    let projectChart = null;
    let languageChart = null;
    let hourlyChart = null;

    // Palette for charts
    const COLOR_PALETTE = [
        '#3b82f6', '#10b981', '#a855f7', '#f97316', '#14b8a6',
        '#f59e0b', '#ec4899', '#6366f1', '#8b5cf6', '#06b6d4'
    ];

    // Initial data request
    vscode.postMessage({ command: 'getData' });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'setData':
                const payload = message.data || {};
                rawStats = payload.stats || {};
                rawHeartbeats = payload.heartbeats || [];
                updateView();
                break;
        }
    });

    // DOM Elements
    const rangeSelect = document.getElementById('rangeSelect');
    const customRange = document.getElementById('customRange');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const refreshBtn = document.getElementById('refreshBtn');
    const noDataMessage = document.getElementById('noDataMessage');
    const mainDashboard = document.getElementById('mainDashboard');
    const tableSearchInput = document.getElementById('tableSearchInput');

    // KPI Elements
    const kpiTotalTime = document.getElementById('kpiTotalTime');
    const kpiActiveDays = document.getElementById('kpiActiveDays');
    const kpiDailyAvg = document.getElementById('kpiDailyAvg');
    const kpiDailyAvgSub = document.getElementById('kpiDailyAvgSub');
    const kpiStreak = document.getElementById('kpiStreak');
    const kpiBestStreak = document.getElementById('kpiBestStreak');
    const kpiTopProject = document.getElementById('kpiTopProject');
    const kpiTopProjectTime = document.getElementById('kpiTopProjectTime');
    const kpiTopLanguage = document.getElementById('kpiTopLanguage');
    const kpiTopLanguageTime = document.getElementById('kpiTopLanguageTime');

    // Badges
    const dailyTotalBadge = document.getElementById('dailyTotalBadge');
    const peakHourBadge = document.getElementById('peakHourBadge');
    const rowCountBadge = document.getElementById('rowCountBadge');

    // Event Listeners
    rangeSelect.addEventListener('change', () => {
        if (rangeSelect.value === 'custom') {
            customRange.classList.remove('hidden');
        } else {
            customRange.classList.add('hidden');
            updateView();
        }
    });

    [startDateInput, endDateInput].forEach(el => {
        el.addEventListener('change', updateView);
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span>⏳</span> Refreshing...';
            vscode.postMessage({ command: 'recalculate' });
            setTimeout(() => {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<span>⚡</span> Refresh';
            }, 1200);
        });
    }

    if (tableSearchInput) {
        tableSearchInput.addEventListener('input', () => {
            filterTableRows();
        });
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0m';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.round((seconds % 3600) / 60);
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        return `${mins}m`;
    }

    function calculateStreaks(allDates) {
        if (!allDates || allDates.length === 0) {
            return { current: 0, best: 0 };
        }

        const sortedDates = [...allDates].sort();
        const activeSet = new Set(sortedDates);

        // Calculate all streaks
        let bestStreak = 0;
        let currentRun = 0;
        let prevDate = null;

        sortedDates.forEach(dStr => {
            const cur = new Date(dStr);
            if (prevDate) {
                const diffTime = cur.getTime() - prevDate.getTime();
                const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
                if (diffDays === 1) {
                    currentRun += 1;
                } else if (diffDays > 1) {
                    currentRun = 1;
                }
            } else {
                currentRun = 1;
            }
            if (currentRun > bestStreak) bestStreak = currentRun;
            prevDate = cur;
        });

        // Calculate current active streak ending today or yesterday
        let currentStreak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let checkDate = new Date(today);
        const todayStr = checkDate.toISOString().split('T')[0];

        if (!activeSet.has(todayStr)) {
            checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
            const dateStr = checkDate.toISOString().split('T')[0];
            if (activeSet.has(dateStr)) {
                currentStreak += 1;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        return { current: currentStreak, best: bestStreak };
    }

    function getDateRangeFilter() {
        const now = new Date();
        const mode = rangeSelect.value;

        if (mode === 'today') {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            return { start: d, end: new Date(now.setHours(23, 59, 59, 999)) };
        } else if (mode === 'yesterday') {
            const dStart = new Date(now);
            dStart.setDate(dStart.getDate() - 1);
            dStart.setHours(0, 0, 0, 0);
            const dEnd = new Date(dStart);
            dEnd.setHours(23, 59, 59, 999);
            return { start: dStart, end: dEnd };
        } else if (mode === 'month') {
            const dStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            const dEnd = new Date(now);
            dEnd.setHours(23, 59, 59, 999);
            return { start: dStart, end: dEnd };
        } else if (mode === 'all') {
            return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
        } else if (mode === 'custom') {
            const start = startDateInput.value ? new Date(startDateInput.value + 'T00:00:00') : new Date(2000, 0, 1);
            const end = endDateInput.value ? new Date(endDateInput.value + 'T23:59:59') : new Date();
            return { start, end };
        } else {
            const days = parseInt(mode, 10) || 7;
            const cutoff = new Date(now);
            cutoff.setDate(now.getDate() - (days - 1));
            cutoff.setHours(0, 0, 0, 0);
            const end = new Date(now);
            end.setHours(23, 59, 59, 999);
            return { start: cutoff, end };
        }
    }

    function updateView() {
        const { start, end } = getDateRangeFilter();

        const allDateKeys = Object.keys(rawStats);
        const filteredDates = allDateKeys.filter(d => {
            const cur = new Date(d + 'T00:00:00');
            return cur >= start && cur <= end;
        }).sort();

        // Filter heartbeats
        const startTs = start.getTime();
        const endTs = end.getTime();
        const filteredHeartbeats = rawHeartbeats.filter(hb => {
            return hb.timestamp >= startTs && hb.timestamp <= endTs;
        });

        if (filteredDates.length === 0 && filteredHeartbeats.length === 0) {
            noDataMessage.classList.remove('hidden');
            mainDashboard.classList.add('hidden');
            renderKPIs([], [], allDateKeys);
            return;
        }

        noDataMessage.classList.add('hidden');
        mainDashboard.classList.remove('hidden');

        renderKPIs(filteredDates, filteredHeartbeats, allDateKeys);
        renderCharts(filteredDates, filteredHeartbeats);
        renderTable(filteredDates);
    }

    function renderKPIs(dates, heartbeats, allDates) {
        let totalActiveSec = 0;
        const projectTotals = {};
        const languageTotals = {};

        dates.forEach(d => {
            const dayStat = rawStats[d];
            if (dayStat) {
                totalActiveSec += dayStat.activeSeconds || 0;
                Object.entries(dayStat.projects || {}).forEach(([pName, sec]) => {
                    projectTotals[pName] = (projectTotals[pName] || 0) + sec;
                });
            }
        });

        heartbeats.forEach(hb => {
            const lang = hb.language || 'unknown';
            if (lang && lang !== 'unknown') {
                languageTotals[lang] = (languageTotals[lang] || 0) + 1;
            }
        });

        // 1. Total Time
        kpiTotalTime.textContent = formatDuration(totalActiveSec);
        kpiActiveDays.textContent = `${dates.length} active day${dates.length === 1 ? '' : 's'}`;

        // 2. Daily Average
        const dailyAvgSec = dates.length > 0 ? Math.round(totalActiveSec / dates.length) : 0;
        kpiDailyAvg.textContent = formatDuration(dailyAvgSec);
        kpiDailyAvgSub.textContent = `across ${dates.length} active day${dates.length === 1 ? '' : 's'}`;

        // 3. Streaks
        const streaks = calculateStreaks(allDates);
        kpiStreak.textContent = `${streaks.current} Day${streaks.current === 1 ? '' : 's'}`;
        kpiBestStreak.textContent = `Best: ${streaks.best} Day${streaks.best === 1 ? '' : 's'}`;

        // 4. Top Project
        const sortedProjects = Object.entries(projectTotals).sort((a, b) => b[1] - a[1]);
        if (sortedProjects.length > 0) {
            const [topProj, topSec] = sortedProjects[0];
            const pct = totalActiveSec > 0 ? Math.round((topSec / totalActiveSec) * 100) : 0;
            kpiTopProject.textContent = topProj;
            kpiTopProjectTime.textContent = `${formatDuration(topSec)} (${pct}%)`;
        } else {
            kpiTopProject.textContent = '-';
            kpiTopProjectTime.textContent = '0% of total';
        }

        // 5. Top Language
        const sortedLangs = Object.entries(languageTotals).sort((a, b) => b[1] - a[1]);
        if (sortedLangs.length > 0) {
            const [topLang, count] = sortedLangs[0];
            const totalLangCount = Object.values(languageTotals).reduce((a, b) => a + b, 0);
            const pct = totalLangCount > 0 ? Math.round((count / totalLangCount) * 100) : 0;
            kpiTopLanguage.textContent = topLang;
            kpiTopLanguageTime.textContent = `${pct}% of activity`;
        } else {
            kpiTopLanguage.textContent = '-';
            kpiTopLanguageTime.textContent = '0% of total';
        }

        dailyTotalBadge.textContent = `${(totalActiveSec / 3600).toFixed(1)}h total`;
    }

    function renderCharts(dates, heartbeats) {
        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded');
            return;
        }

        // --- Chart 1: Daily Activity Bar Chart ---
        const dailyLabels = dates.map(d => {
            const parts = d.split('-');
            return `${parts[1]}/${parts[2]}`;
        });
        const dailyHours = dates.map(d => {
            const sec = rawStats[d]?.activeSeconds || 0;
            return Math.round((sec / 3600) * 100) / 100;
        });

        if (weeklyChart) weeklyChart.destroy();
        const ctxDaily = document.getElementById('weeklyChart').getContext('2d');
        weeklyChart = new Chart(ctxDaily, {
            type: 'bar',
            data: {
                labels: dailyLabels,
                datasets: [{
                    label: 'Hours Coded',
                    data: dailyHours,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6,
                    borderSkipped: false,
                    hoverBackgroundColor: '#60a5fa'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const hrs = ctx.parsed.y;
                                const totalMin = Math.round(hrs * 60);
                                return ` ${Math.floor(totalMin / 60)}h ${totalMin % 60}m (${hrs} hrs)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#9aa4b8',
                            callback: v => v + 'h'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9aa4b8' }
                    }
                }
            }
        });

        const MAX_SLICES = 6;

        // --- Chart 2: Project Breakdown Doughnut ---
        const projectMap = {};
        dates.forEach(d => {
            if (rawStats[d]) {
                Object.entries(rawStats[d].projects || {}).forEach(([p, sec]) => {
                    projectMap[p] = (projectMap[p] || 0) + sec;
                });
            }
        });

        const sortedProjects = Object.entries(projectMap).sort((a, b) => b[1] - a[1]);
        let projectLabels = [];
        let projectValues = [];

        if (sortedProjects.length > MAX_SLICES) {
            const topProjects = sortedProjects.slice(0, MAX_SLICES);
            const otherProjects = sortedProjects.slice(MAX_SLICES);
            const otherTotalSec = otherProjects.reduce((acc, curr) => acc + curr[1], 0);

            projectLabels = topProjects.map(p => p[0]);
            projectValues = topProjects.map(p => Math.round((p[1] / 3600) * 100) / 100);

            if (otherTotalSec > 0) {
                projectLabels.push(`Other (${otherProjects.length} projects)`);
                projectValues.push(Math.round((otherTotalSec / 3600) * 100) / 100);
            }
        } else {
            projectLabels = sortedProjects.map(p => p[0]);
            projectValues = sortedProjects.map(p => Math.round((p[1] / 3600) * 100) / 100);
        }

        const projectColors = projectLabels.map((lbl, idx) => {
            if (lbl.startsWith('Other')) return '#64748b';
            return COLOR_PALETTE[idx % COLOR_PALETTE.length];
        });

        if (projectChart) projectChart.destroy();
        const ctxProject = document.getElementById('projectChart').getContext('2d');
        projectChart = new Chart(ctxProject, {
            type: 'doughnut',
            data: {
                labels: projectLabels.length > 0 ? projectLabels : ['No Data'],
                datasets: [{
                    data: projectValues.length > 0 ? projectValues : [1],
                    backgroundColor: projectColors,
                    borderWidth: 2,
                    borderColor: '#1f2330'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#e0e0e0',
                            font: { size: 11 },
                            boxWidth: 12,
                            padding: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const val = ctx.parsed;
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                                return ` ${ctx.label}: ${val} hrs (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '68%'
            }
        });

        // --- Chart 3: Language Breakdown Doughnut ---
        const languageMap = {};
        heartbeats.forEach(hb => {
            const lang = hb.language || 'unknown';
            if (lang && lang !== 'unknown') {
                languageMap[lang] = (languageMap[lang] || 0) + 1;
            }
        });

        const sortedLangs = Object.entries(languageMap).sort((a, b) => b[1] - a[1]);
        let langLabels = [];
        let langCounts = [];

        if (sortedLangs.length > MAX_SLICES) {
            const topLangs = sortedLangs.slice(0, MAX_SLICES);
            const otherLangs = sortedLangs.slice(MAX_SLICES);
            const otherTotalCount = otherLangs.reduce((acc, curr) => acc + curr[1], 0);

            langLabels = topLangs.map(l => l[0]);
            langCounts = topLangs.map(l => l[1]);

            if (otherTotalCount > 0) {
                langLabels.push(`Other (${otherLangs.length} languages)`);
                langCounts.push(otherTotalCount);
            }
        } else {
            langLabels = sortedLangs.map(l => l[0]);
            langCounts = sortedLangs.map(l => l[1]);
        }

        const langColors = langLabels.map((lbl, idx) => {
            if (lbl.startsWith('Other')) return '#64748b';
            return COLOR_PALETTE[idx % COLOR_PALETTE.length];
        });

        if (languageChart) languageChart.destroy();
        const ctxLang = document.getElementById('languageChart').getContext('2d');
        languageChart = new Chart(ctxLang, {
            type: 'doughnut',
            data: {
                labels: langLabels.length > 0 ? langLabels : ['No Language Data'],
                datasets: [{
                    data: langCounts.length > 0 ? langCounts : [1],
                    backgroundColor: langColors,
                    borderWidth: 2,
                    borderColor: '#1f2330'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#e0e0e0',
                            font: { size: 11 },
                            boxWidth: 12,
                            padding: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                                return ` ${ctx.label}: ${pct}% (${ctx.parsed} activity points)`;
                            }
                        }
                    }
                },
                cutout: '68%'
            }
        });

        // --- Chart 4: Hourly Productivity Distribution ---
        const hourlyBuckets = new Array(24).fill(0);
        heartbeats.forEach(hb => {
            const d = new Date(hb.timestamp);
            const hour = d.getHours();
            hourlyBuckets[hour] += 1;
        });

        let peakHour = 0;
        let maxHourlyCount = 0;
        hourlyBuckets.forEach((c, h) => {
            if (c > maxHourlyCount) {
                maxHourlyCount = c;
                peakHour = h;
            }
        });

        const formattedPeakHour = `${peakHour.toString().padStart(2, '0')}:00 - ${(peakHour + 1).toString().padStart(2, '0')}:00`;
        peakHourBadge.textContent = maxHourlyCount > 0 ? `Peak: ${formattedPeakHour}` : 'Peak: -';

        const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

        if (hourlyChart) hourlyChart.destroy();
        const ctxHourly = document.getElementById('hourlyChart').getContext('2d');
        hourlyChart = new Chart(ctxHourly, {
            type: 'bar',
            data: {
                labels: hourlyLabels,
                datasets: [{
                    label: 'Activity Distribution',
                    data: hourlyBuckets,
                    backgroundColor: hourlyBuckets.map((_, i) => i === peakHour && maxHourlyCount > 0 ? '#10b981' : '#6366f1'),
                    borderRadius: 4,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y} heartbeats at ${ctx.label}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9aa4b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#9aa4b8',
                            font: { size: 10 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    }
                }
            }
        });
    }

    function renderTable(dates) {
        const tbody = document.querySelector('#statsTable tbody');
        tbody.innerHTML = '';

        let totalRows = 0;

        [...dates].reverse().forEach(d => {
            const dayStat = rawStats[d];
            if (dayStat && dayStat.projects) {
                const dayTotal = dayStat.activeSeconds || 1;
                Object.entries(dayStat.projects)
                    .sort((a, b) => b[1] - a[1])
                    .forEach(([pName, sec]) => {
                        totalRows += 1;
                        const pct = Math.min(100, Math.round((sec / dayTotal) * 100));
                        const isAi = pName === 'AI Assistant';
                        
                        const tr = document.createElement('tr');
                        tr.setAttribute('data-project', pName.toLowerCase());
                        tr.setAttribute('data-date', d);
                        
                        tr.innerHTML = `
                            <td><strong>${d}</strong></td>
                            <td>
                                <span class="project-chip ${isAi ? 'ai-assistant' : ''}">
                                    ${isAi ? '🤖' : '📁'} ${pName}
                                </span>
                            </td>
                            <td><span class="duration-val">${formatDuration(sec)}</span></td>
                            <td>
                                <div class="share-bar-container">
                                    <div class="share-bar">
                                        <div class="share-bar-fill" style="width: ${pct}%;"></div>
                                    </div>
                                    <span class="share-text">${pct}%</span>
                                </div>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
            }
        });

        rowCountBadge.textContent = `${totalRows} records`;
        filterTableRows();
    }

    function filterTableRows() {
        const query = (tableSearchInput?.value || '').trim().toLowerCase();
        const rows = document.querySelectorAll('#statsTable tbody tr');
        let visibleCount = 0;

        rows.forEach(row => {
            const proj = row.getAttribute('data-project') || '';
            const date = row.getAttribute('data-date') || '';
            if (!query || proj.includes(query) || date.includes(query)) {
                row.style.display = '';
                visibleCount += 1;
            } else {
                row.style.display = 'none';
            }
        });

        rowCountBadge.textContent = `${visibleCount} records`;
    }
})();


