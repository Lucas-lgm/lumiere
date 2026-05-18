const { execSync } = require('child_process')
const path = require('path')

const electronVersion = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version
const arch = process.argv[2] || process.arch
const projectRoot = path.join(__dirname, '..')
const nativeDir = path.join(projectRoot, 'native')
const nodeGyp = path.join(projectRoot, 'node_modules', '.bin', 'node-gyp')

// Ensure electron headers are downloaded
const cacheDir = path.join(process.env.LOCALAPPDATA || process.env.HOME, 'node-gyp', 'Cache', electronVersion)
const headerDir = require('fs').existsSync(cacheDir) ? cacheDir : undefined

const args = [
  `"${nodeGyp}"`, 'rebuild',
  '--directory', `"${nativeDir}"`,
  `--target=${electronVersion}`,
  `--arch=${arch}`,
  '--dist-url=https://electronjs.org/headers'
]
if (headerDir) args.push(`--nodedir="${headerDir}"`)

console.log(`Building native module for Electron ${electronVersion} (${arch})...`)
execSync(args.join(' '), { stdio: 'inherit', cwd: projectRoot })
