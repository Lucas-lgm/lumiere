import { EventEmitter } from 'events'
import { createLogger } from '../logging'

const logger = createLogger('TaskQueue')

export interface Task<T = void> {
  type: string
  id?: string
  execute: () => Promise<T>
  meta?: any
}

interface QueuedTask<T> {
  task: Task<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
}

export type AddStrategy = 'append' | 'replace' | 'clear_all'

/**
 * Basic task queue (passive)
 * Only responsible for storing tasks and executing specified tasks, no longer contains automatic scheduling logic
 */
export class TaskQueue {
  private queue: QueuedTask<any>[] = []

  /**
   * Add a task to the queue
   * @param task Task object
   * @param strategy Add strategy: 'append' (default), 'replace' (replace same ID), 'clear_all' (clear queue)
   * @returns Promise of the task execution result
   */
  add<T>(task: Task<T>, strategy: AddStrategy = 'append'): Promise<T> {
    if (strategy === 'clear_all') {
      this.clear('Queue cleared by new task')
    } else if (strategy === 'replace' && task.id) {
      this.removeById(task.id, 'Task replaced by new task')
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject
      })
    })
  }

  /**
   * Peek at the front task (without removing)
   */
  peek(): Task<any> | undefined {
    return this.queue[0]?.task
  }

  /**
   * Remove and execute the front task
   */
  async processNext(): Promise<void> {
    const item = this.queue.shift()
    if (!item) return

    const { task, resolve, reject } = item
    try {
      logger.debug(`Executing task: ${task.type}`, { meta: task.meta })
      const result = await task.execute()
      resolve(result)
    } catch (error) {
      logger.error(`Task failed: ${task.type}`, {
        error: error instanceof Error ? error.message : String(error),
        meta: task.meta
      })
      reject(error)
    }
  }

  /**
   * Remove a task by ID
   */
  private removeById(id: string, reason: string): void {
    // Filter tasks to keep, removed tasks trigger reject
    const kept: QueuedTask<any>[] = []
    
    for (const item of this.queue) {
      if (item.task.id === id) {
        item.reject(new Error(reason))
      } else {
        kept.push(item)
      }
    }
    
    this.queue = kept
  }

  /**
   * Clear the queue
   */
  clear(reason: string = 'Task queue cleared'): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (item) {
        item.reject(new Error(reason))
      }
    }
  }

  get length(): number {
    return this.queue.length
  }

  get isEmpty(): boolean {
    return this.queue.length === 0
  }
}