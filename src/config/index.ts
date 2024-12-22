// tenzro-local-node/src/config/index.ts

import dotenv from 'dotenv';
import path from 'path';
import { NodeType, NodeTier, LocalNodeConfig } from '../types';

// Load environment variables
dotenv.config();

export const config: LocalNodeConfig = {
    node: {
        type: (process.env.NODE_TYPE || 'individual') as NodeType,
        tier: (process.env.NODE_TIER || 'inference') as NodeTier,
        region: process.env.REGION || 'default',
        port: parseInt(process.env.PORT || '8080'),
        deviceId: process.env.DEVICE_ID || `node_${Math.random().toString(36).substr(2, 9)}`,
        walletAddress: process.env.WALLET_ADDRESS,
    },
    network: {
        regionalNode: process.env.REGIONAL_NODE_URL,
        discoveryInterval: parseInt(process.env.DISCOVERY_INTERVAL || '30000'),
        heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '15000'),
        reconnectInterval: parseInt(process.env.RECONNECT_INTERVAL || '5000'),
        maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '5'),
        peerTimeout: 0
    },
    localNetwork: {
        discoveryPort: parseInt(process.env.LOCAL_DISCOVERY_PORT || '8081'),
        aggregationThreshold: parseInt(process.env.AGGREGATION_THRESHOLD || '3'),
        aggregationTimeout: parseInt(process.env.AGGREGATION_TIMEOUT || '60000'),
        minAggregationTier: (process.env.MIN_AGGREGATION_TIER || 'aggregator') as NodeTier,
    },
    tasks: {
        maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '5'),
        taskTimeout: parseInt(process.env.TASK_TIMEOUT || '3600'),
        resultRetentionPeriod: parseInt(process.env.RESULT_RETENTION_PERIOD || '86400'),
    },
    hardware: {
        profileUpdateInterval: parseInt(process.env.PROFILE_UPDATE_INTERVAL || '300000'),
        minCPUCores: parseInt(process.env.MIN_CPU_CORES || '2'),
        minMemoryGB: parseInt(process.env.MIN_MEMORY_GB || '4'),
        minStorageGB: parseInt(process.env.MIN_STORAGE_GB || '20'),
        gpuRequired: process.env.GPU_REQUIRED === 'true',
    }
};

// Export specific configuration getters
export function getNodeConfig() {
    return config.node;
}

export function getNetworkConfig() {
    return config.network;
}

export function getLocalNetworkConfig() {
    return config.localNetwork;
}

export function getTaskConfig() {
    return config.tasks;
}

export function getHardwareConfig() {
    return config.hardware;
}

export default config;