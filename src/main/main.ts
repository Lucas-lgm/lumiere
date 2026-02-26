// 必须在最先执行：macOS 上强制 CoreAudio 使用默认设备，避免 ca_select_device 崩溃
// import './envPatch'

import { runApp } from './application/bootstrap'

runApp()
