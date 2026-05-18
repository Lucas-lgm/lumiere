/**
 * IPC error handling utility
 *
 * Provides a unified IPC handler error handling mechanism to reduce code duplication
 * and ensure consistency and maintainability of error handling.
 */

import { IpcMainEvent } from 'electron'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('IPCErrorHandler')

/**
 * IPC error response interface
 */
export interface IpcErrorResponse {
  success: false
  error: string
}

/**
 * IPC success response interface
 */
export interface IpcSuccessResponse<T = any> {
  success: true
  data?: T
}

/**
 * IPC response type (success or failure)
 */
export type IpcResponse<T = any> = IpcSuccessResponse<T> | IpcErrorResponse

/**
 * IPC Handler function type definition
 *
 * @template TArgs IPC message parameter type
 * @template TResponse Response data type
 */
export type IpcHandler<TArgs extends any[] = any[], TResponse = any> = (
  event: IpcMainEvent,
  ...args: TArgs
) => Promise<TResponse> | TResponse

/**
 * Create an IPC Handler with error handling
 *
 * Automatically wraps the handler function, uniformly handling errors and returning
 * standardized error responses.
 *
 * @template TArgs IPC message parameter type
 * @template TResponse Response data type
 * @param handler The original IPC handler function
 * @param errorChannel Error response channel name (optional, defaults to original channel name + '-error')
 * @param handlerName Handler name (for logging)
 * @returns The wrapped IPC handler function
 *
 * @example
 * ```typescript
 * ipcMain.on('player:set-volume', createIpcHandler(
 *   async (event, volume: number) => {
 *     await videoPlayerApp.setVolume(volume)
 *   },
 *   undefined,
 *   'player:set-volume'
 * ))
 * ```
 */
export function createIpcHandler<TArgs extends any[] = any[], TResponse = any>(
  handler: IpcHandler<TArgs, TResponse>,
  errorChannel?: string,
  handlerName?: string
): (event: IpcMainEvent, ...args: TArgs) => void {
  const handlerDisplayName = handlerName || 'unknown-handler'

  return async (event: IpcMainEvent, ...args: TArgs): Promise<void> => {
    try {
      const result = await handler(event, ...args)
      
      // If the handler returned a result and needs to reply, handling goes here
      // In most cases, the handler calls event.reply itself
    } catch (error) {
      // Unified error handling
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // Log the error
      logger.error(`IPC handler "${handlerDisplayName}" failed`, {
        error: errorMessage,
        args: args.length > 0 ? args : undefined
      })

      // Send error response
      const channel = errorChannel || `${event.sender.id}-error`
      const errorResponse: IpcErrorResponse = {
        success: false,
        error: errorMessage
      }

      // Attempt to send error response
      try {
        event.reply(channel, errorResponse)
      } catch (replyError) {
        // If event.reply fails (e.g. window already closed), log but don't throw
        logger.warn(`Failed to send error response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    }
  }
}

/**
 * Create an IPC Handler with error handling and automatic reply
 *
 * Similar to createIpcHandler, but automatically sends the handler's return value
 * as a success response.
 *
 * @template TArgs IPC message parameter type
 * @template TResponse Response data type
 * @param handler The original IPC handler function
 * @param successChannel Success response channel name
 * @param errorChannel Error response channel name (optional)
 * @param handlerName Handler name (for logging)
 * @returns The wrapped IPC handler function
 *
 * @example
 * ```typescript
 * ipcMain.on('file:get-mounts', createIpcHandlerWithReply(
 *   (event) => {
 *     return mountPathService.getAllMountPaths()
 *   },
 *   'file:mounts-updated',
 *   'file:mount-error',
 *   'file:get-mounts'
 * ))
 * ```
 */
export function createIpcHandlerWithReply<TArgs extends any[] = any[], TResponse = any>(
  handler: IpcHandler<TArgs, TResponse>,
  successChannel: string,
  errorChannel?: string,
  handlerName?: string
): (event: IpcMainEvent, ...args: TArgs) => void {
  const handlerDisplayName = handlerName || 'unknown-handler'

  return async (event: IpcMainEvent, ...args: TArgs): Promise<void> => {
    try {
      const result = await handler(event, ...args)
      
      // Send success response
      const successResponse: IpcSuccessResponse<TResponse> = {
        success: true,
        data: result
      }

      try {
        event.reply(successChannel, successResponse)
      } catch (replyError) {
        logger.warn(`Failed to send success response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    } catch (error) {
      // Unified error handling (same as createIpcHandler)
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error(`IPC handler "${handlerDisplayName}" failed`, {
        error: errorMessage,
        args: args.length > 0 ? args : undefined
      })

      const channel = errorChannel || `${event.sender.id}-error`
      const errorResponse: IpcErrorResponse = {
        success: false,
        error: errorMessage
      }

      try {
        event.reply(channel, errorResponse)
      } catch (replyError) {
        logger.warn(`Failed to send error response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    }
  }
}
