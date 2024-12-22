// tenzro-local-node/src/types/task.ts

import { NodeTier } from './index';

export type TaskType = 
    | 'compute'
    | 'train'
    | 'process'
    | 'aggregate'
    | 'store'
    | 'validate';

export type TaskStatus = 
    | 'pending'
    | 'assigned'
    | 'running'
    | 'completed'
    | 'failed';

export type TaskPriority = 
    | 'low'
    | 'medium'
    | 'high'
    | 'critical';

export interface Task {
    taskId: string;
    type: TaskType;
    priority: TaskPriority;
    requirements: TaskRequirements;
    data: any;
    config?: TaskConfig;
    status: TaskExecutionStatus;
    timestamp: string;
    timeout: number;
}

export interface TaskRequirements {
    minTier: NodeTier;
    cpu?: number;     // Percentage of CPU cores required (0-100)
    memoryMB?: number; // Memory required in MB
    storageMB?: number; // Storage required in MB
    gpuRequired?: boolean;
    minBandwidth?: number; // Minimum bandwidth required in Mbps
    maxLatency?: number;   // Maximum acceptable latency in ms
    deadline?: number;     // Task deadline in ms
}

export interface TaskConfig {
    retryCount?: number;
    maxRetries?: number;
    backoffMultiplier?: number;
    checkpointInterval?: number;
    validationRules?: TaskValidationRule[];
    aggregationStrategy?: 'average' | 'sum' | 'majority' | 'custom';
    customConfig?: Record<string, any>;
}

export interface TaskExecutionStatus {
    state: TaskStatus;
    progress: number;
    startTime?: string;
    endTime?: string;
    error?: TaskError;
    metrics: TaskMetrics;
    assignedNodes: string[];
    result?: any;
}

export interface TaskError {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retriable: boolean;
}

export interface TaskMetrics {
    cpuUsage: number;
    memoryUsage: number;
    storageUsage: number;
    networkUsage: number;
    executionTime: number;
    checkpoints: TaskCheckpoint[];
}

export interface TaskCheckpoint {
    id: string;
    timestamp: string;
    progress: number;
    data: any;
}

export interface TaskValidationRule {
    type: 'range' | 'threshold' | 'pattern' | 'custom';
    parameter: string;
    condition: any;
    errorMessage: string;
}

export interface TaskResult {
    taskId: string;
    success: boolean;
    result: any;
    metrics: TaskMetrics;
    validationResults?: TaskValidationResult[];
    timestamp: string;
}

export interface TaskValidationResult {
    rule: TaskValidationRule;
    passed: boolean;
    value: any;
    message?: string;
}

export interface SubTask extends Task {
    parentTaskId: string;
    subTaskIndex: number;
    aggregationWeight?: number;
}

export interface AggregatedTaskResult {
    taskId: string;
    subResults: TaskResult[];
    aggregatedResult: any;
    metrics: {
        totalExecutionTime: number;
        averageExecutionTime: number;
        successRate: number;
        resourceUtilization: {
            cpu: number;
            memory: number;
            storage: number;
            network: number;
        };
    };
    timestamp: string;
}

export interface TaskHistory {
    taskId: string;
    type: TaskType;
    priority: TaskPriority;
    startTime: string;
    endTime?: string;
    status: TaskStatus;
    executionTime: number;
    resourceUsage: {
        cpu: number;
        memory: number;
        storage: number;
        network: number;
    };
    error?: TaskError;
}

export interface TaskQueue {
    high: Task[];
    medium: Task[];
    low: Task[];
    getNext(): Task | undefined;
    add(task: Task): void;
    remove(taskId: string): Task | undefined;
    size(): number;
}

// Task type-specific interfaces
export interface ComputeTask extends Task {
    type: 'compute';
    data: {
        input: any;
        operations: string[];
        parameters: Record<string, any>;
    };
}

export interface TrainingTask extends Task {
    type: 'train';
    data: {
        model: any;
        dataset: any;
        hyperparameters: Record<string, any>;
        validationData?: any;
    };
}

export interface ProcessingTask extends Task {
    type: 'process';
    data: {
        input: any;
        transformations: string[];
        parameters: Record<string, any>;
    };
}

export interface AggregationTask extends Task {
    type: 'aggregate';
    data: {
        inputs: any[];
        strategy: string;
        parameters: Record<string, any>;
    };
}

export interface StorageTask extends Task {
    type: 'store';
    data: {
        content: any;
        retention: number;
        replicas: number;
    };
}