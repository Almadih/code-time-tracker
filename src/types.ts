export interface Heartbeat {
    timestamp: number;
    project: string;
    language: string;
    file: string;
    branch?: string;
}

export interface Session {
    project: string;
    start: number;
    end: number;
    duration: number; // seconds
}

export interface DailyStats {
    date: string; // YYYY-MM-DD
    totalSeconds: number;
    activeSeconds: number;
    projects: { [projectName: string]: number };
}
