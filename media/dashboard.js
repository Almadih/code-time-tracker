(function() {
    const vscode = acquireVsCodeApi();
    let originalData = {};
    let weeklyChart = null;
    let projectChart = null;
    
    // Initial data request
    vscode.postMessage({ command: 'getData' });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'setData':
                originalData = message.data || {};
                updateView();
                break;
        }
    });

    const rangeSelect = document.getElementById('rangeSelect');
    const customRange = document.getElementById('customRange');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const noDataMessage = document.getElementById('noDataMessage');
    const grid = document.querySelector('.grid');
    const statsTable = document.querySelector('.stats-table');

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

    function updateView() {
        let filteredDates = [];
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        
        if (rangeSelect.value === 'custom') {
            const start = startDateInput.value ? new Date(startDateInput.value) : null;
            const end = endDateInput.value ? new Date(endDateInput.value) : new Date();
            if (start) {
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                filteredDates = Object.keys(originalData).filter(d => {
                    const date = new Date(d);
                    return date >= start && date <= end;
                });
            }
        } else {
            const days = parseInt(rangeSelect.value);
            const cutoff = new Date();
            cutoff.setDate(now.getDate() - (days - 1));
            cutoff.setHours(0, 0, 0, 0);
            
            filteredDates = Object.keys(originalData).filter(d => {
                const date = new Date(d);
                return date >= cutoff;
            });
        }

        if (filteredDates.length === 0) {
            noDataMessage.classList.remove('hidden');
            grid.classList.add('hidden');
            statsTable.classList.add('hidden');
        } else {
            noDataMessage.classList.add('hidden');
            grid.classList.remove('hidden');
            statsTable.classList.remove('hidden');
            renderDashboard(originalData, filteredDates.sort());
        }
    }

    function renderDashboard(data, dates) {
        const dailyTime = dates.map(d => Math.round((data[d]?.activeSeconds || 0) / 3600 * 100) / 100);

        // Weekly Chart
        if (typeof Chart !== 'undefined') {
            if (weeklyChart) weeklyChart.destroy();
            const ctxWeekly = document.getElementById('weeklyChart').getContext('2d');
            weeklyChart = new Chart(ctxWeekly, {
                type: 'bar',
                data: {
                    labels: dates,
                    datasets: [{
                        label: 'Hours Coded',
                        data: dailyTime,
                        backgroundColor: '#4a90e2',
                        borderRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#404040' } },
                        x: { grid: { display: false } }
                    }
                }
            });

            // Project Breakdown
            const projects = {};
            dates.forEach(d => {
                if (data[d]) {
                    Object.entries(data[d].projects).forEach(([name, sec]) => {
                        projects[name] = (projects[name] || 0) + sec;
                    });
                }
            });

            const projectNames = Object.keys(projects);
            const projectValues = Object.values(projects).map(s => Math.round(s / 3600 * 100) / 100);

            if (projectChart) projectChart.destroy();
            const ctxProject = document.getElementById('projectChart').getContext('2d');
            projectChart = new Chart(ctxProject, {
                type: 'doughnut',
                data: {
                    labels: projectNames,
                    datasets: [{
                        data: projectValues,
                        backgroundColor: ['#4a90e2', '#50e3c2', '#b8e986', '#f5a623', '#d0021b']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }

        // Table
        const tbody = document.querySelector('#statsTable tbody');
        tbody.innerHTML = '';
        [...dates].reverse().forEach(d => {
            if (data[d]) {
                Object.entries(data[d].projects).forEach(([name, sec]) => {
                    const row = `<tr>
                        <td>${d}</td>
                        <td>${name}</td>
                        <td>${Math.round(sec / 60)} mins</td>
                    </tr>`;
                    tbody.innerHTML += row;
                });
            }
        });
    }
})();
