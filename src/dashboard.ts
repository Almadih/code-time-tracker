import * as vscode from 'vscode';
import * as path from 'path';
import { StorageManager } from './storage';

export class DashboardProvider {
    public static readonly viewType = 'codeTimeDashboard';
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly storage: StorageManager
    ) {}

    public show() {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this.panel) {
            this.panel.reveal(column);
            this.sendDataToWebview();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            DashboardProvider.viewType,
            'Code Time Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
                ]
            }
        );

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);

        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'getData':
                        this.sendDataToWebview();
                        break;
                    case 'recalculate':
                        this.storage.repairAndRecalculate();
                        this.sendDataToWebview();
                        vscode.window.showInformationMessage('Code Time: Statistics recalculated successfully.');
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private sendDataToWebview() {
        if (!this.panel) return;
        const fullData = this.storage.getFullData();
        this.panel.webview.postMessage({
            command: 'setData',
            data: fullData
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptPath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'media', 'dashboard.js')
        );
        const scriptUri = webview.asWebviewUri(scriptPath);

        const stylePath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'media', 'dashboard.css')
        );
        const styleUri = webview.asWebviewUri(stylePath);

        const chartJsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'chart.umd.js'))
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:;">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <script src="${chartJsUri}"></script>
    <title>Code Time Dashboard</title>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="app-header">
            <div class="header-brand">
                <div class="brand-icon">⏱️</div>
                <div>
                    <h1>Code Time Dashboard</h1>
                    <p class="subtitle">Personal Developer Productivity & Activity Analytics</p>
                </div>
            </div>
            <div class="header-controls">
                <div class="filter-group">
                    <select id="rangeSelect" class="styled-select">
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7" selected>Last 7 Days</option>
                        <option value="14">Last 14 Days</option>
                        <option value="30">Last 30 Days</option>
                        <option value="90">Last 90 Days</option>
                        <option value="month">This Month</option>
                        <option value="all">All Time</option>
                        <option value="custom">Custom Range</option>
                    </select>
                    <div id="customRange" class="custom-range-inputs hidden">
                        <input type="date" id="startDate" class="styled-input">
                        <span class="range-sep">to</span>
                        <input type="date" id="endDate" class="styled-input">
                    </div>
                </div>
                <button id="refreshBtn" class="btn btn-secondary" title="Recalculate & Refresh Data">
                    <span>⚡</span> Refresh
                </button>
            </div>
        </header>

        <!-- KPI Metrics Grid -->
        <section class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-icon-wrap icon-blue">⌛</div>
                <div class="kpi-content">
                    <span class="kpi-label">Total Coded Time</span>
                    <span class="kpi-value" id="kpiTotalTime">0h 0m</span>
                    <span class="kpi-subtext" id="kpiActiveDays">0 active days</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon-wrap icon-green">📊</div>
                <div class="kpi-content">
                    <span class="kpi-label">Daily Average</span>
                    <span class="kpi-value" id="kpiDailyAvg">0h 0m</span>
                    <span class="kpi-subtext" id="kpiDailyAvgSub">per active day</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon-wrap icon-orange">🔥</div>
                <div class="kpi-content">
                    <span class="kpi-label">Coding Streak</span>
                    <span class="kpi-value" id="kpiStreak">0 Days</span>
                    <span class="kpi-subtext" id="kpiBestStreak">Best: 0 Days</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon-wrap icon-purple">🚀</div>
                <div class="kpi-content">
                    <span class="kpi-label">Top Project</span>
                    <span class="kpi-value" id="kpiTopProject">-</span>
                    <span class="kpi-subtext" id="kpiTopProjectTime">0% of total time</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon-wrap icon-teal">💻</div>
                <div class="kpi-content">
                    <span class="kpi-label">Top Language</span>
                    <span class="kpi-value" id="kpiTopLanguage">-</span>
                    <span class="kpi-subtext" id="kpiTopLanguageTime">0% of total</span>
                </div>
            </div>
        </section>

        <!-- Empty State Message -->
        <div id="noDataMessage" class="card empty-state-card hidden">
            <div class="empty-state-icon">📂</div>
            <h3>No Activity Recorded</h3>
            <p>There is no coding activity recorded for the selected time range. Try choosing a different range or start coding to see your analytics update.</p>
        </div>

        <!-- Visual Charts Grid -->
        <main id="mainDashboard">
            <div class="charts-grid">
                <!-- Daily Activity Chart -->
                <div class="card chart-card full-width">
                    <div class="card-header">
                        <div class="card-title">
                            <h3>📅 Daily Activity</h3>
                            <span class="card-badge" id="dailyTotalBadge">0h total</span>
                        </div>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="weeklyChart"></canvas>
                    </div>
                </div>

                <!-- Project Breakdown Chart -->
                <div class="card chart-card">
                    <div class="card-header">
                        <div class="card-title">
                            <h3>📁 Project Breakdown</h3>
                        </div>
                    </div>
                    <div class="chart-wrapper doughnut-wrapper">
                        <canvas id="projectChart"></canvas>
                    </div>
                </div>

                <!-- Language Distribution Chart -->
                <div class="card chart-card">
                    <div class="card-header">
                        <div class="card-title">
                            <h3>🌐 Languages Used</h3>
                        </div>
                    </div>
                    <div class="chart-wrapper doughnut-wrapper">
                        <canvas id="languageChart"></canvas>
                    </div>
                </div>

                <!-- Hourly Productivity Distribution Chart -->
                <div class="card chart-card full-width">
                    <div class="card-header">
                        <div class="card-title">
                            <h3>⏰ Peak Productivity Hours (24h Distribution)</h3>
                            <span class="card-badge" id="peakHourBadge">Peak: -</span>
                        </div>
                    </div>
                    <div class="chart-wrapper hourly-wrapper">
                        <canvas id="hourlyChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Detailed Stats Table Section -->
            <div class="card table-card">
                <div class="card-header table-header">
                    <div class="card-title">
                        <h3>📋 Detailed Breakdown</h3>
                        <span class="count-badge" id="rowCountBadge">0 records</span>
                    </div>
                    <div class="table-actions">
                        <div class="search-wrap">
                            <span class="search-icon">🔍</span>
                            <input type="text" id="tableSearchInput" placeholder="Filter projects or dates..." class="styled-input search-input">
                        </div>
                    </div>
                </div>
                <div class="table-responsive">
                    <table id="statsTable">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Project</th>
                                <th>Active Time</th>
                                <th>Share of Day</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}

