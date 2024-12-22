// src/types/index.ts

export type NodeType = 'individual' | 'regional_node' | 'global_node';
export type NodeTier = 'inference' | 'aggregator' | 'training' | 'feedback';
export type TaskType = 'compute' | 'train' | 'process' | 'aggregate' | 'store' | 'validate';
export type NodeStatus = 'connected' | 'disconnected' | 'reconnecting';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'queued' | 'unknown';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ResourceType = 'cpu' | 'memory' | 'gpu' | 'storage';
export type AggregationState = 'none' | 'proposing' | 'considering' | 'joining' | 'aggregated';

export type NetworkMessageType =
    | 'peer_info'
    | 'peer_status'
    | 'aggregation_proposal'
    | 'aggregation_response'
    | 'aggregation_finalized'
    | 'aggregation_rollback'
    | 'aggregation_accepted'
    | 'leave_aggregation'
    | 'aggregation_dissolved'
    | 'task_forward'
    | 'task_result'
    | 'resource_update'
    | 'heartbeat'
    | 'leave'
    | 'store'
    | 'find_value'
    | 'find_value_response'
    | 'node_info'
    | 'node_status'
    | 'announce'
    | 'peer_announcement'
    | 'dht_backup'
    | 'task_assignment'
    | 'status_request'
    | 'aggregation_request'
    | 'task_accepted'
    | 'task_rejected'
    | 'task_completed'
    | 'task_failed'
    | 'aggregation_rejected';

export interface LocalNodeConfig {
    node: {
        type: NodeType;
        tier: NodeTier;
        region: string;
        port: number;
        deviceId: string;
        walletAddress?: string;
    };
    network: {
        regionalNode?: string;
        discoveryInterval: number;
        heartbeatInterval: number;
        reconnectInterval: number;
        maxReconnectAttempts: number;
        peerTimeout: number;
    };
    localNetwork: {
        discoveryPort: number;
        aggregationThreshold: number;
        aggregationTimeout: number;
        minAggregationTier: NodeTier;
    };
    tasks: {
        maxConcurrentTasks: number;
        taskTimeout: number;
        resultRetentionPeriod: number;
    };
    hardware: {
        profileUpdateInterval: number;
        minCPUCores: number;
        minMemoryGB: number;
        minStorageGB: number;
        gpuRequired: boolean;
    };
}

export interface LocalNodeInfo {
    deviceId: string;
    type: NodeType;
    tier: NodeTier;
    region: string;
    walletAddress?: string;
    hardwareProfile: HardwareProfile;
    capabilities: string[];
    status: NodeStatus;
    aggregatedNodes: string[];
    isAggregated: boolean;
    aggregatorId: string | null;
    resources?: ResourceUsage;
    taskCount?: number;
}

export interface HardwareProfile {
    cpuCores: number;
    cpuSpeed: number;
    cpuModel?: string;
    memoryGB: number;
    storageGB: number;
    networkSpeed: number;
    gpuInfo?: GPUInfo[];
    capabilities: HardwareCapabilities;
}

export interface GPUInfo {
    id: string;
    model: string;
    memory: number;
    capabilities: string[];
}

export interface HardwareCapabilities {
    canTrain: boolean;
    canInference: boolean;
    canAggregate: boolean;
    maxBatchSize: number;
    supportedPrecisions: string[];
    maxModelSize: number;
    supportedModels: string[];
}

export interface Task {
    taskId: string;
    type: TaskType;
    priority: TaskPriority;
    requirements: ResourceRequirements;
    data: any;
    status: TaskStatus;
    timestamp: string;
    timeout: number;
}

export interface ResourceRequirements {
    cpu?: number;
    memoryMB?: number;
    gpuCount?: number;
    storageMB?: number;
    minBandwidth?: number;
}

export interface ResourceAllocation {
    id: string;
    resources: {
        cpu: number;
        memoryMB: number;
        gpuCount: number;
        storageMB: number;
    };
    timestamp: string;
}

export interface ResourceUsage {
    cpu: number;
    memory: number;
    gpu: number;
    storage: number;
    timestamp: string;
}

export interface TaskResult {
    taskId: string;
    result: any;
    status: TaskStatus;
    completionTime: Date;
    executionTime: number;
}

export interface BenchmarkResult {
    score: number;
    timestamp: string;
}

export interface TaskExecutionContext {
    taskId: string;
    startTime: Date;
    allocatedResources: ResourceAllocation;
    status: TaskStatus;
    progress: number;
}

export interface AggregationProposal {
    proposerId: string;
    proposerInfo: LocalNodeInfo;
    timestamp: string;
    expiresAt: string;
    participants: LocalNodeInfo[];
}

export interface NetworkMessage {
    type: NetworkMessageType;
    senderId?: string;
    recipientId?: string;
    nodeInfo?: LocalNodeInfo;
    task?: Task;
    taskId?: string;
    error?: string;
    result?: any;
    data?: any;
    timestamp: string;
    key?: string;
    value?: any;
    reason?: string;
    proposal?: AggregationProposal;
    aggregatedInfo?: LocalNodeInfo;
    backup?: {
        values: [string, any][];
        timestamp: string;
    };
    resources?: ResourceUsage;
}

export interface LocalPeerMessage extends NetworkMessage {
    nodeInfo: LocalNodeInfo;
    proposal?: AggregationProposal;
    resourceStatus?: {
        status: string;
        resourceType?: string;
    };
}

// DHT Types
export interface DHTNode {
    id: string;
    info: LocalNodeInfo;
    lastSeen: Date;
}

export interface DHTAnnouncement {
    nodeId: string;
    nodeInfo: LocalNodeInfo;
    capabilities: string[];
    timestamp: string;
}

export interface DHTValue {
    key: string;
    value: any;
    timestamp: string;
    ttl?: number;
}

// Network Types
export interface PeerConnection {
    id: string;
    info: LocalNodeInfo;
    address: string;
    port: number;
    lastSeen: Date;
    status: 'active' | 'inactive';
}

export interface NetworkTopology {
    peers: Map<string, PeerConnection>;
    aggregations: Map<string, string[]>; // aggregatorId -> memberIds
    routes: Map<string, string[]>; // peerId -> path
}

export interface NetworkState {
    topology: NetworkTopology;
    routes: Map<string, NetworkRoute>;
    metrics: NetworkMetrics;
    lastUpdate: Date;
}

export interface NetworkRoute {
    targetId: string;
    path: string[];
    latency: number;
    bandwidth: number;
    lastUpdated: Date;
}

export interface PeerStatus {
    online: boolean;
    aggregated: boolean;
    aggregatorId?: string;
    activeTasks: number;
    resourceUtilization: {
        cpu: number;
        memory: number;
        storage: number;
        gpu?: number;
    };
    lastUpdate: Date;
}

export interface DiscoveryMessage {
    type: 'discovery';
    nodeInfo: LocalNodeInfo;
    timestamp: string;
}

export interface AggregationMessage {
    type: 'aggregation_proposal' | 'aggregation_response';
    proposerId: string;
    participants: LocalNodeInfo[];
    resources: {
        cpu: number;
        memory: number;
        storage: number;
        gpu?: number;
    };
    timestamp: string;
}

export interface ResourceStatusMessage {
    peerId: string;
    resourceType: string;
    utilization: number;
    available: number;
    timestamp: string;
}

export interface NetworkMetrics {
    connectedPeers: number;
    aggregatedGroups: number;
    averageLatency: number;
    messagesSent: number;
    messagesReceived: number;
    bandwidthUsage: number;
    routingTableSize: number;
    lastUpdate: Date;
}

// Constants
export const TASK_TIER_REQUIREMENTS: Record<TaskType, {
    tiers: NodeTier[];
    minReward: number;
    validatorShare: number;
}> = {
    compute: {
        tiers: ['training', 'feedback'],
        minReward: 100,
        validatorShare: 10
    },
    train: {
        tiers: ['training', 'feedback'],
        minReward: 100,
        validatorShare: 10
    },
    process: {
        tiers: ['aggregator', 'training', 'feedback'],
        minReward: 50,
        validatorShare: 10
    },
    aggregate: {
        tiers: ['aggregator', 'training', 'feedback'],
        minReward: 50,
        validatorShare: 10
    },
    store: {
        tiers: ['inference', 'aggregator', 'training', 'feedback'],
        minReward: 20,
        validatorShare: 5
    },
    validate: {
        tiers: ['aggregator', 'training', 'feedback'],
        minReward: 50,
        validatorShare: 10
    }
};