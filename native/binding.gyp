{
  "targets": [
    {
      "target_name": "mpv_binding",
      "sources": [
        "binding.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/../mpv/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "mpv_render_gl.mm",
            "mpv_hdr.mm",
            "mpv_headless.mm",
            "mpv_thumbnail.mm",
            "mpv_anim_export.mm",
            "binding_workers.cc"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "LD_RUNPATH_SEARCH_PATHS": [
              "@loader_path/../lib",
              "@loader_path/../../../vendor/mpv/darwin-arm64/lib",
              "@loader_path/../../../vendor/webp/darwin-arm64/lib"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework Cocoa",
              "-framework IOKit",
              "-framework QuartzCore",
              "-framework CoreVideo",
              "-framework IOSurface",
              "-framework OpenGL",
              "-framework ImageIO",
              "-framework CoreGraphics",
              "-lz"
            ]
          },
          "conditions": [
            ["target_arch=='arm64'", {
              "link_settings": {
                "libraries": [
                  "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib/libmpv.2.dylib",
                  "<(module_root_dir)/../vendor/webp/darwin-arm64/lib/libwebp.7.dylib",
                  "<(module_root_dir)/../vendor/webp/darwin-arm64/lib/libwebpmux.3.dylib",
                  "<(module_root_dir)/../vendor/webp/darwin-arm64/lib/libsharpyuv.0.dylib",
                  "<(module_root_dir)/../vendor/avif/darwin-arm64/lib/libavif.16.dylib",
                  "<(module_root_dir)/../vendor/avif/darwin-arm64/lib/libdav1d.7.dylib",
                  "<(module_root_dir)/../vendor/avif/darwin-arm64/lib/libaom.3.dylib",
                  "<(module_root_dir)/../vendor/avif/darwin-arm64/lib/libvmaf.3.dylib"
                ],
                "library_dirs": [
                  "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib",
                  "<(module_root_dir)/../vendor/webp/darwin-arm64/lib",
                  "<(module_root_dir)/../vendor/avif/darwin-arm64/lib"
                ]
              },
              "include_dirs": [
                "<(module_root_dir)/../vendor/mpv/darwin-arm64/include"
              ]
            }],
            ["target_arch=='x64'", {
              "link_settings": {
                "libraries": [
                  "<(module_root_dir)/../vendor/mpv/darwin-x64/lib/libmpv.2.dylib"
                ],
                "library_dirs": [
                  "<(module_root_dir)/../vendor/mpv/darwin-x64/lib"
                ]
              },
              "include_dirs": [
                "<(module_root_dir)/../vendor/mpv/darwin-x64/include"
              ]
            }]
          ]
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/utf-8" ]
            }
          },
          "include_dirs": [
            "<(module_root_dir)/../vendor/mpv/win32-x64/include"
          ],
          "link_settings": {
            "libraries": [
              "<(module_root_dir)/../vendor/mpv/win32-x64/lib/libmpv.lib",
              "opengl32.lib",
              "dwmapi.lib",
              "imm32.lib",
              "shcore.lib",
              "version.lib",
              "user32.lib",
              "gdi32.lib",
              "kernel32.lib",
              "advapi32.lib",
              "shell32.lib",
              "ole32.lib",
              "oleaut32.lib",
              "uuid.lib",
              "ws2_32.lib",
              "winmm.lib",
              "bcrypt.lib"
            ],
            "library_dirs": [
              "<(module_root_dir)/../vendor/mpv/win32-x64/lib"
            ],
            "msvs_disabled_warnings": [ 4006 ]
          }
        }],
        ["OS=='linux'", {
          "link_settings": {
            "libraries": [
              "-L../mpv/build",
              "-lmpv",
              "-lpthread"
            ],
            "library_dirs": [
              "../mpv/build"
            ]
          }
        }]
      ]
    }
  ]
}
