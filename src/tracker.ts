import * as vscode from 'vscode';
import { StorageManager } from './storage';
import { Heartbeat } from './types';
import { EventEmitter } from 'events';

export class ActivityTracker extends EventEmitter {
    private lastHeartbeatTime: number = 0;
    private readonly heartbeatInterval = 60000; // 1 minute
    private disposables: vscode.Disposable[] = [];

    constructor(private storage: StorageManager) {
        super();
    }

    public activate() {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => this.onActivity(e.document.uri)),
            vscode.window.onDidChangeActiveTextEditor(e => e && this.onActivity(e.document.uri)),
            vscode.window.onDidChangeTextEditorSelection(e => this.onActivity(e.textEditor.document.uri))
        );
        
        console.log('Activity Tracker activated');
    }

    private onActivity(uri: vscode.Uri) {
        if (uri.scheme !== 'file') return;

        const now = Date.now();
        if (now - this.lastHeartbeatTime > this.heartbeatInterval) {
            this.sendHeartbeat(uri);
            this.lastHeartbeatTime = now;
        }
    }

    private sendHeartbeat(uri: vscode.Uri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const projectName = workspaceFolder ? workspaceFolder.name : 'Unknown Project';
        
        const heartbeat: Heartbeat = {
            timestamp: Date.now(),
            project: projectName,
            language: vscode.window.activeTextEditor?.document.languageId || 'unknown',
            file: uri.fsPath
        };

        this.storage.saveHeartbeat(heartbeat);
        this.emit('heartbeat', heartbeat);
    }

    public deactivate() {
        this.disposables.forEach(d => d.dispose());
    }
}
