import { TaskPriority, TaskType } from '../api/SchedulerTypes';

const QUEUE_AGING_INTERVAL_MS: number = 30000;
const QUEUE_AGING_MAX_BONUS: number = 3;

export interface QueueItem {
  taskId: string;
  taskType: TaskType;
  priority: TaskPriority;
  paused: boolean;
  pausable: boolean;
}

interface SequencedQueueItem<TItem extends QueueItem> {
  item: TItem;
  sequence: number;
  enqueuedAt: number;
}

export class TaskQueue<TItem extends QueueItem> {
  private items: SequencedQueueItem<TItem>[] = [];
  private nextSequence: number = 0;

  public enqueue(item: TItem): void {
    this.items.push({
      item: item,
      sequence: this.nextSequence++,
      enqueuedAt: Date.now()
    });
    this.sortItems();
  }

  public dequeue(): TItem | null {
    this.sortItems();
    const index: number = this.items.findIndex((entry: SequencedQueueItem<TItem>) => !entry.item.paused);
    if (index < 0) {
      return null;
    }
    const removed: SequencedQueueItem<TItem>[] = this.items.splice(index, 1);
    return removed[0].item;
  }

  public remove(taskId: string): TItem | null {
    const index: number = this.items.findIndex(
      (entry: SequencedQueueItem<TItem>) => entry.item.taskId === taskId
    );
    if (index < 0) {
      return null;
    }
    const removed: SequencedQueueItem<TItem>[] = this.items.splice(index, 1);
    return removed[0].item;
  }

  public updatePriority(taskId: string, priority: TaskPriority): boolean {
    const entry: SequencedQueueItem<TItem> | undefined = this.items.find(
      (candidate: SequencedQueueItem<TItem>) => candidate.item.taskId === taskId
    );
    if (entry === undefined) {
      return false;
    }
    entry.item.priority = priority;
    this.sortItems();
    return true;
  }

  public pauseBackgroundTasks(): number {
    let pausedCount: number = 0;
    this.items.forEach((entry: SequencedQueueItem<TItem>) => {
      if (entry.item.taskType === TaskType.BACKGROUND_BATCH && entry.item.pausable && !entry.item.paused) {
        entry.item.paused = true;
        pausedCount++;
      }
    });
    return pausedCount;
  }

  public getItems(): TItem[] {
    return this.items.map((entry: SequencedQueueItem<TItem>) => entry.item);
  }

  public clear(): TItem[] {
    const cleared: TItem[] = this.getItems();
    this.items = [];
    return cleared;
  }

  public getSize(): number {
    return this.items.length;
  }

  public hasRunnableItems(): boolean {
    return this.items.some((entry: SequencedQueueItem<TItem>) => !entry.item.paused);
  }

  private sortItems(): void {
    const nowMs: number = Date.now();
    this.items.sort((left: SequencedQueueItem<TItem>, right: SequencedQueueItem<TItem>) => {
      const priorityDelta: number = this.effectivePriorityRank(right, nowMs) -
        this.effectivePriorityRank(left, nowMs);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.sequence - right.sequence;
    });
  }

  private effectivePriorityRank(entry: SequencedQueueItem<TItem>, nowMs: number): number {
    const waitMs: number = Math.max(0, nowMs - entry.enqueuedAt);
    const agingBonus: number = Math.min(
      QUEUE_AGING_MAX_BONUS,
      Math.floor(waitMs / QUEUE_AGING_INTERVAL_MS)
    );
    return this.priorityRank(entry.item.priority) + agingBonus;
  }

  private priorityRank(priority: TaskPriority): number {
    if (priority === TaskPriority.CRITICAL) {
      return 4;
    }
    if (priority === TaskPriority.HIGH) {
      return 3;
    }
    if (priority === TaskPriority.NORMAL) {
      return 2;
    }
    return 1;
  }
}
