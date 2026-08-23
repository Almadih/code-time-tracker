import * as vscode from 'vscode';
import dayjs from 'dayjs';
import { StorageManager } from './storage';
import { DailyStats, Heartbeat } from './types';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codeTimeTracker.statsView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly storage: StorageManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(this.context.extensionPath)
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'getData':
                    this.sendDataToWebview();
                    break;
                case 'openDashboard':
                    vscode.commands.executeCommand('code-time-tracker.openDashboard');
                    break;
                case 'recalculate':
                    vscode.commands.executeCommand('code-time-tracker.recalculateStats');
                    this.sendDataToWebview();
                    break;
            }
        });

        // Send initial data once webview is ready
        this.sendDataToWebview();
    }

    public refresh() {
        this.sendDataToWebview();
    }

    private sendDataToWebview() {
        if (!this._view) return;
        const summary = this.computeSummary();
        this._view.webview.postMessage({
            command: 'setData',
            data: summary
        });
    }

    private computeSummary() {
        const fullData = this.storage.getFullData();
        const stats = fullData.stats || {};
        const heartbeats = fullData.heartbeats || [];

        const todayStr = dayjs().format('YYYY-MM-DD');
        const yesterdayStr = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

        const todayStat: DailyStats = stats[todayStr] || { date: todayStr, totalSeconds: 0, activeSeconds: 0, projects: {} };
        const yesterdayStat: DailyStats = stats[yesterdayStr] || { date: yesterdayStr, totalSeconds: 0, activeSeconds: 0, projects: {} };

        const todaySec = todayStat.activeSeconds || 0;
        const yesterdaySec = yesterdayStat.activeSeconds || 0;

        // Compare with yesterday
        let diffYesterday = '0m vs yesterday';
        const diffSec = todaySec - yesterdaySec;
        if (Math.abs(diffSec) < 60) {
            diffYesterday = 'Same as yesterday';
        } else if (diffSec > 0) {
            diffYesterday = `▲ +${this.formatMinutes(diffSec)} vs yesterday`;
        } else {
            diffYesterday = `▼ -${this.formatMinutes(Math.abs(diffSec))} vs yesterday`;
        }

        // Current Workspace Project
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const currentProjectName = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].name : '';
        const currentProjectSec = currentProjectName ? (todayStat.projects[currentProjectName] || 0) : 0;
        const currentProjectPct = todaySec > 0 ? Math.round((currentProjectSec / todaySec) * 100) : 0;

        // Today's Projects List
        const projectsList = Object.entries(todayStat.projects || {})
            .sort((a, b) => b[1] - a[1])
            .map(([name, sec]) => ({
                name,
                seconds: sec,
                formatted: this.formatDuration(sec),
                percent: todaySec > 0 ? Math.round((sec / todaySec) * 100) : 0,
                isCurrent: name === currentProjectName,
                isAi: name === 'AI Assistant'
            }));

        // Streaks
        const allDates = Object.keys(stats).sort();
        const streaks = this.calculateStreaks(allDates);

        // Languages Today
        const todayStartTs = dayjs().startOf('day').valueOf();
        const todayLangs: { [lang: string]: number } = {};
        heartbeats.forEach(hb => {
            if (hb.timestamp >= todayStartTs && hb.language && hb.language !== 'unknown') {
                todayLangs[hb.language] = (todayLangs[hb.language] || 0) + 1;
            }
        });
        const totalLangHits = Object.values(todayLangs).reduce((a, b) => a + b, 0);
        const topLanguages = Object.entries(todayLangs)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name, count]) => ({
                name,
                percent: totalLangHits > 0 ? Math.round((count / totalLangHits) * 100) : 0
            }));

        // Milestones (This Week & All Time)
        const weekStartStr = dayjs().startOf('week').format('YYYY-MM-DD');
        let weekSec = 0;
        let allTimeSec = 0;

        Object.entries(stats).forEach(([d, s]) => {
            const sec = s.activeSeconds || 0;
            allTimeSec += sec;
            if (d >= weekStartStr && d <= todayStr) {
                weekSec += sec;
            }
        });

        return {
            todayFormatted: this.formatDuration(todaySec),
            todaySec,
            diffYesterday,
            streakCurrent: streaks.current,
            streakBest: streaks.best,
            currentProject: {
                name: currentProjectName,
                formatted: this.formatDuration(currentProjectSec),
                percent: currentProjectPct
            },
            projects: projectsList,
            languages: topLanguages,
            thisWeekFormatted: this.formatDuration(weekSec),
            allTimeFormatted: `${(allTimeSec / 3600).toFixed(1)} hrs`
        };
    }

    private formatDuration(seconds: number): string {
        if (!seconds || seconds <= 0) return '0m';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.round((seconds % 3600) / 60);
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        return `${mins}m`;
    }

    private formatMinutes(seconds: number): string {
        const mins = Math.round(seconds / 60);
        if (mins >= 60) {
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            return `${hrs}h ${remMins}m`;
        }
        return `${mins}m`;
    }

    private calculateStreaks(allDates: string[]) {
        if (!allDates || allDates.length === 0) {
            return { current: 0, best: 0 };
        }

        const sortedDates = [...allDates].sort();
        const activeSet = new Set(sortedDates);

        let bestStreak = 0;
        let currentRun = 0;
        let prevDate: Date | null = null;

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

    private getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
    <title>Code Time</title>
    <style>
        :root {
            --accent: #3b82f6;
            --accent-green: #10b981;
            --accent-orange: #f97316;
            --accent-purple: #a855f7;
            --card-bg: var(--vscode-sideBarSectionHeader-background, rgba(255, 255, 255, 0.04));
            --border-subtle: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-sideBar-foreground, #cccccc);
            background-color: transparent;
            margin: 0;
            padding: 12px 14px 24px 14px;
            line-height: 1.4;
            box-sizing: border-box;
        }

        * {
            box-sizing: border-box;
        }

        /* Pulse Hero Card */
        .hero-card {
            background: var(--card-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .hero-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .hero-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--vscode-descriptionForeground, #888888);
            font-weight: 600;
        }

        .streak-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 999px;
            background: rgba(249, 115, 22, 0.15);
            color: #fb923c;
            border: 1px solid rgba(249, 115, 22, 0.3);
        }

        .hero-time {
            font-size: 24px;
            font-weight: 700;
            color: var(--vscode-editor-foreground, #ffffff);
            letter-spacing: -0.02em;
        }

        .hero-sub {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888888);
        }

        /* Section Card */
        .section-card {
            background: var(--card-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 12px;
        }

        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--vscode-descriptionForeground, #888888);
            margin: 0 0 10px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        /* Current Project */
        .curr-proj-name {
            font-weight: 600;
            font-size: 13px;
            color: #93c5fd;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .curr-proj-time {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #888888);
        }

        /* Project Progress Rows */
        .proj-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .proj-item {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        .proj-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
        }

        .proj-item-name {
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 150px;
        }

        .proj-item-time {
            font-weight: 600;
            color: var(--vscode-editor-foreground, #ffffff);
            font-size: 11px;
        }

        .bar-track {
            height: 4px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 999px;
            overflow: hidden;
        }

        .bar-fill {
            height: 100%;
            border-radius: 999px;
            background: linear-gradient(90deg, #3b82f6, #10b981);
        }

        .bar-fill.ai {
            background: linear-gradient(90deg, #a855f7, #ec4899);
        }

        /* Languages Chips */
        .chips-wrap {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .lang-chip {
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid var(--border-subtle);
            color: var(--vscode-sideBar-foreground, #cccccc);
        }

        /* Milestones Grid */
        .milestones-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
        }

        .mini-stat {
            background: var(--card-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .mini-stat-label {
            font-size: 10px;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground, #888888);
            font-weight: 600;
        }

        .mini-stat-val {
            font-size: 14px;
            font-weight: 700;
            color: var(--vscode-editor-foreground, #ffffff);
        }

        /* Buttons */
        .btn-stack {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 14px;
        }

        .btn {
            width: 100%;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid transparent;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s ease;
            font-family: inherit;
        }

        .btn-primary {
            background: var(--vscode-button-background, #3b82f6);
            color: var(--vscode-button-foreground, #ffffff);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground, #2563eb);
        }

        .btn-secondary {
            background: transparent;
            border-color: var(--border-subtle);
            color: var(--vscode-sideBar-foreground, #cccccc);
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .empty-hint {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #888888);
            font-style: italic;
        }
    </style>
</head>
<body>
    <!-- Pulse Hero -->
    <div class="hero-card">
        <div class="hero-header">
            <span class="hero-label">Today's Code Time</span>
            <span class="streak-badge" id="streakBadge">🔥 0 Days</span>
        </div>
        <div class="hero-time" id="todayTime">0m</div>
        <div class="hero-sub" id="todaySub">0m vs yesterday</div>
    </div>

    <!-- Current Project Card -->
    <div class="section-card" id="currentProjectSection">
        <div class="section-title">Current Workspace</div>
        <div class="curr-proj-name" id="currProjName">📁 (No Project Open)</div>
        <div class="curr-proj-time" id="currProjTime">0m coded today (0%)</div>
    </div>

    <!-- Today's Projects Breakdown -->
    <div class="section-card">
        <div class="section-title">
            <span>Projects Today</span>
            <span id="projCountBadge">0</span>
        </div>
        <div class="proj-list" id="projectList">
            <div class="empty-hint">No project activity recorded today.</div>
        </div>
    </div>

    <!-- Languages Today -->
    <div class="section-card" id="langSection">
        <div class="section-title">Languages Today</div>
        <div class="chips-wrap" id="langList">
            <div class="empty-hint">No language activity yet.</div>
        </div>
    </div>

    <!-- Milestones Grid -->
    <div class="milestones-grid">
        <div class="mini-stat">
            <span class="mini-stat-label">This Week</span>
            <span class="mini-stat-val" id="weekTime">0m</span>
        </div>
        <div class="mini-stat">
            <span class="mini-stat-label">All-Time</span>
            <span class="mini-stat-val" id="allTime">0 hrs</span>
        </div>
    </div>

    <!-- Actions -->
    <div class="btn-stack">
        <button class="btn btn-primary" id="openDashBtn">
            <span>📊</span> Open Full Dashboard
        </button>
        <button class="btn btn-secondary" id="recalcBtn">
            <span>⚡</span> Sync & Recalculate
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        vscode.postMessage({ command: 'getData' });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setData') {
                render(message.data || {});
            }
        });

        document.getElementById('openDashBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'openDashboard' });
        });

        document.getElementById('recalcBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'recalculate' });
        });

        function render(data) {
            document.getElementById('todayTime').textContent = data.todayFormatted || '0m';
            document.getElementById('todaySub').textContent = data.diffYesterday || '';
            document.getElementById('streakBadge').textContent = \`🔥 \${data.streakCurrent || 0} Day\${data.streakCurrent === 1 ? '' : 's'}\`;

            // Current Project
            if (data.currentProject && data.currentProject.name) {
                document.getElementById('currProjName').textContent = '📁 ' + data.currentProject.name;
                document.getElementById('currProjTime').textContent = \`\${data.currentProject.formatted} coded today (\${data.currentProject.percent}%)\`;
            } else {
                document.getElementById('currProjName').textContent = '📁 (No workspace)';
                document.getElementById('currProjTime').textContent = 'Open a project folder to track';
            }

            // Projects List
            const projContainer = document.getElementById('projectList');
            projContainer.innerHTML = '';
            const projects = data.projects || [];
            document.getElementById('projCountBadge').textContent = projects.length;

            if (projects.length === 0) {
                projContainer.innerHTML = '<div class="empty-hint">No project activity recorded today.</div>';
            } else {
                projects.forEach(p => {
                    const row = document.createElement('div');
                    row.className = 'proj-item';
                    row.innerHTML = \`
                        <div class="proj-item-header">
                            <span class="proj-item-name" title="\${p.name}">\${p.isAi ? '🤖' : '📁'} \${p.name}</span>
                            <span class="proj-item-time">\${p.formatted} (\${p.percent}%)</span>
                        </div>
                        <div class="bar-track">
                            <div class="bar-fill \${p.isAi ? 'ai' : ''}" style="width: \${p.percent}%;"></div>
                        </div>
                    \`;
                    projContainer.appendChild(row);
                });
            }

            // Languages
            const langContainer = document.getElementById('langList');
            langContainer.innerHTML = '';
            const languages = data.languages || [];
            if (languages.length === 0) {
                langContainer.innerHTML = '<div class="empty-hint">No language activity yet.</div>';
            } else {
                languages.forEach(l => {
                    const chip = document.createElement('span');
                    chip.className = 'lang-chip';
                    chip.textContent = \`\${l.name} \${l.percent}%\`;
                    langContainer.appendChild(chip);
                });
            }

            // Milestones
            document.getElementById('weekTime').textContent = data.thisWeekFormatted || '0m';
            document.getElementById('allTime').textContent = data.allTimeFormatted || '0 hrs';
        }
    </script>
</body>
</html>`;
    }
}
