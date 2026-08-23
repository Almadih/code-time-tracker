import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Heartbeat, DailyStats } from './types';
import dayjs from 'dayjs';
import { resolveProjectFromFilePath } from './tracker';

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
            fs.writeFileSync(this.dataFile, JSON.stringify({ heartbeats: [], stats: {} }, null, 2));
        } else {
            this.migrateHistoricalData();
        }
    }

    /**
     * One-time migration / auto-repair on startup to re-resolve any 'Unknown Project'
     * entries in historical heartbeats and recompute stats accurately.
     */
    private migrateHistoricalData() {
        try {
            const fileContent = fs.readFileSync(this.dataFile, 'utf8');
            const data = JSON.parse(fileContent);

            if (!Array.isArray(data.heartbeats) || data.heartbeats.length === 0) {
                return;
            }

            let hasUnknowns = false;
            for (const hb of data.heartbeats) {
                if (hb.project === 'Unknown Project') {
                    hasUnknowns = true;
                    break;
                }
            }

            // If there are Unknown Projects or if stats need re-alignment
            if (hasUnknowns || !data._v2Attribution) {
                const backupFile = this.dataFile + '.bak';
                if (!fs.existsSync(backupFile)) {
                    fs.writeFileSync(backupFile, fileContent);
                }

                for (const hb of data.heartbeats) {
                    if (hb.project === 'Unknown Project') {
                        hb.project = resolveProjectFromFilePath(hb.file);
                    }
                }

                this.recalculateAllStats(data);
                data._v2Attribution = true;

                fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
                console.log('Code Time Tracker: Historical data migrated and stats recomputed successfully.');
            }
        } catch (error) {
            console.error('Code Time Tracker: Error migrating historical data:', error);
        }
    }

    public recalculateAllStats(data: { heartbeats: Heartbeat[]; stats: { [date: string]: DailyStats } }) {
        const stats: { [date: string]: DailyStats } = {};

        for (let i = 0; i < data.heartbeats.length; i++) {
            const heartbeat = data.heartbeats[i];
            const lastHeartbeat = i > 0 ? data.heartbeats[i - 1] : null;

            let duration = 60;
            let targetProject = heartbeat.project;
            let targetTimestamp = heartbeat.timestamp;

            if (lastHeartbeat) {
                const diff = (heartbeat.timestamp - lastHeartbeat.timestamp) / 1000;
                if (diff > 0 && diff < 300) {
                    // Continuous session: elapsed time belongs to the project worked on (lastHeartbeat)
                    duration = diff;
                    targetProject = lastHeartbeat.project;
                    targetTimestamp = lastHeartbeat.timestamp;
                } else {
                    // New session start
                    duration = 60;
                    targetProject = heartbeat.project;
                    targetTimestamp = heartbeat.timestamp;
                }
            }

            const clampedDuration = Math.min(duration, 300);
            const date = dayjs(targetTimestamp).format('YYYY-MM-DD');

            if (!stats[date]) {
                stats[date] = {
                    date,
                    totalSeconds: 0,
                    activeSeconds: 0,
                    projects: {}
                };
            }

            stats[date].activeSeconds += clampedDuration;
            stats[date].projects[targetProject] = (stats[date].projects[targetProject] || 0) + clampedDuration;
        }

        data.stats = stats;
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
        if (!data.stats) {
            data.stats = {};
        }

        const lastHeartbeat = data.heartbeats[data.heartbeats.length - 2];
        let duration = 60;
        let targetProject = heartbeat.project;
        let targetTimestamp = heartbeat.timestamp;

        if (lastHeartbeat) {
            const diff = (heartbeat.timestamp - lastHeartbeat.timestamp) / 1000;
            if (diff > 0 && diff < 300) {
                // Continuous activity: attribute elapsed time to lastHeartbeat project
                duration = diff;
                targetProject = lastHeartbeat.project;
                targetTimestamp = lastHeartbeat.timestamp;
            } else {
                duration = 60;
                targetProject = heartbeat.project;
                targetTimestamp = heartbeat.timestamp;
            }
        }

        const clampedDuration = Math.min(duration, 300);
        const date = dayjs(targetTimestamp).format('YYYY-MM-DD');

        if (!data.stats[date]) {
            data.stats[date] = {
                date,
                totalSeconds: 0,
                activeSeconds: 0,
                projects: {}
            };
        }

        const stats: DailyStats = data.stats[date];
        stats.activeSeconds += clampedDuration;
        stats.projects[targetProject] = (stats.projects[targetProject] || 0) + clampedDuration;
    }

    public repairAndRecalculate(): { success: boolean; repairedCount: number } {
        try {
            const fileContent = fs.readFileSync(this.dataFile, 'utf8');
            const data = JSON.parse(fileContent);
            if (!Array.isArray(data.heartbeats)) {
                return { success: false, repairedCount: 0 };
            }

            let repairedCount = 0;
            for (const hb of data.heartbeats) {
                if (hb.project === 'Unknown Project') {
                    hb.project = resolveProjectFromFilePath(hb.file);
                    repairedCount++;
                }
            }

            this.recalculateAllStats(data);
            data._v2Attribution = true;
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
            return { success: true, repairedCount };
        } catch (error) {
            console.error('Error repairing data:', error);
            return { success: false, repairedCount: 0 };
        }
    }

    public getStats(): { [date: string]: DailyStats } {
        try {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            return data.stats || {};
        } catch (error) {
            return {};
        }
    }

    public getTodayStats(): DailyStats | undefined {
        const date = dayjs().format('YYYY-MM-DD');
        return this.getStats()[date];
    }
}

