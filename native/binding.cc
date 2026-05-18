/**
 * Node.js Native Module Binding Layer
 *
 * Bridges Node.js with the MPV player, including:
 * - MPV instance management
 * - Event loop and callbacks
 * - Property access and command execution
 * - Render context management (macOS)
 *
 * Architecture:
 * - Uses N-API to interact with Node.js
 * - Uses ThreadSafeFunction for thread-safe event callbacks
 * - Processes MPV events through an event loop thread
 */

// ==================== Node.js N-API ====================
#include <napi.h>

// ==================== MPV Library ====================
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

// ==================== C++ Standard Library ====================
#include <thread>
#include <mutex>
#include <map>
#include <string>

#ifndef __APPLE__
struct GLRenderContext;  // Windows: pointer only, forward declaration is enough; full definition in macOS mpv_render_gl.mm
#endif

// From binding_workers.cc (macOS only)
#ifdef __APPLE__
extern Napi::Value GenerateThumbnail(const Napi::CallbackInfo& info);
extern Napi::Value GenerateThumbnailStrip(const Napi::CallbackInfo& info);
extern Napi::Value ExportAnimatedImage(const Napi::CallbackInfo& info);
extern Napi::Value CancelAnimatedImageExport(const Napi::CallbackInfo& info);
extern Napi::Value ThumbSeekInit(const Napi::CallbackInfo& info);
extern Napi::Value ThumbSeekAt(const Napi::CallbackInfo& info);
extern Napi::Value ThumbSeekDestroy(const Napi::CallbackInfo& info);
#endif

/**
 * Player Instance
 *
 * Manages all resources of a player instance, including:
 * - MPV client handle and event loop
 * - JavaScript event callback (ThreadSafeFunction)
 * - Render context (macOS)
 *
 * Note: This struct uses the implementation name MPVInstance to maintain
 * correspondence with the underlying MPV library.
 * In code, the PlayerInstance type alias can be used for better semantics.
 */
struct MPVInstance {
    mpv_handle* ctx;
    std::thread eventThread;
    bool running;
    Napi::ThreadSafeFunction tsfn;
    bool hasTsfn;
    struct GLRenderContext* glCtx;
    
    MPVInstance() : ctx(nullptr), running(false), hasTsfn(false), glCtx(nullptr) {}
    
    ~MPVInstance() {
        // TSFN should be explicitly released in Destroy(), not in the destructor
        // This ensures the eventLoop thread exits before releasing, avoiding race conditions
        // If hasTsfn is still true here, Destroy() was not called correctly; force release to avoid leak
        if (hasTsfn) {
            tsfn.Release();
            hasTsfn = false;
        }
    }
};

// Semantic type alias: use PlayerInstance for better semantics
using PlayerInstance = MPVInstance;

// From mpv_render_gl.mm (macOS only)
#ifdef __APPLE__
extern "C" struct GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv);
extern "C" void mpv_destroy_gl_context(int64_t instanceId);
// mpv_render_frame_for_instance is deprecated: rendering is now fully driven by CVDisplayLink
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height);
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled);
extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled);
extern "C" void mpv_debug_hdr_status(int64_t instanceId);
extern "C" void mpv_set_js_driven_render_mode(int64_t instanceId, int enabled);
extern "C" int mpv_get_js_driven_render_mode(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);
#endif

/**
 * Playback Event Message
 *
 * Encapsulates event data passed from MPV to JavaScript, including:
 * - Property change events (PROPERTY_CHANGE)
 * - Log message events (LOG_MESSAGE)
 * - End of file events (END_FILE)
 *
 * Note: This struct uses the implementation name MPVEventMessage to maintain
 * correspondence with the underlying MPV library.
 * In code, the PlaybackEventMessage type alias can be used for better semantics.
 */
struct MPVEventMessage {
    mpv_event_id event_id;        // Event type
    std::string property_name;     // For PROPERTY_CHANGE event: property name
    mpv_format property_format;    // Data format
    double double_value;           // For MPV_FORMAT_DOUBLE
    int64_t int_value;            // For MPV_FORMAT_INT64
    int flag_value;               // For MPV_FORMAT_FLAG
    std::string log_prefix;       // For LOG_MESSAGE event: log prefix
    std::string log_level;         // For LOG_MESSAGE event: log level
    std::string log_text;          // For LOG_MESSAGE event: log text
    int end_file_reason;           // For END_FILE event: end reason
    int end_file_error;            // For END_FILE event: error code
    bool has_end_file;             // Whether end file info is present
    
    MPVEventMessage()
        : event_id(MPV_EVENT_NONE),
          property_format(MPV_FORMAT_NONE),
          double_value(0.0),
          int_value(0),
          flag_value(0),
          end_file_reason(0),
          end_file_error(0),
          has_end_file(false) {}
};

// Semantic type alias: use PlaybackEventMessage for better semantics
using PlaybackEventMessage = MPVEventMessage;

// ==================== Global State ====================
static std::map<int64_t, MPVInstance*> instances;
static std::mutex instancesMutex;
static int64_t nextInstanceId = 1;

/**
 * Find instance under instancesMutex and execute fn(inst).
 * Throws an error to env if not found or ctx is invalid, returns false.
 */
template<typename F>
static bool withInstance(Napi::Env env, int64_t id, F fn) {
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return false;
    }
    fn(it->second);
    return true;
}

/**
 * Find instance and execute fn under lock; returns false if not found or ctx is invalid (no error thrown).
 * Used for calls where the instance is not required to exist (e.g., Windows SetWindowSize).
 */
template<typename F>
static bool withInstanceIf(int64_t id, F fn) {
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) return false;
    fn(it->second);
    return true;
}

// ==================== Event Loop ====================
/**
 * Event loop thread function
 *
 * Runs in a separate thread, listens for MPV events and passes them to JavaScript via ThreadSafeFunction.
 *
 * @param instance Player instance
 */
void eventLoop(MPVInstance* instance) {
    while (instance->running && instance->ctx) {
        mpv_event* event = mpv_wait_event(instance->ctx, 1.0);
        if (event->event_id == MPV_EVENT_NONE) {
            continue;
        }
        
        // Construct event message
        MPVEventMessage* msg = new MPVEventMessage();
        msg->event_id = event->event_id;
        
        if (event->event_id == MPV_EVENT_PROPERTY_CHANGE && event->data) {
            mpv_event_property* prop = static_cast<mpv_event_property*>(event->data);
            if (prop->name) {
                msg->property_name = prop->name;
            }
            msg->property_format = prop->format;
            
            if (prop->format == MPV_FORMAT_DOUBLE && prop->data) {
                msg->double_value = *static_cast<double*>(prop->data);
            } else if (prop->format == MPV_FORMAT_INT64 && prop->data) {
                msg->int_value = *static_cast<int64_t*>(prop->data);
            } else if (prop->format == MPV_FORMAT_FLAG && prop->data) {
                msg->flag_value = *static_cast<int*>(prop->data);
            }
        } else if (event->event_id == MPV_EVENT_LOG_MESSAGE && event->data) {
            mpv_event_log_message* log_msg = static_cast<mpv_event_log_message*>(event->data);
            if (log_msg->prefix) {
                msg->log_prefix = log_msg->prefix;
            }
            if (log_msg->level) {
                msg->log_level = log_msg->level;
            }
            if (log_msg->text) {
                msg->log_text = log_msg->text;
            }
        } else if (event->event_id == MPV_EVENT_END_FILE && event->data) {
            mpv_event_end_file* eef = static_cast<mpv_event_end_file*>(event->data);
            msg->end_file_reason = static_cast<int>(eef->reason);
            msg->end_file_error = static_cast<int>(eef->error);
            msg->has_end_file = true;
        }
        
        // Send event to main thread via ThreadSafeFunction (non-blocking, avoid deadlock on exit)
        auto callback = [](Napi::Env env, Napi::Function jsCallback, MPVEventMessage* msg) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("eventId", Napi::Number::New(env, msg->event_id));
            
            if (!msg->property_name.empty()) {
                obj.Set("name", Napi::String::New(env, msg->property_name));
                obj.Set("format", Napi::Number::New(env, static_cast<int>(msg->property_format)));
                
                switch (msg->property_format) {
                    case MPV_FORMAT_DOUBLE:
                        obj.Set("value", Napi::Number::New(env, msg->double_value));
                        break;
                    case MPV_FORMAT_INT64:
                        obj.Set("value", Napi::Number::New(env, static_cast<double>(msg->int_value)));
                        break;
                    case MPV_FORMAT_FLAG:
                        obj.Set("value", Napi::Boolean::New(env, msg->flag_value != 0));
                        break;
                    default:
                        break;
                }
            }
            
            // Handle log messages
            if (!msg->log_prefix.empty() || !msg->log_text.empty()) {
                obj.Set("logPrefix", Napi::String::New(env, msg->log_prefix));
                obj.Set("logLevel", Napi::String::New(env, msg->log_level));
                obj.Set("logText", Napi::String::New(env, msg->log_text));
            }

            if (msg->has_end_file) {
                obj.Set("endFileReason", Napi::Number::New(env, msg->end_file_reason));
                obj.Set("endFileError", Napi::Number::New(env, msg->end_file_error));
            }
            
            jsCallback.Call({obj});
            delete msg;
        };
        
        // Use local variables to save tsfn and hasTsfn, avoid race between check and use by other threads
        bool hasTsfn = instance->hasTsfn;
        if (hasTsfn) {
            // Re-check running to ensure we don't continue using tsfn after it is released
            if (!instance->running) {
                delete msg;
                break;
            }
            napi_status s = instance->tsfn.NonBlockingCall(msg, callback);
            if (s != napi_ok) {
                // JS side has exited or queue is full, discard event to avoid stalling
                delete msg;
            }
        } else {
            delete msg;
        }
        
        if (event->event_id == MPV_EVENT_SHUTDOWN) {
            break;
        }
    }
}

// ==================== Public API Functions ====================
/**
 * Attach view and create rendering context
 *
 * macOS: Create OpenGL render context and render layer
 * Windows: Set window ID (wid) for embedding
 *
 * @param info N-API callback info
 * @return undefined
 */
Napi::Value AttachView(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, viewPtr: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int64_t viewPtr = info[1].As<Napi::Number>().Int64Value();
    
    bool done = false;
    if (!withInstance(env, id, [&](MPVInstance* inst) {
#ifdef __APPLE__
        if (inst->glCtx) {
            mpv_destroy_gl_context(id);
            inst->glCtx = nullptr;
        }
        inst->glCtx = mpv_create_gl_context_for_view(id, (void*)viewPtr, inst->ctx);
        if (!inst->glCtx) {
            Napi::Error::New(env, "Failed to create GL context for view").ThrowAsJavaScriptException();
            return;
        }
        mpv_set_force_black_mode(id, 1);
#elif defined(_WIN32)
        int err = mpv_set_option(inst->ctx, "wid", MPV_FORMAT_INT64, &viewPtr);
        if (err < 0) {
            Napi::Error::New(env, std::string("Failed to set window ID: ") + mpv_error_string(err))
                .ThrowAsJavaScriptException();
            return;
        }
#endif
        done = true;
    })) return env.Null();
    if (!done) return env.Null();
    
    return env.Undefined();
}

/**
 * Set render viewport size
 *
 * Called when window size changes, updates the pixel size of the render viewport.
 *
 * @param info N-API callback info
 * @return undefined
 */
Napi::Value SetWindowSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, width: number, height: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    
#ifdef __APPLE__
    mpv_set_window_size(id, width, height);
#elif defined(_WIN32)
    // Windows uses wid mode, MPV automatically adapts to window size; trigger redraw via window-scale + show-text.
    // Note: show-text is a workaround since mpv has no dedicated “refresh viewport” API, replacable if a future version provides a better way.
    withInstanceIf(id, [](MPVInstance* inst) {
        if (!inst->running) return;
        mpv_handle* ctx = inst->ctx;
        double scale = 1.0;
        mpv_set_property(ctx, "window-scale", MPV_FORMAT_DOUBLE, &scale);
        const char* cmd[] = { "show-text", " ", NULL };
        mpv_command(ctx, cmd);
    });
#endif
    
    return env.Undefined();
}

Napi::Value SetForceBlackMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();
    
#ifdef __APPLE__
    mpv_set_force_black_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows uses wid mode, does not support force black mode
    // Can be ignored or implemented through other means
#endif
    
    return env.Undefined();
}

Napi::Value SetHdrMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();
    
#ifdef __APPLE__
    mpv_set_hdr_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows uses wid mode, HDR can be set via mpv options
    // Relevant options can be set here, but need adjustment based on actual requirements
    // Ignored for now, can be extended later
#endif
    
    return env.Undefined();
}

Napi::Value SetJsDrivenRenderMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();
    
#ifdef __APPLE__
    mpv_set_js_driven_render_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows does not yet support JavaScript-driven render mode
#endif
    
    return env.Undefined();
}

Napi::Value GetJsDrivenRenderMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();
    
#ifdef __APPLE__
    int enabled = mpv_get_js_driven_render_mode(id);
    return Napi::Boolean::New(env, enabled != 0);
#elif defined(_WIN32)
    // Windows does not yet support JavaScript-driven render mode
    return Napi::Boolean::New(env, false);
#endif
}

Napi::Value RequestRender(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();
    
#ifdef __APPLE__
    mpv_request_render(id);
#elif defined(_WIN32)
    // Windows does not yet support JavaScript-driven render mode
#endif
    
    return env.Undefined();
}

Napi::Value DebugHdrStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t id = info[0].As<Napi::Number>().Int64Value();

    if (!withInstance(env, id, [](MPVInstance*) {})) return env.Null();

#ifdef __APPLE__
    mpv_debug_hdr_status(id);
#elif defined(_WIN32)
    // Windows uses wid mode, HDR debug feature not yet supported
#endif

    return env.Undefined();
}

/**
 * Create a player instance
 *
 * Creates an MPV instance but does not initialize immediately, allowing options to be set first.
 * The caller needs to manually call the initialize() method.
 *
 * @param info N-API callback info
 * @return Instance ID (number)
 */
Napi::Value Create(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    mpv_handle* ctx = mpv_create();
    if (!ctx) {
        Napi::Error::New(env, "Failed to create mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Do not initialize immediately, allow options to be set first
    // The caller needs to manually call the initialize() method
    
    MPVInstance* instance = new MPVInstance();
    instance->ctx = ctx;
    instance->running = false; // Not initialized, do not run event loop
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    int64_t id = nextInstanceId++;
    instances[id] = instance;
    
    return Napi::Number::New(env, id);
}

/**
 * Initialize the player instance
 *
 * Initializes the MPV instance, starts the event loop, and sets up property observation.
 *
 * @param info N-API callback info
 * @return true on success
 */
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    if (!withInstance(env, id, [&env](MPVInstance* instance) {
        if (instance->running) {
            Napi::Error::New(env, "MPV instance already initialized").ThrowAsJavaScriptException();
            return;
        }
        int err = mpv_initialize(instance->ctx);
        if (err < 0) {
            Napi::Error::New(env, std::string("Failed to initialize mpv: ") + mpv_error_string(err))
                .ThrowAsJavaScriptException();
            return;
        }
        mpv_request_log_messages(instance->ctx, "v");
        mpv_observe_property(instance->ctx, 0, "pause", MPV_FORMAT_FLAG);
        mpv_observe_property(instance->ctx, 0, "time-pos", MPV_FORMAT_DOUBLE);
        mpv_observe_property(instance->ctx, 0, "duration", MPV_FORMAT_DOUBLE);
        mpv_observe_property(instance->ctx, 0, "volume", MPV_FORMAT_DOUBLE);
        mpv_observe_property(instance->ctx, 0, "core-idle", MPV_FORMAT_FLAG);
        mpv_observe_property(instance->ctx, 0, "idle-active", MPV_FORMAT_FLAG);
        mpv_observe_property(instance->ctx, 0, "paused-for-cache", MPV_FORMAT_FLAG);
        mpv_observe_property(instance->ctx, 0, "cache-buffering-state", MPV_FORMAT_INT64);
        mpv_observe_property(instance->ctx, 0, "estimated-vf-fps", MPV_FORMAT_DOUBLE);
        mpv_observe_property(instance->ctx, 0, "speed", MPV_FORMAT_DOUBLE);
        mpv_observe_property(instance->ctx, 0, "chapter-list", MPV_FORMAT_NONE); // Notify on change only, renderer pulls again
        mpv_observe_property(instance->ctx, 0, "demuxer-cache-state", MPV_FORMAT_NONE);
        instance->running = true;
    })) return env.Null();
    
    return Napi::Boolean::New(env, true);
}

// Set options (must be called before initialization)
Napi::Value SetOption(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string, value: any)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();
    
    mpv_handle* ctx = nullptr;
    bool running = false;
    if (!withInstance(env, id, [&](MPVInstance* inst) { ctx = inst->ctx; running = inst->running; })) return env.Null();
    if (running) {
        Napi::Error::New(env, "Options can only be set before initialization")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    int err;
    
    if (info[2].IsString()) {
        std::string value = info[2].As<Napi::String>().Utf8Value();
        err = mpv_set_option_string(ctx, name.c_str(), value.c_str());
    } else if (info[2].IsNumber()) {
        int64_t value = info[2].As<Napi::Number>().Int64Value();
        err = mpv_set_option(ctx, name.c_str(), MPV_FORMAT_INT64, &value);
    } else if (info[2].IsBoolean()) {
        int flag = info[2].As<Napi::Boolean>().Value() ? 1 : 0;
        err = mpv_set_option(ctx, name.c_str(), MPV_FORMAT_FLAG, &flag);
    } else {
        Napi::TypeError::New(env, "Unsupported value type").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set option: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// Set window ID (for embedding)
Napi::Value SetWindowId(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, windowId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int64_t windowId = info[1].As<Napi::Number>().Int64Value();
    
    mpv_handle* ctx = nullptr;
    if (!withInstance(env, id, [&ctx](MPVInstance* inst) { ctx = inst->ctx; })) return env.Null();
    
    // On Windows, wid must be a valid HWND; wid must be set before mpv_initialize()
    int err = mpv_set_option(ctx, "wid", MPV_FORMAT_INT64, &windowId);
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set window ID (wid): ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    return Napi::Boolean::New(env, true);
}

// Load file
Napi::Value LoadFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, path: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string path = info[1].As<Napi::String>().Utf8Value();
    
    mpv_handle* ctx = nullptr;
    if (!withInstance(env, id, [&ctx](MPVInstance* inst) { ctx = inst->ctx; })) return env.Null();
    
    const char* args[] = {"loadfile", path.c_str(), "replace", nullptr};
    int err = mpv_command(ctx, args);
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to load file: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// Recursive mpv_node to Napi::Value conversion
static Napi::Value mpvNodeToNapi(Napi::Env env, const mpv_node& node) {
    switch (node.format) {
        case MPV_FORMAT_STRING:
            return node.u.string
                ? Napi::String::New(env, node.u.string)
                : env.Null();
        case MPV_FORMAT_FLAG:
            return Napi::Boolean::New(env, node.u.flag != 0);
        case MPV_FORMAT_INT64:
            return Napi::Number::New(env, static_cast<double>(node.u.int64));
        case MPV_FORMAT_DOUBLE:
            return Napi::Number::New(env, node.u.double_);
        case MPV_FORMAT_NODE_ARRAY: {
            auto* list = node.u.list;
            Napi::Array arr = Napi::Array::New(env, list ? list->num : 0);
            if (list) {
                for (int i = 0; i < list->num; i++) {
                    arr.Set(static_cast<uint32_t>(i), mpvNodeToNapi(env, list->values[i]));
                }
            }
            return arr;
        }
        case MPV_FORMAT_NODE_MAP: {
            auto* list = node.u.list;
            Napi::Object obj = Napi::Object::New(env);
            if (list) {
                for (int i = 0; i < list->num; i++) {
                    if (list->keys[i]) {
                        obj.Set(list->keys[i], mpvNodeToNapi(env, list->values[i]));
                    }
                }
            }
            return obj;
        }
        case MPV_FORMAT_BYTE_ARRAY: {
            auto* ba = node.u.ba;
            if (ba && ba->data && ba->size > 0) {
                return Napi::Buffer<char>::Copy(env, static_cast<char*>(ba->data), ba->size);
            }
            return env.Null();
        }
        default:
            return env.Null();
    }
}

// Get property
Napi::Value GetProperty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();

    mpv_handle* ctx = nullptr;
    if (!withInstance(env, id, [&ctx](MPVInstance* inst) { ctx = inst->ctx; })) return env.Null();

    // Use MPV_FORMAT_NODE to get property, mpv automatically returns the most appropriate type
    // Supports string / int64 / double / flag / array / map, covers all types in one call
    mpv_node node;
    if (mpv_get_property(ctx, name.c_str(), MPV_FORMAT_NODE, &node) >= 0) {
        Napi::Value result = mpvNodeToNapi(env, node);
        mpv_free_node_contents(&node);
        return result;
    }

    return env.Null();
}

// Set property
Napi::Value SetProperty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string, value: any)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();
    
    mpv_handle* ctx = nullptr;
    if (!withInstance(env, id, [&ctx](MPVInstance* inst) { ctx = inst->ctx; })) return env.Null();
    
    // Use mpv_set_property_string uniformly, let mpv parse into the correct internal type
    // This avoids heuristic determination issues with JS number to int64/double
    int err;
    if (info[2].IsBoolean()) {
        // Booleans must use FLAG format, mpv_set_property_string does not accept "true"/"false"
        int flag = info[2].As<Napi::Boolean>().Value() ? 1 : 0;
        err = mpv_set_property(ctx, name.c_str(), MPV_FORMAT_FLAG, &flag);
    } else if (info[2].IsNumber()) {
        // Numbers are uniformly sent in DOUBLE format, mpv internally truncates to integer (if property is integer type)
        double dval = info[2].As<Napi::Number>().DoubleValue();
        err = mpv_set_property(ctx, name.c_str(), MPV_FORMAT_DOUBLE, &dval);
    } else if (info[2].IsString()) {
        std::string value = info[2].As<Napi::String>().Utf8Value();
        err = mpv_set_property_string(ctx, name.c_str(), value.c_str());
    } else {
        Napi::TypeError::New(env, "Unsupported value type").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set property: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// Execute command
Napi::Value Command(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, args: string[])")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    Napi::Array arr = info[1].As<Napi::Array>();
    
    mpv_handle* ctx = nullptr;
    if (!withInstance(env, id, [&ctx](MPVInstance* inst) { ctx = inst->ctx; })) return env.Null();
    
    std::vector<std::string> args;
    std::vector<const char*> cArgs;
    
    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value val = arr[i];
        if (val.IsString()) {
            args.push_back(val.As<Napi::String>().Utf8Value());
        }
    }
    
    for (const auto& arg : args) {
        cArgs.push_back(arg.c_str());
    }
    cArgs.push_back(nullptr);
    
    // "stop" uses mpv_command_async to avoid blocking the Node.js main thread.
    // Blu-ray ISO with disk cache can take hundreds of ms to flush/unlink.
    // synchronous stop causes macOS beach ball.
    // Other commands (seek, pause, loadfile) are fast and stay synchronous.
    bool isStop = (!args.empty() && args[0] == "stop");
    if (isStop) {
        int err = mpv_command_async(ctx, 0, cArgs.data());
        if (err < 0) {
            Napi::Error::New(env, std::string("Async command failed: ") + mpv_error_string(err))
                .ThrowAsJavaScriptException();
            return env.Null();
        }
        return Napi::Boolean::New(env, true);
    }

    int err = mpv_command(ctx, cArgs.data());

    if (err < 0) {
        Napi::Error::New(env, std::string("Command failed: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Boolean::New(env, true);
}

// Set event callback
Napi::Value SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, callback: function)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    Napi::Function callback = info[1].As<Napi::Function>();
    
    if (!withInstance(env, id, [&](MPVInstance* instance) {
        if (instance->hasTsfn) {
            instance->tsfn.Release();
            instance->hasTsfn = false;
        }
        instance->tsfn = Napi::ThreadSafeFunction::New(
            env,
            callback,
            "MPV Event Callback",
            0,
            1,
            [](Napi::Env) {}
        );
        instance->hasTsfn = true;
        if (!instance->eventThread.joinable()) {
            instance->eventThread = std::thread(eventLoop, instance);
        }
    })) return env.Null();
    
    return Napi::Boolean::New(env, true);
}

// Destroy instance (perform heavy teardown in a background thread to avoid blocking the JS main thread)
Napi::Value Destroy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    MPVInstance* instance = nullptr;
    {
        std::lock_guard<std::mutex> lock(instancesMutex);
        auto it = instances.find(id);
        if (it == instances.end()) {
            Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        instance = it->second;
        // Remove from global table, subsequent lifecycle is managed by the background thread
        instances.erase(it);
    }
    
    // Perform the actual teardown in a background thread (stop event loop, join, mpv_terminate_destroy),
    // avoid synchronous blocking on the JS main thread that would freeze the window.
    std::thread([instance, id]() {
        if (!instance) return;
        
        // Release ThreadSafeFunction first, ensure eventLoop thread stops using it
        // Must release before stopping event loop to avoid race conditions
        if (instance->hasTsfn) {
            instance->tsfn.Release();
            instance->hasTsfn = false;
        }
        
        // Stop event loop
        instance->running = false;
        if (instance->ctx) {
            mpv_wakeup(instance->ctx);
        }
        
        // Wait for event thread to exit naturally
        if (instance->eventThread.joinable()) {
            instance->eventThread.join();
        }

        // Destroy render context (macOS only)
#ifdef __APPLE__
        mpv_destroy_gl_context(id);
#endif
        
        // Destroy mpv instance
        if (instance->ctx) {
            mpv_terminate_destroy(instance->ctx);
            instance->ctx = nullptr;
        }
        
        delete instance;
    }).detach();
    
    return Napi::Boolean::New(env, true);
}

// ==================== Module Initialization ====================
/**
 * Initialize the Node.js module
 *
 * Registers all public API functions on the exports object.
 *
 * @param env N-API environment
 * @param exports Exports object
 * @return exports object
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "create"), Napi::Function::New(env, Create));
    exports.Set(Napi::String::New(env, "initialize"), Napi::Function::New(env, Initialize));
    exports.Set(Napi::String::New(env, "setOption"), Napi::Function::New(env, SetOption));
    exports.Set(Napi::String::New(env, "setWindowId"), Napi::Function::New(env, SetWindowId));
    exports.Set(Napi::String::New(env, "loadFile"), Napi::Function::New(env, LoadFile));
    exports.Set(Napi::String::New(env, "getProperty"), Napi::Function::New(env, GetProperty));
    exports.Set(Napi::String::New(env, "setProperty"), Napi::Function::New(env, SetProperty));
    exports.Set(Napi::String::New(env, "command"), Napi::Function::New(env, Command));
    exports.Set(Napi::String::New(env, "setEventCallback"), Napi::Function::New(env, SetEventCallback));
    exports.Set(Napi::String::New(env, "destroy"), Napi::Function::New(env, Destroy));
    exports.Set(Napi::String::New(env, "attachView"), Napi::Function::New(env, AttachView));
    // renderFrame is deprecated: rendering is now fully driven by CVDisplayLink
    exports.Set(Napi::String::New(env, "setWindowSize"), Napi::Function::New(env, SetWindowSize));
    exports.Set(Napi::String::New(env, "setForceBlackMode"), Napi::Function::New(env, SetForceBlackMode));
    exports.Set(Napi::String::New(env, "setHdrMode"), Napi::Function::New(env, SetHdrMode));
    exports.Set(Napi::String::New(env, "debugHdrStatus"), Napi::Function::New(env, DebugHdrStatus));
    exports.Set(Napi::String::New(env, "setJsDrivenRenderMode"), Napi::Function::New(env, SetJsDrivenRenderMode));
    exports.Set(Napi::String::New(env, "getJsDrivenRenderMode"), Napi::Function::New(env, GetJsDrivenRenderMode));
    exports.Set(Napi::String::New(env, "requestRender"), Napi::Function::New(env, RequestRender));
#ifdef __APPLE__
    exports.Set(Napi::String::New(env, "generateThumbnail"), Napi::Function::New(env, GenerateThumbnail));
    exports.Set(Napi::String::New(env, "generateThumbnailStrip"), Napi::Function::New(env, GenerateThumbnailStrip));
    exports.Set(Napi::String::New(env, "exportAnimatedImage"), Napi::Function::New(env, ExportAnimatedImage));
    exports.Set(Napi::String::New(env, "cancelAnimatedImageExport"), Napi::Function::New(env, CancelAnimatedImageExport));
    exports.Set(Napi::String::New(env, "thumbSeekInit"), Napi::Function::New(env, ThumbSeekInit));
    exports.Set(Napi::String::New(env, "thumbSeekAt"), Napi::Function::New(env, ThumbSeekAt));
    exports.Set(Napi::String::New(env, "thumbSeekDestroy"), Napi::Function::New(env, ThumbSeekDestroy));
#endif

    return exports;
}

NODE_API_MODULE(mpv_binding, Init)
