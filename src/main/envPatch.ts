/**
 * 必须在任何加载 libmpv native binding 之前执行。
 * 在 macOS 上设置 MPV_COREAUDIO_FORCE_DEFAULT，避免 CoreAudio UID 路径在
 * macOS 26 / 嵌入式场景下触发空指针崩溃（ca_select_device）。
 */
if (process.platform === 'darwin') {
  process.env.MPV_COREAUDIO_FORCE_DEFAULT = '1'
}
