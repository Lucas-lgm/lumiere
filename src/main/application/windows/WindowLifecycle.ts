import { EventEmitter } from 'events'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('WindowLifecycle')

// 状态定义
export enum WindowState {
  INITIAL = 'INITIAL',       // 初始状态，未初始化
  CREATING = 'CREATING',     // 正在创建底层窗口资源
  HIDDEN = 'HIDDEN',         // 已创建但隐藏 (Preloaded)
  VISIBLE = 'VISIBLE',       // 正常显示
  FULLSCREEN = 'FULLSCREEN', // 全屏显示
  MINIMIZED = 'MINIMIZED',   // 最小化
  DESTROYED = 'DESTROYED'    // 已销毁
}

// 事件定义
export enum WindowEvent {
  INIT = 'INIT',
  SHOW = 'SHOW',
  HIDE = 'HIDE',
  MINIMIZE = 'MINIMIZE',
  RESTORE = 'RESTORE',
  ENTER_FULLSCREEN = 'ENTER_FULLSCREEN',
  EXIT_FULLSCREEN = 'EXIT_FULLSCREEN',
  CLOSE = 'CLOSE'
}

/**
 * Window Lifecycle FSM (Finite State Machine)
 * 
 * 使用状态机管理窗口的复杂状态流转，替代散落在各处的布尔标志位。
 * 确保窗口行为的确定性 (Deterministic Behavior)。
 * 
 * 优势：
 * 1. 防止非法状态转换（例如从 MINIMIZED 直接跳到 FULLSCREEN 可能需要经过 RESTORE）
 * 2. 统一管理副作用（Side Effects），如全屏时隐藏 Dock，最小化时暂停播放
 */
export class WindowLifecycle extends EventEmitter {
  private _state: WindowState = WindowState.INITIAL

  get state(): WindowState {
    return this._state
  }

  constructor() {
    super()
  }

  /**
   * 尝试触发状态转换
   * @param event 触发事件
   * @returns 是否转换成功
   */
  transition(event: WindowEvent): boolean {
    const oldState = this._state
    let newState: WindowState | null = null

    switch (oldState) {
      case WindowState.INITIAL:
        if (event === WindowEvent.INIT) newState = WindowState.CREATING
        break

      case WindowState.CREATING:
        if (event === WindowEvent.HIDE) newState = WindowState.HIDDEN
        if (event === WindowEvent.SHOW) newState = WindowState.VISIBLE
        if (event === WindowEvent.CLOSE) newState = WindowState.DESTROYED
        break

      case WindowState.HIDDEN:
        if (event === WindowEvent.SHOW) newState = WindowState.VISIBLE
        if (event === WindowEvent.CLOSE) newState = WindowState.DESTROYED
        break

      case WindowState.VISIBLE:
        if (event === WindowEvent.HIDE) newState = WindowState.HIDDEN
        if (event === WindowEvent.MINIMIZE) newState = WindowState.MINIMIZED
        if (event === WindowEvent.ENTER_FULLSCREEN) newState = WindowState.FULLSCREEN
        if (event === WindowEvent.CLOSE) newState = WindowState.DESTROYED
        break

      case WindowState.FULLSCREEN:
        if (event === WindowEvent.EXIT_FULLSCREEN) newState = WindowState.VISIBLE
        if (event === WindowEvent.MINIMIZE) newState = WindowState.MINIMIZED // 允许直接最小化
        if (event === WindowEvent.CLOSE) newState = WindowState.DESTROYED
        break

      case WindowState.MINIMIZED:
        if (event === WindowEvent.RESTORE) newState = WindowState.VISIBLE // 默认恢复到普通状态
        // 如果需要恢复到全屏，可能需要额外记录之前的状态，这里简化处理
        if (event === WindowEvent.CLOSE) newState = WindowState.DESTROYED
        break
        
      case WindowState.DESTROYED:
        // 终态，不可流转
        break
    }

    if (newState && newState !== oldState) {
      logger.debug(`Window State Transition: ${oldState} -> ${newState} [Event: ${event}]`)
      this._state = newState
      this.emit('state-changed', newState, oldState)
      return true
    } else {
      logger.warn(`Invalid Window State Transition: ${oldState} -> [${event}]`)
      return false
    }
  }

  // 辅助方法：判断是否处于活跃可视状态
  isActive(): boolean {
    return this._state === WindowState.VISIBLE || this._state === WindowState.FULLSCREEN
  }
}
