// tenzro-local-node/src/network/DHTNetwork.ts

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
    DHTNode,
    DHTAnnouncement,
    NetworkMessage,
    LocalNodeInfo
} from '../types';
import { Logger } from '../utils/Logger';
import config from '../config';

interface DHTTable {
    localNodes: Map<string, DHTNode>;
    regionalNodes: Map<string, DHTNode>;
    values: Map<string, any>;
}

export class DHTNetwork extends EventEmitter {
    private logger: Logger;
    private dht: DHTTable = {
        localNodes: new Map(),
        regionalNodes: new Map(),
        values: new Map()
    };
    private connections: Map<string, WebSocket> = new Map();
    private updateInterval: NodeJS.Timeout | null = null;
    private backupInterval: NodeJS.Timeout | null = null;

    constructor(
        private nodeId: string,
        private nodeInfo: LocalNodeInfo
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('DHTNetwork');
    }

    public async join(): Promise<void> {
        try {
            // Connect to regional node if configured
            if (config.network.regionalNode) {
                await this.connectToRegionalNode(config.network.regionalNode);
            }

            // Start periodic updates
            this.startPeriodicUpdates();

            // Start data backup
            this.startDataBackup();

            this.logger.info('Joined DHT network');

        } catch (error) {
            this.logger.error('Failed to join DHT network', error as Error);
            throw error;
        }
    }

    public async leave(): Promise<void> {
        try {
            // Clear intervals
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
            }
            if (this.backupInterval) {
                clearInterval(this.backupInterval);
            }

            // Close all connections
            for (const ws of this.connections.values()) {
                ws.close();
            }

            // Clear tables
            this.dht.localNodes.clear();
            this.dht.regionalNodes.clear();
            this.dht.values.clear();
            this.connections.clear();

            this.logger.info('Left DHT network');

        } catch (error) {
            this.logger.error('Failed to leave DHT network', error as Error);
            throw error;
        }
    }

    public async announce(announcement: DHTAnnouncement): Promise<void> {
        const message: NetworkMessage = {
            type: 'announce',
            nodeInfo: this.nodeInfo,
            timestamp: new Date().toISOString()
        };

        // Announce to regional node
        for (const ws of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        }

        // Store announcement locally
        const key = `announcement:${this.nodeId}`;
        await this.store(key, {
            ...announcement,
            timestamp: new Date().toISOString()
        });

        this.logger.info('Announced presence on DHT network');
    }

    private async connectToRegionalNode(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket(url);

                ws.on('open', () => {
                    this.connections.set(url, ws);
                    this.sendNodeInfo(ws);
                    resolve();
                });

                ws.on('message', (data) => {
                    this.handleMessage(ws, data);
                });

                ws.on('close', () => {
                    this.handleDisconnection(url);
                });

                ws.on('error', (error) => {
                    this.logger.error('WebSocket error', error);
                    this.handleDisconnection(url);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    private sendNodeInfo(ws: WebSocket): void {
        const message: NetworkMessage = {
            type: 'node_info',
            nodeInfo: this.nodeInfo,
            timestamp: new Date().toISOString()
        };

        ws.send(JSON.stringify(message));
    }

    private async handleMessage(ws: WebSocket, data: WebSocket.Data): Promise<void> {
        try {
            const message: NetworkMessage = JSON.parse(data.toString());

            switch (message.type) {
                case 'store':
                    await this.handleStore(message);
                    break;
                case 'find_value':
                    await this.handleFindValue(ws, message);
                    break;
                case 'node_info':
                    await this.handleNodeInfo(message);
                    break;
                case 'peer_announcement':
                    await this.handlePeerAnnouncement(message);
                    break;
                default:
                    // Forward other messages to listeners
                    this.emit('message', message);
            }
        } catch (error) {
            this.logger.error('Failed to handle message', error as Error);
        }
    }

    private handleDisconnection(url: string): void {
        this.connections.delete(url);

        // If this was the regional node, try to reconnect
        if (url === config.network.regionalNode) {
            setTimeout(() => {
                this.connectToRegionalNode(url).catch(error => {
                    this.logger.error('Failed to reconnect to regional node', error);
                });
            }, config.network.reconnectInterval);
        }
    }

    public async store(key: string, value: any): Promise<void> {
        // Store locally
        this.dht.values.set(key, value);

        // Replicate to other local nodes
        const message: NetworkMessage = {
            type: 'store',
            key,
            value,
            timestamp: new Date().toISOString()
        };

        // Send to regional node for backup
        for (const ws of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        }
    }

    private async handleStore(message: NetworkMessage): Promise<void> {
        if (!message.key || message.value === undefined) return;
        
        this.dht.values.set(message.key, message.value);
    }

    public async findValue(key: string): Promise<any> {
        // Check local storage
        if (this.dht.values.has(key)) {
            return this.dht.values.get(key);
        }

        // Ask other nodes
        const message: NetworkMessage = {
            type: 'find_value',
            key,
            timestamp: new Date().toISOString()
        };

        const responses = await Promise.all(
            Array.from(this.connections.values())
                .map(ws => this.sendAndWaitForResponse(ws, message))
        );

        // Return first valid response
        for (const response of responses) {
            if (response && response.value !== undefined) {
                // Cache the value locally
                this.dht.values.set(key, response.value);
                return response.value;
            }
        }

        return null;
    }

    private async handleFindValue(ws: WebSocket, message: NetworkMessage): Promise<void> {
        if (!message.key) return;

        const value = this.dht.values.get(message.key);
        const response: NetworkMessage = {
            type: 'find_value_response',
            key: message.key,
            value,
            timestamp: new Date().toISOString()
        };

        ws.send(JSON.stringify(response));
    }

    private async handleNodeInfo(message: NetworkMessage): Promise<void> {
        if (!message.nodeInfo) return;

        const node: DHTNode = {
            id: message.nodeInfo.deviceId,
            info: message.nodeInfo,
            lastSeen: new Date()
        };

        if (message.nodeInfo.type === 'regional_node') {
            this.dht.regionalNodes.set(node.id, node);
        } else {
            this.dht.localNodes.set(node.id, node);
        }
    }

    private async handlePeerAnnouncement(message: NetworkMessage): Promise<void> {
        if (!message.nodeInfo) return;

        // Only process announcements from local nodes
        if (message.nodeInfo.type === 'individual') {
            const node: DHTNode = {
                id: message.nodeInfo.deviceId,
                info: message.nodeInfo,
                lastSeen: new Date()
            };

            this.dht.localNodes.set(node.id, node);
            this.emit('peer_discovered', node);
        }
    }

    private startPeriodicUpdates(): void {
        this.updateInterval = setInterval(() => {
            const ws = this.connections.values().next().value;
            if (ws) {
                this.sendNodeInfo(ws);
            }
            this.cleanupStaleNodes();
        }, config.network.heartbeatInterval);
    }

    private startDataBackup(): void {
        this.backupInterval = setInterval(() => {
            this.backupDHTData();
        }, 300000); // Every 5 minutes
    }

    private cleanupStaleNodes(): void {
        const now = Date.now();
        const staleThreshold = config.network.peerTimeout;

        // Cleanup local nodes
        for (const [id, node] of this.dht.localNodes) {
            if (now - node.lastSeen.getTime() > staleThreshold) {
                this.dht.localNodes.delete(id);
            }
        }

        // Cleanup regional nodes
        for (const [id, node] of this.dht.regionalNodes) {
            if (now - node.lastSeen.getTime() > staleThreshold) {
                this.dht.regionalNodes.delete(id);
            }
        }
    }

    private async backupDHTData(): Promise<void> {
        try {
            const backup = {
                values: Array.from(this.dht.values.entries()),
                timestamp: new Date().toISOString()
            };

            // Send backup to regional node
            const message: NetworkMessage = {
                type: 'dht_backup',
                backup,
                timestamp: new Date().toISOString()
            };

            for (const ws of this.connections.values()) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            }

        } catch (error) {
            this.logger.error('Failed to backup DHT data', error as Error);
        }
    }

    private async sendAndWaitForResponse(
        ws: WebSocket,
        message: NetworkMessage,
        timeout: number = 5000
    ): Promise<NetworkMessage | null> {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => resolve(null), timeout);

            const handleResponse = (data: WebSocket.Data) => {
                const response: NetworkMessage = JSON.parse(data.toString());
                if (response.key === message.key) {
                    clearTimeout(timeoutId);
                    ws.removeListener('message', handleResponse);
                    resolve(response);
                }
            };

            ws.on('message', handleResponse);
            ws.send(JSON.stringify(message));
        });
    }

    // Public methods for network state
    public getLocalNodes(): DHTNode[] {
        return Array.from(this.dht.localNodes.values());
    }

    public getRegionalNodes(): DHTNode[] {
        return Array.from(this.dht.regionalNodes.values());
    }

    public isConnected(): boolean {
        return this.connections.size > 0;
    }

    public getStoredKeys(): string[] {
        return Array.from(this.dht.values.keys());
    }

    public getDiagnostics(): {
        localNodes: number;
        regionalNodes: number;
        storedValues: number;
        connections: number;
    } {
        return {
            localNodes: this.dht.localNodes.size,
            regionalNodes: this.dht.regionalNodes.size,
            storedValues: this.dht.values.size,
            connections: this.connections.size
        };
    }
}