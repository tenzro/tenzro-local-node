import { EventEmitter } from 'events';
import WebSocket, { Data } from 'ws';
import { NodeAggregator } from './NodeAggregator';
import { TaskManager } from './TaskManager';
import { ResourceManager } from './ResourceManager';
import { HardwareProfiler } from './HardwareProfiler';
import { LocalNetworkManager } from '../network/LocalNetworkManager';
import { DHTNetwork } from '../network/DHTNetwork';
import { Logger } from '../utils/Logger';
import {
    NodeType,
    NodeTier,
    LocalNodeInfo,
    NodeStatus,
    Task,
    TaskType,
    NetworkMessage,
    HardwareProfile,
    AggregationProposal
} from '../types';
import config from '../config';

export class LocalNode extends EventEmitter {
    private logger: Logger;
    private ws: WebSocket | null = null;
    private status: NodeStatus = 'disconnected';
    private nodeInfo: LocalNodeInfo;
    private taskManager: TaskManager;
    private resourceManager: ResourceManager;
    private hardwareProfiler: HardwareProfiler;
    private localNetworkManager: LocalNetworkManager;
    private nodeAggregator: NodeAggregator;
    private dht: DHTNetwork;
    private reconnectAttempts: number = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('LocalNode');

        // Initialize hardware profiler and get initial profile
        this.hardwareProfiler = new HardwareProfiler();
        const hardwareProfile = this.hardwareProfiler.getProfile();

        // Initialize node information
        this.nodeInfo = this.initializeNodeInfo(hardwareProfile);

        // Initialize components
        this.taskManager = new TaskManager(this.nodeInfo);
        this.resourceManager = new ResourceManager(hardwareProfile);
        this.localNetworkManager = new LocalNetworkManager(
            this.nodeInfo,
            config.localNetwork.discoveryPort
        );
        this.nodeAggregator = new NodeAggregator(this.nodeInfo, this.localNetworkManager);
        
        // Initialize DHT network
        this.dht = new DHTNetwork(
            this.nodeInfo.deviceId,
            this.nodeInfo
        );

        this.setupEventListeners();
    }

    private initializeNodeInfo(hardwareProfile: HardwareProfile): LocalNodeInfo {
        const nodeTier = this.determineNodeTier(hardwareProfile);
        return {
            deviceId: config.node.deviceId,
            type: 'individual',
            tier: nodeTier,
            region: config.node.region,
            walletAddress: config.node.walletAddress,
            hardwareProfile,
            capabilities: this.determineCapabilities(hardwareProfile, nodeTier),
            status: 'disconnected',
            aggregatedNodes: [],
            isAggregated: false,
            aggregatorId: null
        };
    }

    private determineNodeTier(profile: HardwareProfile): NodeTier {
        if (profile.gpuInfo && profile.gpuInfo.length > 0) {
            return 'training';
        } else if (profile.cpuCores >= 8 && profile.memoryGB >= 16) {
            return 'aggregator';
        } else if (profile.cpuCores >= 4 && profile.memoryGB >= 8) {
            return 'inference';
        }
        return 'inference';
    }

    private determineCapabilities(profile: HardwareProfile, tier: NodeTier): TaskType[] {
        const capabilities: TaskType[] = ['compute', 'store'];
        
        if (tier === 'training') {
            capabilities.push('train', 'process', 'validate');
        } else if (tier === 'aggregator') {
            capabilities.push('process', 'aggregate', 'validate');
        }
        
        return capabilities;
    }

    private setupEventListeners(): void {
        // Local network events
        this.localNetworkManager.on('peer_discovered', (peer: any) => this.handlePeerDiscovered(peer));
        this.localNetworkManager.on('aggregation_proposed', (proposal: any) => this.handleAggregationProposed(proposal));
        this.localNetworkManager.on('aggregation_completed', (info: any) => this.handleAggregationCompleted(info));

        // Task manager events
        this.taskManager.on('task_completed', (taskId: string, result: any) => this.handleTaskCompleted(taskId, result));
        this.taskManager.on('task_failed', (taskId: string, error: Error) => this.handleTaskFailed(taskId, error));

        // Resource manager events
        this.resourceManager.on('resource_critical', (resourceType: string) => this.handleResourceCritical(resourceType));
        this.resourceManager.on('resource_normalized', () => this.handleResourceNormalized());

        // Hardware profiler events
        this.hardwareProfiler.on('profile_updated', (profile: any) => this.handleProfileUpdated(profile));
    }

    public async start(): Promise<void> {
        try {
            // Start hardware monitoring
            await this.hardwareProfiler.start();

            // Start resource monitoring
            await this.resourceManager.start();

            // Connect to regional node
            await this.connectToRegionalNode();

            // Start local network discovery
            await this.localNetworkManager.start();

            // Start periodic status updates
            this.startHeartbeat();

            this.logger.info('Local node started successfully');

        } catch (error) {
            this.logger.error('Failed to start local node', error as Error);
            throw error;
        }
    }

    private async connectToRegionalNode(): Promise<void> {
        if (!config.network.regionalNode) {
            throw new Error('Regional node URL not configured');
        }

        try {
            this.ws = new WebSocket(config.network.regionalNode);

            this.ws.on('open', () => {
                this.status = 'connected';
                this.reconnectAttempts = 0;
                this.sendNodeInfo();
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });

            this.ws.on('close', () => {
                this.status = 'disconnected';
                this.handleDisconnection();
            });

            this.ws.on('error', (error) => {
                this.logger.error('WebSocket error', error);
                this.handleDisconnection();
            });

        } catch (error) {
            this.logger.error('Failed to connect to regional node', error as Error);
            this.handleDisconnection();
        }
    }

    private async handleMessage(data: Data): Promise<void> {
        try {
            const message: NetworkMessage = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'task_assignment':
                    await this.handleTaskAssignment(message.task as Task);
                    break;
                case 'status_request':
                    await this.sendNodeInfo();
                    break;
                case 'aggregation_request':
                    await this.handleAggregationRequest(message);
                    break;
                default:
                    this.logger.warn(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            this.logger.error('Failed to handle message', error as Error);
        }
    }

    private async handleTaskAssignment(task: Task): Promise<void> {
        try {
            // Check if we're part of an aggregated node
            if (this.nodeInfo.isAggregated && this.nodeInfo.aggregatorId) {
                // Forward task to aggregator
                await this.localNetworkManager.forwardTaskToAggregator(
                    task,
                    this.nodeInfo.aggregatorId
                );
                return;
            }

            // Handle task locally
            await this.taskManager.assignTask(task);
            
            // Send acceptance
            this.sendMessage({
                type: 'task_accepted',
                taskId: task.taskId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error(`Failed to handle task assignment: ${task.taskId}`, error as Error);
            this.sendMessage({
                type: 'task_rejected',
                taskId: task.taskId,
                reason: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            });
        }
    }

    private async handleAggregationProposed(proposal: AggregationProposal): Promise<void> {
        try {
            // Validate the proposal
            if (!this.nodeAggregator.isPeerEligibleForAggregation(proposal.proposerInfo)) {
                await this.nodeAggregator.rejectProposal(proposal);
                return;
            }

            // Process the aggregation proposal
            await this.nodeAggregator.handleAggregationProposal(proposal);
            
        } catch (error) {
            this.logger.error('Failed to handle aggregation proposal', error as Error);
        }
    }

    private handleAggregationRequest(message: NetworkMessage): void {
        if (this.nodeInfo.isAggregated) {
            this.sendMessage({
                type: 'aggregation_rejected',
                reason: 'Already part of an aggregated node',
                timestamp: new Date().toISOString()
            });
            return;
        }

        this.nodeAggregator.handleAggregationRequest(message);
    }

    private async handleAggregationCompleted(aggregatedInfo: LocalNodeInfo): Promise<void> {
        // Update node info with aggregated status
        this.nodeInfo = {
            ...this.nodeInfo,
            ...aggregatedInfo
        };

        // Notify regional node of new capabilities
        await this.sendNodeInfo();
    }

    private async handleDisconnection(): Promise<void> {
        if (this.status === 'reconnecting') return;

        this.status = 'reconnecting';
        
        if (this.reconnectAttempts >= config.network.maxReconnectAttempts) {
            this.logger.error('Max reconnection attempts reached');
            this.emit('connection_failed');
            return;
        }

        this.reconnectAttempts++;
        
        setTimeout(() => {
            this.connectToRegionalNode();
        }, config.network.reconnectInterval);
    }

    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.status === 'connected') {
                this.sendNodeInfo();
            }
        }, config.network.heartbeatInterval);
    }

    private async sendNodeInfo(): Promise<void> {
        const resources = await this.resourceManager.getCurrentUsage();
        const statusMessage: NetworkMessage = {
            type: 'node_status',
            nodeInfo: {
                ...this.nodeInfo,
                resources,
                taskCount: this.taskManager.getActiveTaskCount()
            },
            timestamp: new Date().toISOString()
        };

        this.sendMessage(statusMessage);
    }

    private handleResourceCritical(resourceType: string): void {
        this.logger.warn(`Critical resource usage: ${resourceType}`);
        this.taskManager.pauseTaskAcceptance();
        
        // If part of aggregated node, notify aggregator
        if (this.nodeInfo.isAggregated && this.nodeInfo.aggregatorId) {
            this.localNetworkManager.notifyResourceStatus(
                this.nodeInfo.aggregatorId,
                'critical',
                resourceType
            );
        }
    }

    private handleResourceNormalized(): void {
        this.logger.info('Resource usage normalized');
        this.taskManager.resumeTaskAcceptance();
        
        // If part of aggregated node, notify aggregator
        if (this.nodeInfo.isAggregated && this.nodeInfo.aggregatorId) {
            this.localNetworkManager.notifyResourceStatus(
                this.nodeInfo.aggregatorId,
                'normalized',
                'all'
            );
        }
    }

    private handleProfileUpdated(newProfile: HardwareProfile): void {
        this.nodeInfo.hardwareProfile = newProfile;
        const newTier = this.determineNodeTier(newProfile);
        
        // If tier changed, update capabilities
        if (newTier !== this.nodeInfo.tier) {
            this.nodeInfo.tier = newTier;
            this.nodeInfo.capabilities = this.determineCapabilities(newProfile, newTier);
            this.sendNodeInfo();
        }
    }

    private async handlePeerDiscovered(peerId: string): Promise<void> {
        if (this.nodeInfo.isAggregated) return;

        // Check if peer is eligible for aggregation
        const peerInfo = await this.localNetworkManager.getPeerInfo(peerId);
        if (peerInfo && this.nodeAggregator.isPeerEligibleForAggregation(peerInfo)) {
            await this.nodeAggregator.proposePeerAggregation(peerId);
        }
    }

    private handleTaskCompleted(taskId: string, result: any): void {
        this.sendMessage({
            type: 'task_completed',
            taskId,
            result,
            timestamp: new Date().toISOString()
        });
    }

    private handleTaskFailed(taskId: string, error: Error): void {
        this.sendMessage({
            type: 'task_failed',
            taskId,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }

    private sendMessage(message: NetworkMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                this.logger.error('Failed to send message', error as Error);
            }
        }
    }

    public async stop(): Promise<void> {
        try {
            // Stop all monitoring
            await this.hardwareProfiler.stop();
            await this.resourceManager.stop();
            await this.localNetworkManager.stop();

            // Cancel any active tasks
            await this.taskManager.stop();

            // Clear intervals
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }

            // Close WebSocket connection
            if (this.ws) {
                this.ws.close();
            }

            this.logger.info('Local node stopped');
        } catch (error) {
            this.logger.error('Error stopping local node', error as Error);
            throw error;
        }
    }

    // Public API methods
    public getNodeInfo(): LocalNodeInfo {
        return this.nodeInfo;
    }

    public getStatus(): NodeStatus {
        return this.status;
    }

    public isAggregated(): boolean {
        return this.nodeInfo.isAggregated;
    }

    public getActiveTaskCount(): number {
        return this.taskManager.getActiveTaskCount();
    }

    public getResourceUsage(): Promise<any> {
        return this.resourceManager.getCurrentUsage();
    }
}