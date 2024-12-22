// tenzro-local-node/src/network/LocalNetworkManager.ts

import { EventEmitter } from 'events';
import dgram from 'dgram';
import WebSocket, { WebSocketServer } from 'ws';
import { Logger } from '../utils/Logger';
import {
    LocalNodeInfo,
    Task,
    NetworkMessage,
    PeerConnection,
    NetworkState,
    NetworkTopology,
    NetworkMetrics,
    PeerStatus,
    DiscoveryMessage,
    AggregationMessage,
    ResourceStatusMessage
} from '../types';
import config from '../config';

export class LocalNetworkManager extends EventEmitter {
    forwardTaskToAggregator(task: Task, aggregatorId: string) {
        throw new Error('Method not implemented.');
    }
    notifyResourceStatus(aggregatorId: string, arg1: string, resourceType: string) {
        throw new Error('Method not implemented.');
    }
    private logger: Logger;
    private wss: WebSocketServer | null = null;
    private discoverySocket: dgram.Socket | null = null;
    private connections: Map<string, WebSocket> = new Map();
    private peers: Map<string, PeerConnection> = new Map();
    private networkState: NetworkState;
    private topology: NetworkTopology;
    private metrics: NetworkMetrics;
    private discoveryInterval: NodeJS.Timeout | null = null;
    private metricsInterval: NodeJS.Timeout | null = null;

    constructor(
        private nodeInfo: LocalNodeInfo,
        private port: number = config.localNetwork.discoveryPort
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('LocalNetworkManager');

        // Initialize network state
        this.topology = {
            peers: new Map(),
            aggregations: new Map(),
            routes: new Map()
        };

        this.metrics = {
            connectedPeers: 0,
            aggregatedGroups: 0,
            averageLatency: 0,
            messagesSent: 0,
            messagesReceived: 0,
            bandwidthUsage: 0,
            routingTableSize: 0,
            lastUpdate: new Date()
        };

        this.networkState = {
            topology: this.topology,
            routes: new Map(),
            metrics: this.metrics,
            lastUpdate: new Date()
        };
    }

    public async start(): Promise<void> {
        try {
            // Start WebSocket server for peer connections
            await this.startWebSocketServer();

            // Start UDP discovery service
            await this.startDiscoveryService();

            // Start periodic tasks
            this.startPeriodicTasks();

            this.logger.info('Local network manager started successfully');

        } catch (error) {
            this.logger.error('Failed to start local network manager', error as Error);
            throw error;
        }
    }

    private async startWebSocketServer(): Promise<void> {
        this.wss = new WebSocket.Server({ port: this.port });

        this.wss.on('connection', (ws: WebSocket) => {
            this.handleNewConnection(ws);
        });

        this.wss.on('error', (error: Error) => {
            this.logger.error('WebSocket server error', error);
        });
    }

    private async startDiscoveryService(): Promise<void> {
        this.discoverySocket = dgram.createSocket('udp4');

        this.discoverySocket.on('message', (message, rinfo) => {
            this.handleDiscoveryMessage(message, rinfo);
        });

        this.discoverySocket.on('error', (error) => {
            this.logger.error('Discovery socket error', error);
        });

        // Bind to discovery port
        await new Promise<void>((resolve, reject) => {
            this.discoverySocket?.bind(this.port + 1, () => {
                this.discoverySocket?.setBroadcast(true);
                resolve();
            });
        });

        // Start broadcasting presence
        this.discoveryInterval = setInterval(() => {
            this.broadcastDiscoveryMessage();
        }, config.network.discoveryInterval);
    }

    private handleNewConnection(ws: WebSocket): void {
        let peerId: string | null = null;

        ws.on('message', async (data: WebSocket.Data) => {
            try {
                const message: NetworkMessage = JSON.parse(data.toString());
                await this.handleMessage(ws, message);
                
                // Set peerId on first message if not set
                if (!peerId && message.senderId) {
                    peerId = message.senderId as unknown as string;
                    if (peerId) {
                        this.connections.set(peerId, ws);
                    }
                }
            } catch (error) {
                this.logger.error('Failed to handle WebSocket message', error as Error);
            }
        });

        ws.on('close', () => {
            if (peerId) {
                this.handlePeerDisconnection(peerId);
            }
        });

        ws.on('error', (error) => {
            this.logger.error('WebSocket connection error', error);
        });
    }

    private async handleMessage(ws: WebSocket, message: NetworkMessage): Promise<void> {
        this.metrics.messagesReceived++;

        switch (message.type) {
            case 'peer_info':
                await this.handlePeerInfo(message);
                break;
            case 'peer_status':
                await this.handlePeerStatus(message);
                break;
            case 'aggregation_proposal':
                await this.handleAggregationProposal(message);
                break;
            case 'aggregation_response':
                await this.handleAggregationResponse(message);
                break;
            case 'task_forward':
                await this.handleTaskForward(message);
                break;
            case 'resource_update':
                await this.handleResourceUpdate(message);
                break;
            case 'leave':
                await this.handlePeerLeave(message);
                break;
        }
    }

    private handleDiscoveryMessage(message: Buffer, rinfo: dgram.RemoteInfo): void {
        try {
            const discovery: DiscoveryMessage = JSON.parse(message.toString());
            
            // Add to peer list if not already known
            if (!this.peers.has(discovery.nodeInfo.deviceId)) {
                const peer: PeerConnection = {
                    id: discovery.nodeInfo.deviceId,
                    info: discovery.nodeInfo,
                    address: rinfo.address,
                    port: rinfo.port,
                    lastSeen: new Date(),
                    status: 'active'
                };

                this.peers.set(peer.id, peer);
                this.emit('peer_discovered', discovery.nodeInfo);

                // Try to establish WebSocket connection
                this.connectToPeer(peer);
            }
        } catch (error) {
            this.logger.error('Failed to handle discovery message', error as Error);
        }
    }

    private async connectToPeer(peer: PeerConnection): Promise<void> {
        if (this.connections.has(peer.id)) return;

        try {
            const ws = new WebSocket(`ws://${peer.address}:${peer.port}`);

            ws.on('open', () => {
                this.connections.set(peer.id, ws);
                this.sendPeerInfo(ws);
                this.updateNetworkMetrics();
            });

            ws.on('message', async (data) => {
                const message: NetworkMessage = JSON.parse(data.toString());
                await this.handleMessage(ws, message);
            });

            ws.on('close', () => {
                this.handlePeerDisconnection(peer.id);
            });

            ws.on('error', (error) => {
                this.logger.error(`WebSocket error with peer ${peer.id}`, error);
            });

        } catch (error) {
            this.logger.error(`Failed to connect to peer ${peer.id}`, error as Error);
        }
    }

    private sendPeerInfo(ws: WebSocket): void {
        const message: NetworkMessage = {
            type: 'peer_info',
            senderId: this.nodeInfo.deviceId,
            data: this.nodeInfo,
            timestamp: new Date().toISOString()
        };

        this.sendMessage(ws, message);
    }

    private async handlePeerInfo(message: NetworkMessage): Promise<void> {
        const peerInfo = message.data as LocalNodeInfo;
        
        const peer: PeerConnection = {
            id: peerInfo.deviceId,
            info: peerInfo,
            address: '', // Will be updated from connection
            port: 0,    // Will be updated from connection
            lastSeen: new Date(),
            status: 'active'
        };

        this.peers.set(peer.id, peer);
        this.updateTopology();
    }

    private async handlePeerStatus(message: NetworkMessage): Promise<void> {
        const status = message.data as PeerStatus;
        const peer = message.senderId ? this.peers.get(message.senderId) : undefined;
        
        if (peer) {
            peer.lastSeen = new Date();
            peer.status = status.online ? 'active' : 'inactive';
            
            // Update aggregation information
            if (status.aggregated && status.aggregatorId) {
                if (message.senderId && status.aggregatorId) {
                    this.updateAggregation(message.senderId, status.aggregatorId);
                }
            }

            this.updateTopology();
        }
    }

    private async handleAggregationProposal(message: NetworkMessage): Promise<void> {
        const proposal = message.data as AggregationMessage;
        this.emit('aggregation_proposed', proposal);
    }

    private async handleAggregationResponse(message: NetworkMessage): Promise<void> {
        const response = message.data as AggregationMessage;
        this.emit('aggregation_response', response);
    }

    private async handleTaskForward(message: NetworkMessage): Promise<void> {
        const task = message.data as Task;
        this.emit('task_forwarded', task);
    }

    private async handleResourceUpdate(message: NetworkMessage): Promise<void> {
        const status = message.data as ResourceStatusMessage;
        this.emit('resource_status', status);
    }

    private handlePeerDisconnection(peerId: string): void {
        // Remove from connections
        this.connections.delete(peerId);

        // Update peer status
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.status = 'inactive';
            peer.lastSeen = new Date();
        }

        // Update topology
        this.updateTopology();
        this.updateNetworkMetrics();

        // Emit event
        this.emit('peer_left', peerId);
    }

    private async handlePeerLeave(message: NetworkMessage): Promise<void> {
        if (message.senderId) {
            await this.handlePeerDisconnection(message.senderId);
        }
    }

    private broadcastDiscoveryMessage(): void {
        if (!this.discoverySocket) return;

        const message: DiscoveryMessage = {
            type: 'discovery',
            nodeInfo: this.nodeInfo,
            timestamp: new Date().toISOString()
        };

        const buffer = Buffer.from(JSON.stringify(message));
        this.discoverySocket.send(
            buffer,
            0,
            buffer.length,
            this.port + 1,
            '255.255.255.255'
        );
    }

    private startPeriodicTasks(): void {
        // Start discovery broadcasts
        this.discoveryInterval = setInterval(() => {
            this.broadcastDiscoveryMessage();
        }, config.network.discoveryInterval);

        // Start metrics updates
        this.metricsInterval = setInterval(() => {
            this.updateNetworkMetrics();
        }, config.network.heartbeatInterval);
    }

    private updateTopology(): void {
        // Update aggregations
        const newAggregations = new Map<string, string[]>();
        
        for (const [peerId, peer] of this.peers) {
            if (peer.info.isAggregated && peer.info.aggregatorId) {
                const members = newAggregations.get(peer.info.aggregatorId) || [];
                members.push(peerId);
                newAggregations.set(peer.info.aggregatorId, members);
            }
        }

        this.topology.aggregations = newAggregations;

        // Update routing table
        this.updateRoutingTable();

        // Update network state
        this.networkState.topology = this.topology;
        this.networkState.lastUpdate = new Date();
    }

    private updateRoutingTable(): void {
        // Simple routing table update - direct connections only
        const routes = new Map<string, string[]>();
        
        for (const peerId of this.connections.keys()) {
            routes.set(peerId, [peerId]);
        }

        this.topology.routes = routes;
    }

    private updateNetworkMetrics(): void {
        this.metrics.connectedPeers = this.connections.size;
        this.metrics.aggregatedGroups = this.topology.aggregations.size;
        this.metrics.routingTableSize = this.topology.routes.size;
        this.metrics.lastUpdate = new Date();

        // Calculate average latency (placeholder implementation)
        // In a real implementation, you would measure actual network latency
        this.metrics.averageLatency = 0;
        let measureCount = 0;

        for (const peer of this.peers.values()) {
            if (peer.status === 'active') {
                const latency = Date.now() - peer.lastSeen.getTime();
                this.metrics.averageLatency += latency;
                measureCount++;
            }
        }

        if (measureCount > 0) {
            this.metrics.averageLatency /= measureCount;
        }

        this.networkState.metrics = this.metrics;
    }

    private updateAggregation(peerId: string, aggregatorId: string): void {
        const members = this.topology.aggregations.get(aggregatorId) || [];
        if (!members.includes(peerId)) {
            members.push(peerId);
            this.topology.aggregations.set(aggregatorId, members);
        }
    }

    private sendMessage(ws: WebSocket, message: NetworkMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            this.metrics.messagesSent++;
        }
    }

    public async broadcast(message: NetworkMessage): Promise<void> {
        for (const ws of this.connections.values()) {
            this.sendMessage(ws, message);
        }
    }

    public async sendToPeer(peerId: string, message: NetworkMessage): Promise<void> {
        const ws = this.connections.get(peerId);
        if (!ws) {
            throw new Error(`No connection to peer ${peerId}`);
        }
        this.sendMessage(ws, message);
    }

    public async stop(): Promise<void> {
        // Clear intervals
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
        }
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }

        // Close all connections
        for (const ws of this.connections.values()) {
            ws.close();
        }

        // Close discovery socket
        if (this.discoverySocket) {
            this.discoverySocket.close();
        }

        // Close WebSocket server
        if (this.wss) {
            await new Promise<void>((resolve, reject) => {
                this.wss?.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        this.logger.info('Local network manager stopped');
    }

    // Public API methods
    public getNetworkState(): NetworkState {
        return this.networkState;
    }

    public getPeerInfo(peerId: string): LocalNodeInfo | undefined {
        return this.peers.get(peerId)?.info;
    }

    public getConnectedPeers(): string[] {
        return Array.from(this.connections.keys());
    }

    public getPeerCount(): number {
        return this.connections.size;
    }

    public getAggregatedGroups(): Map<string, string[]> {
        return new Map(this.topology.aggregations);
    }
}