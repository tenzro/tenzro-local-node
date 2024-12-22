// tenzro-local-node/src/core/TaskManager.ts

import { EventEmitter } from "events";
import { Logger } from "../utils/Logger";
import { ResourceManager } from "./ResourceManager";
import {
  Task,
  LocalNodeInfo,
  TaskStatus,
  TaskResult,
  TaskPriority,
  TaskExecutionContext,
} from "../types";
import config from "../config";

export class TaskManager extends EventEmitter {
  private logger: Logger;
  private activeTasks: Map<string, Task> = new Map();
  private taskQueue: Task[] = [];
  private taskResults: Map<string, TaskResult> = new Map();
  private acceptingTasks: boolean = true;
  private resourceManager: ResourceManager;
  private executionContexts: Map<string, TaskExecutionContext> = new Map();

  constructor(
    private nodeInfo: LocalNodeInfo,
    resourceManager?: ResourceManager
  ) {
    super();
    this.logger = Logger.getInstance();
    this.logger.setContext("TaskManager");
    this.resourceManager =
      resourceManager || new ResourceManager(nodeInfo.hardwareProfile);

    // Start queue processing
    this.processTaskQueue();
  }

  public async assignTask(task: Task): Promise<void> {
    if (!this.acceptingTasks) {
      throw new Error("Node is not accepting tasks");
    }

    if (!this.canHandleTask(task)) {
      throw new Error("Task requirements not met");
    }

    if (this.isAtCapacity()) {
      // Queue the task if we're at capacity
      this.queueTask(task);
      return;
    }

    await this.startTask(task);
  }

  private async startTask(task: Task): Promise<void> {
    try {
      // Allocate resources
      const resources = await this.resourceManager.allocateResources(
        task.requirements
      );

      // Create execution context
      const context: TaskExecutionContext = {
        taskId: task.taskId,
        startTime: new Date(),
        allocatedResources: resources,
        status: "running",
        progress: 0,
      };

      this.executionContexts.set(task.taskId, context);
      this.activeTasks.set(task.taskId, task);

      // If this is an aggregated node, distribute subtasks
      if (
        this.nodeInfo.isAggregated &&
        this.nodeInfo.aggregatedNodes.length > 0
      ) {
        await this.distributeSubtasks(task);
      } else {
        // Execute task locally
        this.executeTask(task, context);
      }

      this.emit("task_started", task.taskId);
    } catch (error) {
      this.logger.error(`Failed to start task ${task.taskId}`, error as Error);
      throw error;
    }
  }

  private async executeTask(
    task: Task,
    context: TaskExecutionContext
  ): Promise<void> {
    try {
      // Set up progress monitoring
      let lastProgress = 0;
      const progressInterval = setInterval(() => {
        const progress = this.calculateTaskProgress(task.taskId);
        if (progress !== lastProgress) {
          lastProgress = progress;
          this.emit("task_progress", task.taskId, progress);
        }
      }, 1000);

      // Execute the task
      const result = await this.executeTaskLogic(task);

      // Clean up progress monitoring
      clearInterval(progressInterval);

      // Store result and clean up
      await this.handleTaskCompletion(task.taskId, result);
    } catch (error) {
      await this.handleTaskFailure(task.taskId, error as Error);
    }
  }

  private async executeTaskLogic(task: Task): Promise<any> {
    // Implement different task type executions
    switch (task.type) {
      case "compute":
        return await this.executeComputeTask(task);
      case "train":
        return await this.executeTrainingTask(task);
      case "process":
        return await this.executeProcessingTask(task);
      case "aggregate":
        return await this.executeAggregationTask(task);
      default:
        throw new Error(`Unsupported task type: ${task.type}`);
    }
  }
  executeComputeTask(task: Task): any {
    throw new Error("Method not implemented.");
  }
  executeTrainingTask(task: Task): any {
    throw new Error("Method not implemented.");
  }
  executeProcessingTask(task: Task): any {
    throw new Error("Method not implemented.");
  }
  executeAggregationTask(task: Task): any {
    throw new Error("Method not implemented.");
  }

  private async distributeSubtasks(task: Task): Promise<void> {
    const subtasks = this.createSubtasks(task);
    const results = await Promise.all(
      subtasks.map((subtask) => this.executeSubtask(subtask))
    );

    // Combine results
    const combinedResult = this.combineSubtaskResults(results);
    await this.handleTaskCompletion(task.taskId, combinedResult);
  }

  private createSubtasks(task: Task): Task[] {
    // Split task based on type and available nodes
    const nodeCount = this.nodeInfo.aggregatedNodes.length;
    const subtasks: Task[] = [];

    switch (task.type) {
      case "compute":
        // Split compute tasks evenly
        for (let i = 0; i < nodeCount; i++) {
          subtasks.push({
            ...task,
            taskId: `${task.taskId}_${i}`,
            data: {
              ...task.data,
              startIndex: i * (task.data.length / nodeCount),
              endIndex: (i + 1) * (task.data.length / nodeCount),
            },
          });
        }
        break;

      case "train":
        // For training tasks, distribute different model parameters
        subtasks.push(...this.splitTrainingTask(task, nodeCount));
        break;

      default:
        // Default to simple replication
        subtasks.push(...Array(nodeCount).fill(task));
    }

    return subtasks;
  }

  private splitTrainingTask(task: Task, nodeCount: number): Task[] {
    // Implement training task splitting logic
    // This could involve splitting data, model parameters, etc.
    return [];
  }

  private async executeSubtask(subtask: Task): Promise<any> {
    // Execute subtask on specific aggregated node
    return null;
  }

  private combineSubtaskResults(results: any[]): any {
    // Combine results based on task type
    return results;
  }

  private async handleTaskCompletion(
    taskId: string,
    result: any
  ): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    const context = this.executionContexts.get(taskId);
    if (context) {
      // Release resources
      await this.resourceManager.releaseResources(context.allocatedResources);
      this.executionContexts.delete(taskId);
    }

    // Store result
    const taskResult: TaskResult = {
      taskId,
      result,
      status: "completed",
      completionTime: new Date(),
      executionTime: context ? Date.now() - context.startTime.getTime() : 0,
    };

    this.taskResults.set(taskId, taskResult);
    this.activeTasks.delete(taskId);

    // Process next task in queue
    this.processNextTask();

    // Emit completion event
    this.emit("task_completed", taskId, result);
  }

  private async handleTaskFailure(taskId: string, error: Error): Promise<void> {
    const context = this.executionContexts.get(taskId);
    if (context) {
      // Release resources
      await this.resourceManager.releaseResources(context.allocatedResources);
      this.executionContexts.delete(taskId);
    }

    this.activeTasks.delete(taskId);

    // Process next task in queue
    this.processNextTask();

    // Emit failure event
    this.emit("task_failed", taskId, error);
  }

  private async processTaskQueue(): Promise<void> {
    while (true) {
      if (this.taskQueue.length > 0 && !this.isAtCapacity()) {
        const nextTask = this.taskQueue.shift();
        if (nextTask) {
          try {
            await this.startTask(nextTask);
          } catch (error) {
            this.logger.error(
              `Failed to process queued task ${nextTask.taskId}`,
              error as Error
            );
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async processNextTask(): Promise<void> {
    if (this.taskQueue.length > 0 && !this.isAtCapacity()) {
      const nextTask = this.taskQueue.shift();
      if (nextTask) {
        await this.startTask(nextTask);
      }
    }
  }

  private queueTask(task: Task): void {
    // Add task to queue based on priority
    const insertIndex = this.taskQueue.findIndex(
      (t) =>
        this.getPriorityLevel(t.priority) < this.getPriorityLevel(task.priority)
    );

    if (insertIndex === -1) {
      this.taskQueue.push(task);
    } else {
      this.taskQueue.splice(insertIndex, 0, task);
    }
  }

  private getPriorityLevel(priority: TaskPriority): number {
    const levels: { [key in TaskPriority]: number } = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };
    return levels[priority];
  }

  private canHandleTask(task: Task): boolean {
    return (
      this.nodeInfo.capabilities.includes(task.type) &&
      this.resourceManager.canAllocateResources(task.requirements)
    );
  }

  private isAtCapacity(): boolean {
    return this.activeTasks.size >= config.tasks.maxConcurrentTasks;
  }

  private calculateTaskProgress(taskId: string): number {
    const context = this.executionContexts.get(taskId);
    return context ? context.progress : 0;
  }

  // Public API methods
  public pauseTaskAcceptance(): void {
    this.acceptingTasks = false;
  }

  public resumeTaskAcceptance(): void {
    this.acceptingTasks = true;
  }

  public getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  public getQueueLength(): number {
    return this.taskQueue.length;
  }

  public getTaskStatus(taskId: string): TaskStatus {
    const active = this.activeTasks.get(taskId);
    if (active) {
      const context = this.executionContexts.get(taskId);
      return context ? context.status : "queued";
    }

    const completed = this.taskResults.get(taskId);
    return completed ? completed.status : "unknown";
  }

  public async stop(): Promise<void> {
    this.acceptingTasks = false;

    // Cancel all active tasks
    const cancelPromises = Array.from(this.activeTasks.keys()).map((taskId) =>
      this.handleTaskFailure(taskId, new Error("Task manager stopping"))
    );

    await Promise.all(cancelPromises);
    this.taskQueue = [];
  }
}
