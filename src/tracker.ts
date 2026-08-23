import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageManager } from './storage';
import { Heartbeat } from './types';
import { EventEmitter } from 'events';

const projectDirCache = new Map<string, string>();

/**
 * Resolves a project name from a file path by traversing upwards
 * looking for Git roots or common project configuration markers.
 */
export function resolveProjectFromFilePath(filePath: string, fallbackWorkspaceName?: string): string {
    if (!filePath) {
        return fallbackWorkspaceName || 'Unknown Project';
    }

    // Check for AI Assistant artifacts / brain / prompt files
    if (
        filePath.includes('/.gemini/') ||
        filePath.includes('/.antigravity/') ||
        filePath.includes('\\.gemini\\') ||
        filePath.includes('\\.antigravity\\')
    ) {
        return fallbackWorkspaceName || 'AI Assistant';
    }

    // Check for IDE configuration and global storage files
    if (filePath.includes('/.config/') || filePath.includes('\\.config\\')) {
        return fallbackWorkspaceName || 'IDE Config';
    }

    const dir = path.dirname(filePath);
    if (projectDirCache.has(dir)) {
        return projectDirCache.get(dir)!;
    }

    let currentDir = dir;
    const homedir = os.homedir();
    const projectMarkers = [
        '.git',
        'package.json',
        'composer.json',
        'Cargo.toml',
        'go.mod',
        'pyproject.toml',
        'pom.xml',
        'build.gradle'
    ];

    while (currentDir && currentDir !== '/' && currentDir !== homedir) {
        for (const marker of projectMarkers) {
            try {
                if (fs.existsSync(path.join(currentDir, marker))) {
                    const projectName = path.basename(currentDir);
                    projectDirCache.set(dir, projectName);
                    return projectName;
                }
            } catch {
                // Ignore filesystem access errors
            }
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    if (fallbackWorkspaceName) {
        projectDirCache.set(dir, fallbackWorkspaceName);
        return fallbackWorkspaceName;
    }

    const baseDir = path.basename(dir);
    if (baseDir && baseDir !== 'tmp' && baseDir !== '.' && dir !== homedir && dir !== '/') {
        projectDirCache.set(dir, baseDir);
        return baseDir;
    }

    return 'Unknown Project';
}

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

    public resolveProject(uri: vscode.Uri): string {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return workspaceFolder.name;
        }

        const fallbackWorkspace = vscode.workspace.workspaceFolders?.[0]?.name;
        return resolveProjectFromFilePath(uri.fsPath, fallbackWorkspace);
    }

    private sendHeartbeat(uri: vscode.Uri) {
        const projectName = this.resolveProject(uri);
        
        let language = 'unknown';
        if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
            language = vscode.window.activeTextEditor.document.languageId;
        } else {
            const ext = path.extname(uri.fsPath).replace('.', '');
            language = ext || 'unknown';
        }
        
        const heartbeat: Heartbeat = {
            timestamp: Date.now(),
            project: projectName,
            language,
            file: uri.fsPath
        };

        this.storage.saveHeartbeat(heartbeat);
        this.emit('heartbeat', heartbeat);
    }

    public deactivate() {
        this.disposables.forEach(d => d.dispose());
    }
}

