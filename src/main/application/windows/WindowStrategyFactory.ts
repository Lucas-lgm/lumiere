import { WindowController } from './WindowController'
import { DualWindowStrategy } from './strategies/WindowsStrategy'
import { SingleWindowStrategy } from './strategies/MacStrategy'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('WindowStrategyFactory')

export class WindowStrategyFactory {
  /**
   * Create a platform-specific window controller
   */
  static create(): WindowController {
    const platform = process.platform

    logger.info(`Creating window strategy for platform: ${platform}`)

    if (platform === 'win32') {
      return new DualWindowStrategy()
    } else if (platform === 'darwin') {
      return new SingleWindowStrategy()
    } else {
      // Default fallback (Linux or others), using MacStrategy logic (Single Window) is usually safer/simpler
      logger.warn(`Unsupported platform: ${platform}, falling back to Single-Window strategy`)
      return new SingleWindowStrategy() 
    }
  }
}
