// src/types/network.ts

import { Task, LocalNodeInfo, ResourceUsage } from './index';

export type NetworkEventType = 
    | 'peer_discovered'
    | 'peer_left'
    | 'aggregation_proposed'
    | 'aggregation_accepted'
    | 'aggregation_rejected'
    | 'aggregation_completed'
    | 'task_received'
    | 'task_forwarded'
    | 'resource_status';

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
    | 'dht_backup';

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

export interface NetworkRoute {
    targetId: string;
    path: string[];
    latency: number;
    bandwidth: number;
    lastUpdated: Date;
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

export interface NetworkState {
    topology: NetworkTopology;
    routes: Map<string, NetworkRoute>;
    metrics: NetworkMetrics;
    lastUpdate: Date;
}

export interface AggregationProposal {
    proposerId: string;
    proposerInfo: LocalNodeInfo;
    timestamp: string;
    expiresAt: string;
    participants: LocalNodeInfo[];
}

export type PeerFilter = (peer: PeerConnection) => boolean;