/**
 * Must execute before any libmpv native binding is loaded.
 * Sets MPV_COREAUDIO_FORCE_DEFAULT on macOS to avoid null pointer
 * crashes (ca_select_device) caused by CoreAudio UID paths in
 * macOS 26 / embedded scenarios.
 */
if (process.platform === 'darwin') {
  process.env.MPV_COREAUDIO_FORCE_DEFAULT = '1'
}
