// tenzro-local-node/src/core/ResourceManager.ts

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import {
    HardwareProfile,
    ResourceRequirements,
    ResourceAllocation,
    ResourceUsage,
    ResourceType
} from '../types';
import config from '../config';

interface ResourcePool {
    cpu: {
        total: number;
        available: number;
        allocated: Map<string, number>;
    };
    memory: {
        total: number;
        available: number;
        allocated: Map<string, number>;
    };
    gpu: {
        total: number;
        available: number;
        allocated: Map<string, number>;
    };
    storage: {
        total: number;
        available: number;
        allocated: Map<string, number>;
    };
}

export class ResourceManager extends EventEmitter {
    private logger: Logger;
    private resources: ResourcePool;
    private usageMonitorInterval: NodeJS.Timeout | null = null;
    private readonly CRITICAL_THRESHOLD = 0.9; // 90%
    private readonly WARNING_THRESHOLD = 0.8; // 80%

    constructor(private hardwareProfile: HardwareProfile) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('ResourceManager');

        // Initialize resource pool
        this.resources = this.initializeResourcePool(hardwareProfile);
    }

    private initializeResourcePool(profile: HardwareProfile): ResourcePool {
        return {
            cpu: {
                total: profile.cpuCores * profile.cpuSpeed,
                available: profile.cpuCores * profile.cpuSpeed,
                allocated: new Map()
            },
            memory: {
                total: profile.memoryGB * 1024, // Convert to MB
                available: profile.memoryGB * 1024,
                allocated: new Map()
            },
            gpu: {
                total: profile.gpuInfo ? profile.gpuInfo.length : 0,
                available: profile.gpuInfo ? profile.gpuInfo.length : 0,
                allocated: new Map()
            },
            storage: {
                total: profile.storageGB * 1024, // Convert to MB
                available: profile.storageGB * 1024,
                allocated: new Map()
            }
        };
    }

    public async start(): Promise<void> {
        // Start resource usage monitoring
        this.usageMonitorInterval = setInterval(
            () => this.monitorResourceUsage(),
            5000 // Check every 5 seconds
        );
    }

    public async stop(): Promise<void> {
        if (this.usageMonitorInterval) {
            clearInterval(this.usageMonitorInterval);
        }
    }

    public canAllocateResources(requirements: ResourceRequirements): boolean {
        return (
            (!requirements.cpu || this.resources.cpu.available >= requirements.cpu) &&
            (!requirements.memoryMB || this.resources.memory.available >= requirements.memoryMB) &&
            (!requirements.gpuCount || this.resources.gpu.available >= requirements.gpuCount) &&
            (!requirements.storageMB || this.resources.storage.available >= requirements.storageMB)
        );
    }

    public async allocateResources(
        requirements: ResourceRequirements
    ): Promise<ResourceAllocation> {
        if (!this.canAllocateResources(requirements)) {
            throw new Error('Insufficient resources');
        }

        const allocationId = `alloc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            // Allocate CPU
            if (requirements.cpu) {
                this.resources.cpu.allocated.set(allocationId, requirements.cpu);
                this.resources.cpu.available -= requirements.cpu;
            }

            // Allocate Memory
            if (requirements.memoryMB) {
                this.resources.memory.allocated.set(allocationId, requirements.memoryMB);
                this.resources.memory.available -= requirements.memoryMB;
            }

            // Allocate GPU
            if (requirements.gpuCount) {
                this.resources.gpu.allocated.set(allocationId, requirements.gpuCount);
                this.resources.gpu.available -= requirements.gpuCount;
            }

            // Allocate Storage
            if (requirements.storageMB) {
                this.resources.storage.allocated.set(allocationId, requirements.storageMB);
                this.resources.storage.available -= requirements.storageMB;
            }

            const allocation: ResourceAllocation = {
                id: allocationId,
                resources: {
                    cpu: requirements.cpu || 0,
                    memoryMB: requirements.memoryMB || 0,
                    gpuCount: requirements.gpuCount || 0,
                    storageMB: requirements.storageMB || 0
                },
                timestamp: new Date().toISOString()
            };

            return allocation;

        } catch (error) {
            // Rollback any allocations if there's an error
            this.rollbackAllocation(allocationId);
            throw error;
        }
    }

    public async releaseResources(allocation: ResourceAllocation): Promise<void> {
        const { id, resources } = allocation;

        // Release CPU
        if (resources.cpu) {
            this.resources.cpu.available += resources.cpu;
            this.resources.cpu.allocated.delete(id);
        }

        // Release Memory
        if (resources.memoryMB) {
            this.resources.memory.available += resources.memoryMB;
            this.resources.memory.allocated.delete(id);
        }

        // Release GPU
        if (resources.gpuCount) {
            this.resources.gpu.available += resources.gpuCount;
            this.resources.gpu.allocated.delete(id);
        }

        // Release Storage
        if (resources.storageMB) {
            this.resources.storage.available += resources.storageMB;
            this.resources.storage.allocated.delete(id);
        }
    }

    private rollbackAllocation(allocationId: string): void {
        // Rollback CPU allocation
        const cpuAllocation = this.resources.cpu.allocated.get(allocationId);
        if (cpuAllocation) {
            this.resources.cpu.available += cpuAllocation;
            this.resources.cpu.allocated.delete(allocationId);
        }

        // Rollback Memory allocation
        const memoryAllocation = this.resources.memory.allocated.get(allocationId);
        if (memoryAllocation) {
            this.resources.memory.available += memoryAllocation;
            this.resources.memory.allocated.delete(allocationId);
        }

        // Rollback GPU allocation
        const gpuAllocation = this.resources.gpu.allocated.get(allocationId);
        if (gpuAllocation) {
            this.resources.gpu.available += gpuAllocation;
            this.resources.gpu.allocated.delete(allocationId);
        }

        // Rollback Storage allocation
        const storageAllocation = this.resources.storage.allocated.get(allocationId);
        if (storageAllocation) {
            this.resources.storage.available += storageAllocation;
            this.resources.storage.allocated.delete(allocationId);
        }
    }

    private async monitorResourceUsage(): Promise<void> {
        const usage = await this.getCurrentUsage();
        
        // Check for critical resource usage
        for (const [resourceType, percentage] of Object.entries(usage)) {
            if (percentage >= this.CRITICAL_THRESHOLD) {
                this.emit('resource_critical', resourceType);
            } else if (percentage >= this.WARNING_THRESHOLD) {
                this.emit('resource_warning', resourceType);
            }
        }

        // If all resources are below warning threshold, emit normalized event
        const allNormalized = Object.values(usage).every(
            percentage => percentage < this.WARNING_THRESHOLD
        );

        if (allNormalized) {
            this.emit('resource_normalized');
        }
    }

    public async getCurrentUsage(): Promise<ResourceUsage> {
        const calculateUsage = (resource: ResourcePool[keyof ResourcePool]) => 
            1 - (resource.available / resource.total);

        return {
            cpu: calculateUsage(this.resources.cpu),
            memory: calculateUsage(this.resources.memory),
            gpu: calculateUsage(this.resources.gpu),
            storage: calculateUsage(this.resources.storage),
            timestamp: new Date().toISOString()
        };
    }

    public async getResourceAvailability(): Promise<Record<ResourceType, number>> {
        return {
            cpu: this.resources.cpu.available,
            memory: this.resources.memory.available,
            gpu: this.resources.gpu.available,
            storage: this.resources.storage.available
        };
    }

    public getTotalResources(): Record<ResourceType, number> {
        return {
            cpu: this.resources.cpu.total,
            memory: this.resources.memory.total,
            gpu: this.resources.gpu.total,
            storage: this.resources.storage.total
        };
    }

    public getResourceUtilization(): Record<ResourceType, number> {
        const calculateUtilization = (resource: ResourcePool[keyof ResourcePool]) => 
            ((resource.total - resource.available) / resource.total) * 100;

        return {
            cpu: calculateUtilization(this.resources.cpu),
            memory: calculateUtilization(this.resources.memory),
            gpu: calculateUtilization(this.resources.gpu),
            storage: calculateUtilization(this.resources.storage)
        };
    }

    public async scaleResources(scaleFactor: number): Promise<void> {
        // Scale up/down resources (used when node is part of aggregation)
        this.resources.cpu.total *= scaleFactor;
        this.resources.cpu.available = this.resources.cpu.total - 
            Array.from(this.resources.cpu.allocated.values()).reduce((sum, val) => sum + val, 0);

        this.resources.memory.total *= scaleFactor;
        this.resources.memory.available = this.resources.memory.total -
            Array.from(this.resources.memory.allocated.values()).reduce((sum, val) => sum + val, 0);

        this.resources.gpu.total *= scaleFactor;
        this.resources.gpu.available = this.resources.gpu.total -
            Array.from(this.resources.gpu.allocated.values()).reduce((sum, val) => sum + val, 0);

        this.resources.storage.total *= scaleFactor;
        this.resources.storage.available = this.resources.storage.total -
            Array.from(this.resources.storage.allocated.values()).reduce((sum, val) => sum + val, 0);
    }

    public async reserveResources(requirements: ResourceRequirements): Promise<boolean> {
        // Try to reserve resources without actually allocating them
        return this.canAllocateResources(requirements);
    }

    public getResourceProfile(): HardwareProfile {
        return this.hardwareProfile;
    }
}