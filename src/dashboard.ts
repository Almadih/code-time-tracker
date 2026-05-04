import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            DashboardProvider.viewType,
            'Code Time Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
                    vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
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
                        this.panel?.webview.postMessage({
                            command: 'setData',
                            data: this.storage.getStats()
                        });
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
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
            vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'))
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
    <link href="${styleUri}" rel="stylesheet">
    <script src="${chartJsUri}"></script>
    <title>Code Time Dashboard</title>
</head>
<body>
    <div class="container">
        <header>
            <h1>Coding Activity</h1>
            <div class="filters">
                <select id="rangeSelect">
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                    <option value="custom">Custom Range</option>
                </select>
                <div id="customRange" class="hidden">
                    <input type="date" id="startDate">
                    <input type="date" id="endDate">
                </div>
            </div>
        </header>

        <div id="noDataMessage" class="card hidden">
            <p>No activity recorded for the selected period.</p>
        </div>

        <div class="grid">
            <div class="card chart-container">
                <h2>Time per Day (Last 7 Days)</h2>
                <canvas id="weeklyChart"></canvas>
            </div>
            <div class="card chart-container">
                <h2>Project Breakdown</h2>
                <canvas id="projectChart"></canvas>
            </div>
        </div>

        <div class="card stats-table">
            <h2>Detailed Stats</h2>
            <table id="statsTable">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Project</th>
                        <th>Active Time</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
