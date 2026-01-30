import { WindowController } from './WindowController'
import { WindowsStrategy } from './strategies/WindowsStrategy'
import { MacStrategy } from './strategies/MacStrategy'
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
      return new WindowsStrategy()
    } else if (platform === 'darwin') {
      return new MacStrategy()
    } else {
      // Default fallback (Linux or others), using MacStrategy logic (Single Window) is usually safer/simpler
      logger.warn(`Unsupported platform: ${platform}, falling back to Single-Window strategy`)
      return new MacStrategy() 
    }
  }
}
