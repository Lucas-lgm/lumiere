
import { Input } from 'electron'

export function mapElectronInputToMpvKey(input: Input): string | null {
  if (input.type !== 'keyDown') return null

  // 忽略单独的修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) return null
  // 忽略 F12 (开发者工具) 和 F5 (刷新)
  if (input.key === 'F12' || input.key === 'F5') return null

  const keyMap: Record<string, string> = {
    ' ': 'SPACE',
    'ArrowLeft': 'LEFT',
    'ArrowRight': 'RIGHT',
    'ArrowUp': 'UP',
    'ArrowDown': 'DOWN',
    'Enter': 'ENTER',
    'Escape': 'ESC',
    'Backspace': 'BS',
    'Tab': 'TAB',
    'Insert': 'INS',
    'Delete': 'DEL',
    'Home': 'HOME',
    'End': 'END',
    'PageUp': 'PGUP',
    'PageDown': 'PGDWN',
    // 媒体键
    'MediaPlayPause': 'PLAYPAUSE',
    'MediaStop': 'STOP',
    'MediaTrackNext': 'NEXT',
    'MediaTrackPrevious': 'PREV',
    'MediaVolumeUp': 'VOLUME_UP',
    'MediaVolumeDown': 'VOLUME_DOWN',
    'MediaVolumeMute': 'MUTE'
  }

  let key = keyMap[input.key] || input.key

  // 处理修饰键
  const modifiers: string[] = []
  if (input.control) modifiers.push('Ctrl')
  if (input.alt) modifiers.push('Alt')
  if (input.meta) modifiers.push('Meta')
  if (input.shift && (key.length > 1 || key === 'SPACE' || key === 'TAB')) {
    modifiers.push('Shift')
  }

  if (modifiers.length > 0) {
    key = `${modifiers.join('+')}+${key}`
  }

  return key
}
