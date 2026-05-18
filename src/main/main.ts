// Must execute first: Force CoreAudio to use the default device on macOS to avoid ca_select_device crash
// import './envPatch'

import { runApp } from './application/bootstrap'

runApp()
