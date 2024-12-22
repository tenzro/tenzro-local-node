// tenzro-local-node/src/main.ts

import { LocalNode } from './core/LocalNode';
import { Logger } from './utils/Logger';
import config from './config';

const logger = Logger.getInstance();
logger.setContext('Main');

async function validateConfig(): Promise<void> {
    const { node, hardware } = config;

    // Validate hardware requirements
    const cpuInfo = require('os').cpus();
    const totalMemory = require('os').totalmem();
    const cpuCores = cpuInfo.length;
    const memoryGB = Math.floor(totalMemory / (1024 * 1024 * 1024));

    if (cpuCores < hardware.minCPUCores) {
        throw new Error(`Insufficient CPU cores. Required: ${hardware.minCPUCores}, Available: ${cpuCores}`);
    }

    if (memoryGB < hardware.minMemoryGB) {
        throw new Error(`Insufficient memory. Required: ${hardware.minMemoryGB}GB, Available: ${memoryGB}GB`);
    }

    // Validate network configuration
    if (node.type !== 'individual' && !config.network.regionalNode) {
        throw new Error('Regional node URL must be specified for non-individual nodes');
    }

    if (node.port < 1024 || node.port > 65535) {
        throw new Error('Port must be between 1024 and 65535');
    }
}

async function main() {
    try {
        // Validate configuration
        await validateConfig();

        logger.info('Starting local node with configuration:', {
            nodeId: config.node.deviceId,
            type: config.node.type,
            tier: config.node.tier,
            region: config.node.region
        });

        // Initialize local node
        const localNode = new LocalNode();

        // Handle shutdown signals
        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM signal');
            await gracefulShutdown(localNode);
        });

        process.on('SIGINT', async () => {
            logger.info('Received SIGINT signal');
            await gracefulShutdown(localNode);
        });

        // Handle uncaught errors
        process.on('uncaughtException', async (error: Error) => {
            logger.error('Uncaught exception', error);
            await gracefulShutdown(localNode);
        });

        process.on('unhandledRejection', async (reason: any) => {
            logger.error('Unhandled rejection', reason);
            await gracefulShutdown(localNode);
        });

        // Start the local node
        await localNode.start();

        logger.info(`Local node running at http://localhost:${config.node.port}`);
        logger.info('Press CTRL-C to stop');

    } catch (error) {
        logger.error('Failed to start local node', error as Error);
        process.exit(1);
    }
}

async function gracefulShutdown(localNode: LocalNode): Promise<void> {
    logger.info('Initiating graceful shutdown...');
    
    try {
        await localNode.stop();
        logger.info('Local node stopped successfully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown', error as Error);
        process.exit(1);
    } finally {
        // Force exit after timeout
        setTimeout(() => {
            logger.error('Forced exit due to shutdown timeout');
            process.exit(1);
        }, 10000);
    }
}

// Execute main function if this is the entry point
if (require.main === module) {
    main().catch(error => {
        logger.error('Fatal error in main process', error as Error);
        process.exit(1);
    });
}

export { main, validateConfig };