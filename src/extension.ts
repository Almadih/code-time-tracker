import * as vscode from 'vscode';
import { StorageManager } from './storage';
import { ActivityTracker } from './tracker';
import { DashboardProvider } from './dashboard';
import { SidebarViewProvider } from './sidebar';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Time Tracker is now active');

    const storage = new StorageManager(context);
    const tracker = new ActivityTracker(storage);
    const dashboard = new DashboardProvider(context, storage);
    const sidebar = new SidebarViewProvider(context, storage);

    // Register Sidebar Webview View
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('code-time-tracker-stats', sidebar)
    );

    tracker.activate();
    tracker.on('heartbeat', () => {
        updateStatusBar(storage);
        sidebar.refresh();
    });

    // Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'code-time-tracker.openDashboard';
    context.subscriptions.push(statusBarItem);

    // Update status bar and sidebar every minute as fallback
    updateStatusBar(storage);
    setInterval(() => {
        updateStatusBar(storage);
        sidebar.refresh();
    }, 60000);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('code-time-tracker.openDashboard', () => {
            dashboard.show();
        }),
        vscode.commands.registerCommand('code-time-tracker.recalculateStats', () => {
            const result = storage.repairAndRecalculate();
            updateStatusBar(storage);
            sidebar.refresh();
            if (result.success) {
                vscode.window.showInformationMessage(
                    `Code Time Tracker: Successfully recalculated statistics (${result.repairedCount} entries repaired).`
                );
            } else {
                vscode.window.showErrorMessage('Code Time Tracker: Failed to recalculate statistics.');
            }
        })
    );

    // Cleanup
    context.subscriptions.push({
        dispose: () => tracker.deactivate()
    });
}

function updateStatusBar(storage: StorageManager) {
    const stats = storage.getTodayStats();
    if (stats) {
        const hours = Math.floor(stats.activeSeconds / 3600);
        const mins = Math.floor((stats.activeSeconds % 3600) / 60);
        
        // Find current project
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const currentProject = workspaceFolders ? workspaceFolders[0].name : '';
        const projectTimeSec = stats.projects[currentProject] || 0;
        const pMins = Math.floor(projectTimeSec / 60);

        statusBarItem.text = `$(watch) ${hours}h ${mins}m (${pMins}m in ${currentProject})`;
        statusBarItem.tooltip = `Total: ${hours}h ${mins}m | Project: ${pMins}m - Click to view dashboard`;
        statusBarItem.show();
    } else {
        statusBarItem.text = `$(watch) 0h 0m`;
        statusBarItem.show();
    }
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
