import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Heartbeat, DailyStats } from './types';
import dayjs from 'dayjs';

export class StorageManager {
    private storageUri: vscode.Uri;
    private dataFile: string;

    constructor(context: vscode.ExtensionContext) {
        this.storageUri = context.globalStorageUri;
        this.dataFile = path.join(this.storageUri.fsPath, 'data.json');
        
        // Ensure storage directory exists
        if (!fs.existsSync(this.storageUri.fsPath)) {
            fs.mkdirSync(this.storageUri.fsPath, { recursive: true });
        }

        if (!fs.existsSync(this.dataFile)) {
            fs.writeFileSync(this.dataFile, JSON.stringify({ heartbeats: [], stats: {} }));
        }
    }

    public async saveHeartbeat(heartbeat: Heartbeat) {
        try {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            data.heartbeats.push(heartbeat);
            
            // Limit heartbeats to keep file size reasonable (e.g., last 10000)
            if (data.heartbeats.length > 10000) {
                data.heartbeats.shift();
            }

            this.updateStats(data, heartbeat);
            
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving heartbeat:', error);
        }
    }

    private updateStats(data: any, heartbeat: Heartbeat) {
        const date = dayjs(heartbeat.timestamp).format('YYYY-MM-DD');
        if (!data.stats[date]) {
            data.stats[date] = {
                date,
                totalSeconds: 0,
                activeSeconds: 0,
                projects: {}
            };
        }

        const stats: DailyStats = data.stats[date];
        
        // Simple logic: each heartbeat represents ~1 minute of activity if they are sparse
        // But here we just count heartbeats. Better logic would be to calculate diff between last heartbeat.
        const lastHeartbeat = data.heartbeats[data.heartbeats.length - 2];
        let duration = 0;
        
        if (lastHeartbeat) {
            const diff = (heartbeat.timestamp - lastHeartbeat.timestamp) / 1000;
            // If diff is less than 5 minutes, count it as continuous
            if (diff < 300) {
                duration = diff;
            } else {
                duration = 60; // Assume 1 minute for a new session start
            }
        } else {
            duration = 60;
        }

        stats.activeSeconds += Math.min(duration, 300); // Cap at 5 mins to avoid jumps
        stats.projects[heartbeat.project] = (stats.projects[heartbeat.project] || 0) + Math.min(duration, 300);
    }

    public getStats(): { [date: string]: DailyStats } {
        try {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            return data.stats;
        } catch (error) {
            return {};
        }
    }

    public getTodayStats(): DailyStats | undefined {
        const date = dayjs().format('YYYY-MM-DD');
        return this.getStats()[date];
    }
}
