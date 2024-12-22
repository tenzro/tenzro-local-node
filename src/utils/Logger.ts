// tenzro-local-node/src/utils/Logger.ts

import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';

export class Logger {
    private static instance: Logger;
    private logger: any;
    private context: string = 'Global';

    private constructor() {
        // Create logs directory if it doesn't exist
        const logDir = './logs';
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }

        this.logger = createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: format.combine(
                format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                format.errors({ stack: true }),
                format.splat(),
                format.json()
            ),
            defaultMeta: { service: 'local-node' },
            transports: [
                // Write logs to console
                new transports.Console({
                    format: format.combine(
                        format.colorize(),
                        format.printf(info => {
                            const { timestamp, level, message, context, ...meta } = info;
                            const contextStr = context || this.context;
                            const metaStr = Object.keys(meta).length ? 
                                JSON.stringify(meta, null, 2) : '';
                            return `[${timestamp}] [${level}] [${contextStr}] ${message} ${metaStr}`;
                        })
                    )
                }),
                // Write logs to file
                new transports.File({
                    filename: path.join(logDir, 'error.log'),
                    level: 'error',
                    maxsize: 10 * 1024 * 1024, // 10MB
                    maxFiles: 5,
                    tailable: true
                }),
                new transports.File({
                    filename: path.join(logDir, 'combined.log'),
                    maxsize: 10 * 1024 * 1024, // 10MB
                    maxFiles: 5,
                    tailable: true
                })
            ]
        });

        // Add error tracking in development
        if (process.env.NODE_ENV !== 'production') {
            this.logger.on('error', (error: Error) => {
                console.error('Logger error:', error);
            });
        }
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public setContext(context: string): void {
        this.context = context;
    }

    public info(message: string, meta?: any): void {
        this.logger.info(message, { context: this.context, ...meta });
    }

    public error(message: string, error?: Error, meta?: any): void {
        this.logger.error(message, {
            context: this.context,
            error: error?.stack,
            ...meta
        });
    }

    public warn(message: string, meta?: any): void {
        this.logger.warn(message, { context: this.context, ...meta });
    }

    public debug(message: string, meta?: any): void {
        this.logger.debug(message, { context: this.context, ...meta });
    }

    public verbose(message: string, meta?: any): void {
        this.logger.verbose(message, { context: this.context, ...meta });
    }

    // Additional utility methods
    public startTimer(id: string): void {
        const meta = { context: this.context, timerId: id, start: Date.now() };
        this.logger.debug(`Timer started: ${id}`, meta);
    }

    public endTimer(id: string): void {
        const meta = { context: this.context, timerId: id, end: Date.now() };
        this.logger.debug(`Timer ended: ${id}`, meta);
    }

    public logMetric(name: string, value: number, unit: string): void {
        const meta = { context: this.context, metric: name, value, unit };
        this.logger.info(`Metric: ${name}=${value}${unit}`, meta);
    }

    public child(childContext: string): Logger {
        const childLogger = new Logger();
        childLogger.setContext(`${this.context}:${childContext}`);
        return childLogger;
    }

    public flush(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.logger.end(() => resolve());
            } catch (error) {
                reject(error);
            }
        });
    }
}