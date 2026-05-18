/**
 * AsyncWorker subclasses (separated from binding.cc)
 *
 * Offloads CPU-intensive thumbnail/animation generation to the libuv thread pool,
 * returning results to JavaScript via Promise.
 */

#include <napi.h>
#include <string>

#ifdef __APPLE__

// ── External C function declarations (from mpv_thumbnail.mm / mpv_anim_export.mm) ──
extern "C" bool mpv_generate_thumbnail(const char *video_path,
                                       const char *output_path,
                                       double seek_percent,
                                       int thumb_width);
extern "C" bool mpv_generate_thumbnail_strip(const char *video_path,
                                             const char *output_path,
                                             int thumb_width,
                                             int thumb_height,
                                             int count,
                                             double duration);
extern "C" bool mpv_thumb_seek_init(const char *video_path, int thumb_width, int thumb_height);
extern "C" bool mpv_thumb_seek_at(double time_sec, const char *output_path);
extern "C" void mpv_thumb_seek_destroy();

extern "C" bool mpv_export_gif(
    const char *video_path, const char *output_path,
    double start_time, double end_time,
    int fps, int output_width, int output_height,
    int quality,
    void (*progress_callback)(int, int, void *),
    void *callback_ctx, volatile bool *cancel_flag
);

// Global cancel flag (only one export task at a time)
static volatile bool g_gif_cancel = false;

// ==================== Thumbnail Generation (Async) ====================
class ThumbnailWorker : public Napi::AsyncWorker {
public:
    ThumbnailWorker(Napi::Env env, napi_deferred deferred,
                    std::string videoPath, std::string outputPath,
                    double seekPercent, int thumbWidth)
        : Napi::AsyncWorker(env), deferred_(deferred),
          videoPath_(std::move(videoPath)), outputPath_(std::move(outputPath)),
          seekPercent_(seekPercent), thumbWidth_(thumbWidth), success_(false) {}

    void Execute() override {
        success_ = mpv_generate_thumbnail(
            videoPath_.c_str(), outputPath_.c_str(),
            seekPercent_, thumbWidth_
        );
    }

    void OnOK() override {
        // Use raw napi calls to avoid fatal ThrowAsJavaScriptException crash
        // when the JS environment is already torn down during app shutdown.
        napi_env env = Env();
        napi_value result;
        if (napi_get_boolean(env, success_, &result) != napi_ok) return;
        napi_resolve_deferred(env, deferred_, result);
    }

    void OnError(const Napi::Error& error) override {
        napi_env env = Env();
        napi_value errMsg;
        if (napi_create_string_utf8(env, error.Message().c_str(),
                                    NAPI_AUTO_LENGTH, &errMsg) != napi_ok) return;
        napi_reject_deferred(env, deferred_, errMsg);
    }

private:
    napi_deferred deferred_;
    std::string videoPath_;
    std::string outputPath_;
    double seekPercent_;
    int thumbWidth_;
    bool success_;
};

Napi::Value GenerateThumbnail(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 || !info[0].IsString() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsNumber()) {
        Napi::TypeError::New(env,
            "Expected (videoPath: string, outputPath: string, seekPercent: number, thumbWidth: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string videoPath  = info[0].As<Napi::String>().Utf8Value();
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();
    double seekPercent     = info[2].As<Napi::Number>().DoubleValue();
    int thumbWidth         = info[3].As<Napi::Number>().Int32Value();

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    auto *worker = new ThumbnailWorker(
        env, deferred, videoPath, outputPath, seekPercent, thumbWidth
    );
    worker->Queue();

    return Napi::Value(env, promise);
}

// ==================== Sprite Sheet Thumbnail Strip Generation (Async) ====================

class ThumbnailStripWorker : public Napi::AsyncWorker {
public:
    ThumbnailStripWorker(Napi::Env env, napi_deferred deferred,
                         std::string videoPath, std::string outputPath,
                         int thumbWidth, int thumbHeight, int count, double duration)
        : Napi::AsyncWorker(env), deferred_(deferred),
          videoPath_(std::move(videoPath)), outputPath_(std::move(outputPath)),
          thumbWidth_(thumbWidth), thumbHeight_(thumbHeight),
          count_(count), duration_(duration), success_(false) {}

    void Execute() override {
        success_ = mpv_generate_thumbnail_strip(
            videoPath_.c_str(), outputPath_.c_str(),
            thumbWidth_, thumbHeight_, count_, duration_
        );
    }

    void OnOK() override {
        napi_env env = Env();
        napi_value result;
        if (napi_get_boolean(env, success_, &result) != napi_ok) return;
        napi_resolve_deferred(env, deferred_, result);
    }

    void OnError(const Napi::Error& error) override {
        napi_env env = Env();
        napi_value errMsg;
        if (napi_create_string_utf8(env, error.Message().c_str(),
                                    NAPI_AUTO_LENGTH, &errMsg) != napi_ok) return;
        napi_reject_deferred(env, deferred_, errMsg);
    }

private:
    napi_deferred deferred_;
    std::string videoPath_;
    std::string outputPath_;
    int thumbWidth_;
    int thumbHeight_;
    int count_;
    double duration_;
    bool success_;
};

Napi::Value GenerateThumbnailStrip(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 6 ||
        !info[0].IsString() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsNumber() ||
        !info[4].IsNumber() || !info[5].IsNumber()) {
        Napi::TypeError::New(env,
            "Expected (videoPath: string, outputPath: string, "
            "thumbWidth: number, thumbHeight: number, count: number, duration: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string videoPath  = info[0].As<Napi::String>().Utf8Value();
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();
    int thumbWidth         = info[2].As<Napi::Number>().Int32Value();
    int thumbHeight        = info[3].As<Napi::Number>().Int32Value();
    int count              = info[4].As<Napi::Number>().Int32Value();
    double duration        = info[5].As<Napi::Number>().DoubleValue();

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    auto *worker = new ThumbnailStripWorker(
        env, deferred, videoPath, outputPath,
        thumbWidth, thumbHeight, count, duration
    );
    worker->Queue();

    return Napi::Value(env, promise);
}

// ==================== GIF Export (Async + Progress Callback) ====================

class GifExportWorker : public Napi::AsyncWorker {
public:
    GifExportWorker(Napi::Env env, napi_deferred deferred,
                    std::string videoPath, std::string outputPath,
                    double startTime, double endTime,
                    int fps, int outputWidth, int outputHeight,
                    int quality,
                    Napi::ThreadSafeFunction tsfn)
        : Napi::AsyncWorker(env), deferred_(deferred),
          videoPath_(std::move(videoPath)), outputPath_(std::move(outputPath)),
          startTime_(startTime), endTime_(endTime),
          fps_(fps), outputWidth_(outputWidth), outputHeight_(outputHeight),
          quality_(quality), tsfn_(std::move(tsfn)), success_(false) {
        g_gif_cancel = false;
    }

    void Execute() override {
        success_ = mpv_export_gif(
            videoPath_.c_str(), outputPath_.c_str(),
            startTime_, endTime_, fps_,
            outputWidth_, outputHeight_, quality_,
            &GifExportWorker::progressAdapter, (void *)&tsfn_,
            &g_gif_cancel
        );
    }

    void OnOK() override {
        tsfn_.Release();
        napi_env env = Env();
        napi_value result;
        if (napi_get_boolean(env, success_, &result) != napi_ok) return;
        napi_resolve_deferred(env, deferred_, result);
    }

    void OnError(const Napi::Error& error) override {
        tsfn_.Release();
        napi_env env = Env();
        napi_value errMsg;
        if (napi_create_string_utf8(env, error.Message().c_str(),
                                    NAPI_AUTO_LENGTH, &errMsg) != napi_ok) return;
        napi_reject_deferred(env, deferred_, errMsg);
    }

private:
    static void progressAdapter(int current, int total, void *ctx) {
        auto *tsfn = static_cast<Napi::ThreadSafeFunction *>(ctx);
        // Progress data: [current, total]
        int *data = new int[2]{current, total};
        tsfn->NonBlockingCall(data, [](Napi::Env env, Napi::Function jsCallback, int *data) {
            jsCallback.Call({
                Napi::Number::New(env, data[0]),
                Napi::Number::New(env, data[1])
            });
            delete[] data;
        });
    }

    napi_deferred deferred_;
    std::string videoPath_;
    std::string outputPath_;
    double startTime_, endTime_;
    int fps_, outputWidth_, outputHeight_, quality_;
    Napi::ThreadSafeFunction tsfn_;
    bool success_;
};

Napi::Value ExportAnimatedImage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // args: videoPath, outputPath, startTime, endTime, fps, width, height, quality, progressCallback
    if (info.Length() < 9 ||
        !info[0].IsString() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsNumber() ||
        !info[4].IsNumber() || !info[5].IsNumber() ||
        !info[6].IsNumber() || !info[7].IsNumber() || !info[8].IsFunction()) {
        Napi::TypeError::New(env,
            "Expected (videoPath, outputPath, startTime, endTime, fps, width, height, quality, progressCallback)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string videoPath  = info[0].As<Napi::String>().Utf8Value();
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();
    double startTime       = info[2].As<Napi::Number>().DoubleValue();
    double endTime         = info[3].As<Napi::Number>().DoubleValue();
    int fps                = info[4].As<Napi::Number>().Int32Value();
    int outputWidth        = info[5].As<Napi::Number>().Int32Value();
    int outputHeight       = info[6].As<Napi::Number>().Int32Value();
    int quality            = info[7].As<Napi::Number>().Int32Value();
    Napi::Function progressCb = info[8].As<Napi::Function>();

    auto tsfn = Napi::ThreadSafeFunction::New(
        env, progressCb, "GIF Export Progress", 0, 1, [](Napi::Env) {}
    );

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    auto *worker = new GifExportWorker(
        env, deferred, videoPath, outputPath,
        startTime, endTime, fps, outputWidth, outputHeight,
        quality, std::move(tsfn)
    );
    worker->Queue();

    return Napi::Value(env, promise);
}

Napi::Value CancelAnimatedImageExport(const Napi::CallbackInfo& info) {
    g_gif_cancel = true;
    return info.Env().Undefined();
}

// ==================== Persistent Seek Thumbnail (On-Demand Generation) ====================

class ThumbSeekInitWorker : public Napi::AsyncWorker {
public:
    ThumbSeekInitWorker(Napi::Env env, napi_deferred deferred,
                        std::string videoPath, int thumbWidth, int thumbHeight)
        : Napi::AsyncWorker(env), deferred_(deferred),
          videoPath_(std::move(videoPath)),
          thumbWidth_(thumbWidth), thumbHeight_(thumbHeight),
          success_(false) {}

    void Execute() override {
        success_ = mpv_thumb_seek_init(videoPath_.c_str(), thumbWidth_, thumbHeight_);
    }

    void OnOK() override {
        napi_env env = Env();
        napi_value result;
        if (napi_get_boolean(env, success_, &result) != napi_ok) return;
        napi_resolve_deferred(env, deferred_, result);
    }

    void OnError(const Napi::Error& error) override {
        napi_env env = Env();
        napi_value errMsg;
        if (napi_create_string_utf8(env, error.Message().c_str(),
                                    NAPI_AUTO_LENGTH, &errMsg) != napi_ok) return;
        napi_reject_deferred(env, deferred_, errMsg);
    }

private:
    napi_deferred deferred_;
    std::string videoPath_;
    int thumbWidth_;
    int thumbHeight_;
    bool success_;
};

Napi::Value ThumbSeekInit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsString() ||
        !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env,
            "Expected (videoPath: string, thumbWidth: number, thumbHeight: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string videoPath = info[0].As<Napi::String>().Utf8Value();
    int thumbWidth        = info[1].As<Napi::Number>().Int32Value();
    int thumbHeight       = info[2].As<Napi::Number>().Int32Value();

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    auto *worker = new ThumbSeekInitWorker(env, deferred, videoPath, thumbWidth, thumbHeight);
    worker->Queue();

    return Napi::Value(env, promise);
}

class ThumbSeekAtWorker : public Napi::AsyncWorker {
public:
    ThumbSeekAtWorker(Napi::Env env, napi_deferred deferred,
                      double timeSec, std::string outputPath)
        : Napi::AsyncWorker(env), deferred_(deferred),
          timeSec_(timeSec), outputPath_(std::move(outputPath)),
          success_(false) {}

    void Execute() override {
        success_ = mpv_thumb_seek_at(timeSec_, outputPath_.c_str());
    }

    void OnOK() override {
        napi_env env = Env();
        napi_value result;
        if (napi_get_boolean(env, success_, &result) != napi_ok) return;
        napi_resolve_deferred(env, deferred_, result);
    }

    void OnError(const Napi::Error& error) override {
        napi_env env = Env();
        napi_value errMsg;
        if (napi_create_string_utf8(env, error.Message().c_str(),
                                    NAPI_AUTO_LENGTH, &errMsg) != napi_ok) return;
        napi_reject_deferred(env, deferred_, errMsg);
    }

private:
    napi_deferred deferred_;
    double timeSec_;
    std::string outputPath_;
    bool success_;
};

Napi::Value ThumbSeekAt(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env,
            "Expected (timeSec: number, outputPath: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    double timeSec         = info[0].As<Napi::Number>().DoubleValue();
    std::string outputPath = info[1].As<Napi::String>().Utf8Value();

    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    auto *worker = new ThumbSeekAtWorker(env, deferred, timeSec, outputPath);
    worker->Queue();

    return Napi::Value(env, promise);
}

Napi::Value ThumbSeekDestroy(const Napi::CallbackInfo& info) {
    mpv_thumb_seek_destroy();
    return info.Env().Undefined();
}

#endif // __APPLE__
