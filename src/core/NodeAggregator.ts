// tenzro-local-node/src/core/NodeAggregator.ts

import { EventEmitter } from 'events';
import { LocalNetworkManager } from '../network/LocalNetworkManager';
import { Logger } from '../utils/Logger';
import {
    LocalNodeInfo,
    NetworkMessage,
    NodeTier,
    HardwareProfile,
    AggregationState,
    AggregationProposal,
    LocalPeerMessage,
    HardwareCapabilities,
    NetworkMessageType
} from '../types';
import config from '../config';

export class NodeAggregator extends EventEmitter {
    [x: string]: any;
    handleAggregationRequest(message: NetworkMessage) {
        throw new Error('Method not implemented.');
    }
    private logger: Logger;
    private aggregationState: AggregationState = 'none';
    private activeProposals: Map<string, AggregationProposal> = new Map();
    private aggregatedNodes: Map<string, LocalNodeInfo> = new Map();

    constructor(
        private nodeInfo: LocalNodeInfo,
        private networkManager: LocalNetworkManager
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('NodeAggregator');
    }

    public async proposePeerAggregation(peerId: string): Promise<void> {
        if (this.aggregationState !== 'none') {
            return;
        }

        try {
            const proposal: AggregationProposal = {
                proposerId: this.nodeInfo.deviceId,
                proposerInfo: this.nodeInfo,
                timestamp: new Date().toISOString(),
                expiresAt: new Date(Date.now() + config.localNetwork.aggregationTimeout).toISOString(),
                participants: [this.nodeInfo]
            };

            this.activeProposals.set(peerId, proposal);
            this.aggregationState = 'proposing';

            await this.networkManager.sendToPeer(peerId, {
                type: 'aggregation_proposal',
                proposal,
                timestamp: new Date().toISOString()
            });

            // Set timeout for proposal
            setTimeout(() => {
                this.handleProposalTimeout(peerId);
            }, config.localNetwork.aggregationTimeout);

        } catch (error) {
            this.logger.error(`Failed to propose aggregation to peer ${peerId}`, error as Error);
            this.activeProposals.delete(peerId);
            this.aggregationState = 'none';
        }
    }

    public async handleAggregationProposal(
        proposal: AggregationProposal
    ): Promise<void> {
        if (this.aggregationState !== 'none' || 
            this.nodeInfo.isAggregated ||
            !this.isEligibleForAggregation(proposal)) {
            
            await this.networkManager.sendToPeer(proposal.proposerId, {
                type: 'aggregation_rejected',
                reason: 'Node not eligible for aggregation',
                timestamp: new Date().toISOString()
            });
            return;
        }

        try {
            this.aggregationState = 'considering';

            // Evaluate the proposal
            if (await this.evaluateProposal(proposal)) {
                await this.acceptProposal(proposal);
            } else {
                await this.rejectProposal(proposal);
            }

        } catch (error) {
            this.logger.error('Failed to handle aggregation proposal', error as Error);
            this.aggregationState = 'none';
        }
    }

    public handleAggregationAccepted(
        peerId: string, 
        peerInfo: LocalNodeInfo
    ): void {
        const proposal = this.activeProposals.get(peerId);
        if (!proposal) return;

        proposal.participants.push(peerInfo);

        // Check if we have enough participants
        if (proposal.participants.length >= config.localNetwork.aggregationThreshold) {
            this.finalizeAggregation(proposal);
        }
    }

    public handleAggregationRejected(peerId: string): void {
        this.activeProposals.delete(peerId);
        if (this.activeProposals.size === 0) {
            this.aggregationState = 'none';
        }
    }

    public isPeerEligibleForAggregation(peerInfo: LocalNodeInfo): boolean {
        return (
            !peerInfo.isAggregated &&
            this.getTierLevel(peerInfo.tier) >= this.getTierLevel(config.localNetwork.minAggregationTier) &&
            this.areResourcesCompatible(peerInfo.hardwareProfile)
        );
    }

    private async evaluateProposal(
        proposal: AggregationProposal
    ): Promise<boolean> {
        // Check if proposal meets minimum requirements
        if (proposal.participants.length < 1) {
            return false;
        }

        // Check if all participants meet minimum tier requirement
        const allMeetTier = proposal.participants.every(
            participant => this.getTierLevel(participant.tier) >= 
                this.getTierLevel(config.localNetwork.minAggregationTier)
        );

        if (!allMeetTier) {
            return false;
        }

        // Check resource compatibility
        const allCompatible = proposal.participants.every(
            participant => this.areResourcesCompatible(participant.hardwareProfile)
        );

        return allCompatible;
    }

    private async acceptProposal(proposal: AggregationProposal): Promise<void> {
        this.aggregationState = 'joining';

        await this.networkManager.sendToPeer(proposal.proposerId, {
            type: 'aggregation_accepted',
            nodeInfo: this.nodeInfo,
            timestamp: new Date().toISOString()
        });
    }

    public async rejectProposal(proposal: AggregationProposal): Promise<void> {
        this.aggregationState = 'none';

        await this.networkManager.sendToPeer(proposal.proposerId, {
            type: 'aggregation_rejected',
            reason: 'Proposal requirements not met',
            timestamp: new Date().toISOString()
        });
    }

    private async finalizeAggregation(proposal: AggregationProposal): Promise<void> {
        try {
            // Create aggregated node info
            const aggregatedInfo = this.createAggregatedNodeInfo(proposal.participants);

            // Notify all participants
            const notifications = proposal.participants.map(participant =>
                this.networkManager.sendToPeer(participant.deviceId, {
                    type: 'aggregation_finalized',
                    aggregatedInfo,
                    timestamp: new Date().toISOString()
                })
            );

            await Promise.all(notifications);

            // Update local state
            this.isAggregator = true;
            proposal.participants.forEach(participant => {
                this.aggregatedNodes.set(participant.deviceId, participant);
            });

            this.aggregationState = 'aggregated';
            this.activeProposals.clear();

            // Emit completion event
            this.emit('aggregation_completed', aggregatedInfo);

        } catch (error) {
            this.logger.error('Failed to finalize aggregation', error as Error);
            this.rollbackAggregation(proposal);
        }
    }

    private createAggregatedNodeInfo(
        participants: LocalNodeInfo[]
    ): LocalNodeInfo {
        // Combine hardware profiles
        const combinedProfile = this.combineHardwareProfiles(
            participants.map(p => p.hardwareProfile)
        );

        // Determine aggregated tier
        const aggregatedTier = this.determineAggregatedTier(participants);

        return {
            deviceId: `aggregated_${this.nodeInfo.deviceId}`,
            type: 'individual',
            tier: aggregatedTier,
            region: this.nodeInfo.region,
            hardwareProfile: combinedProfile,
            capabilities: this.determineAggregatedCapabilities(participants),
            status: 'connected',
            isAggregated: true,
            aggregatedNodes: participants.map(p => p.deviceId),
            aggregatorId: this.nodeInfo.deviceId
        };
    }

    private combineHardwareProfiles(profiles: HardwareProfile[]): HardwareProfile {
        return {
    cpuCores: profiles.reduce((sum, p) => sum + p.cpuCores, 0),
    cpuSpeed: Math.max(...profiles.map(p => p.cpuSpeed)),
    memoryGB: profiles.reduce((sum, p) => sum + p.memoryGB, 0),
    storageGB: profiles.reduce((sum, p) => sum + p.storageGB, 0),
    gpuInfo: profiles.flatMap(p => p.gpuInfo || []),
    networkSpeed: Math.min(...profiles.map(p => p.networkSpeed)),
    capabilities: this.combineCapabilities(profiles.map(p => p.capabilities))
};
    }

    private determineAggregatedTier(participants: LocalNodeInfo[]): NodeTier {
        const hasGPU = participants.some(p => 
            p.hardwareProfile.gpuInfo && p.hardwareProfile.gpuInfo.length > 0
        );

        const totalCores = participants.reduce(
            (sum, p) => sum + p.hardwareProfile.cpuCores, 
            0
        );

        const totalMemory = participants.reduce(
            (sum, p) => sum + p.hardwareProfile.memoryGB,
            0
        );

        if (hasGPU && totalCores >= 16 && totalMemory >= 32) {
            return 'training';
        } else if (totalCores >= 12 && totalMemory >= 24) {
            return 'aggregator';
        }

        return 'inference';
    }

    private combineCapabilities(capabilities: HardwareCapabilities[]): HardwareCapabilities {
        return {
            canTrain: capabilities.some(c => c.canTrain),
            canInference: capabilities.some(c => c.canInference),
            canAggregate: capabilities.some(c => c.canAggregate),
            maxBatchSize: Math.max(...capabilities.map(c => c.maxBatchSize)),
            supportedModels: Array.from(new Set(capabilities.flatMap(c => c.supportedModels))),
            supportedPrecisions: Array.from(new Set(capabilities.flatMap(c => c.supportedPrecisions))),
            maxModelSize: Math.max(...capabilities.map(c => c.maxModelSize))
        };
    }

    private determineAggregatedCapabilities(
        participants: LocalNodeInfo[]
    ): string[] {
        const capabilities = new Set<string>();
        
        participants.forEach(participant => {
            participant.capabilities.forEach(cap => capabilities.add(cap));
        });

        return Array.from(capabilities);
    }

    private getTierLevel(tier: NodeTier): number {
        const tierLevels: { [key in NodeTier]: number } = {
            'inference': 1,
            'aggregator': 2,
            'training': 3,
            'feedback': 4
        };
        return tierLevels[tier];
    }

    private areResourcesCompatible(profile: HardwareProfile): boolean {
        // Check CPU architecture compatibility
        if (profile.cpuModel && this.nodeInfo.hardwareProfile.cpuModel &&
            profile.cpuModel !== this.nodeInfo.hardwareProfile.cpuModel) {
            return false;
        }

        // Check GPU compatibility if present
        const hasGPU = this.nodeInfo.hardwareProfile.gpuInfo && 
            this.nodeInfo.hardwareProfile.gpuInfo.length > 0;
        const peerHasGPU = profile.gpuInfo && profile.gpuInfo.length > 0;

        if (hasGPU !== peerHasGPU) {
            return false;
        }

        // Check network speed compatibility
        const minNetworkSpeed = Math.min(
            profile.networkSpeed,
            this.nodeInfo.hardwareProfile.networkSpeed
        );

        if (minNetworkSpeed < 100) { // Minimum 100Mbps required
            return false;
        }

        return true;
    }

    private async rollbackAggregation(proposal: AggregationProposal): Promise<void> {
        try {
            // Notify all participants of rollback
            const rollbackMessage: LocalPeerMessage = {
                type: 'aggregation_rollback',
                nodeInfo: this.nodeInfo,
                timestamp: new Date().toISOString()
            };

            const notifications = proposal.participants.map(participant =>
                this.networkManager.sendToPeer(participant.deviceId, rollbackMessage)
            );

            await Promise.all(notifications);

            // Reset local state
            this.isAggregator = false;
            this.aggregatedNodes.clear();
            this.aggregationState = 'none';
            this.activeProposals.clear();

        } catch (error) {
            this.logger.error('Failed to rollback aggregation', error as Error);
        }
    }

    public getAggregatedNodes(): LocalNodeInfo[] {
        return Array.from(this.aggregatedNodes.values());
    }

    public isAggregator: boolean = false;

    public getAggregationState(): AggregationState {
        return this.aggregationState;
    }

    public getActiveProposals(): Map<string, AggregationProposal> {
        return new Map(this.activeProposals);
    }

    public async leaveAggregation(): Promise<void> {
        if (!this.nodeInfo.isAggregated || !this.nodeInfo.aggregatorId) {
            return;
        }

        try {
            // Notify aggregator
            await this.networkManager.sendToPeer(
                this.nodeInfo.aggregatorId,
                {
                    type: 'leave_aggregation',
                    nodeInfo: this.nodeInfo,
                    timestamp: new Date().toISOString()
                }
            );

            // Reset local state
            this.nodeInfo.isAggregated = false;
            this.nodeInfo.aggregatorId = null;
            this.nodeInfo.aggregatedNodes = [];

            this.aggregationState = 'none';

        } catch (error) {
            this.logger.error('Failed to leave aggregation', error as Error);
            throw error;
        }
    }

    public handleNodeLeave(peerId: string): void {
        // Remove node from aggregated nodes if present
        this.aggregatedNodes.delete(peerId);

        // If we're an aggregator and lost too many nodes, dissolve the aggregation
        if (this.isAggregator && 
            this.aggregatedNodes.size < config.localNetwork.aggregationThreshold - 1) {
            this.dissolveAggregation();
        }

        // Clean up any active proposals
        this.activeProposals.delete(peerId);
    }

    private async dissolveAggregation(): Promise<void> {
        try {
            // Notify all aggregated nodes
            const dissolveMessage: LocalPeerMessage = {
                type: 'aggregation_dissolved',
                nodeInfo: this.nodeInfo,
                timestamp: new Date().toISOString()
            };

            const notifications = Array.from(this.aggregatedNodes.values()).map(node =>
                this.networkManager.sendToPeer(node.deviceId, dissolveMessage)
            );

            await Promise.all(notifications);

            // Reset local state
            this.isAggregator = false;
            this.aggregatedNodes.clear();
            this.aggregationState = 'none';

            // Reset node info
            this.nodeInfo.isAggregated = false;
            this.nodeInfo.aggregatorId = null;
            this.nodeInfo.aggregatedNodes = [];

        } catch (error) {
            this.logger.error('Failed to dissolve aggregation', error as Error);
        }
    }

    private handleProposalTimeout(peerId: string): void {
        this.activeProposals.delete(peerId);
        if (this.activeProposals.size === 0) {
            this.aggregationState = 'none';
        }
    }

    public getAggregationMetrics(): {
        totalNodes: number;
        combinedCores: number;
        combinedMemory: number;
        combinedStorage: number;
        hasGPU: boolean;
    } {
        let combinedCores = this.nodeInfo.hardwareProfile.cpuCores;
        let combinedMemory = this.nodeInfo.hardwareProfile.memoryGB;
        let combinedStorage = this.nodeInfo.hardwareProfile.storageGB;
        let hasGPU = Boolean(this.nodeInfo.hardwareProfile.gpuInfo?.length);

        this.aggregatedNodes.forEach(node => {
            combinedCores += node.hardwareProfile.cpuCores;
            combinedMemory += node.hardwareProfile.memoryGB;
            combinedStorage += node.hardwareProfile.storageGB;
            hasGPU = hasGPU || Boolean(node.hardwareProfile.gpuInfo?.length);
        });

        return {
            totalNodes: this.aggregatedNodes.size + 1,
            combinedCores,
            combinedMemory,
            combinedStorage,
            hasGPU
        };
    }
}