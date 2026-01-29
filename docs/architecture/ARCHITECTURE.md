# mpv-player Architecture

> **Note**: This document is the **Single Source of Truth** for the system architecture. All code changes must be reflected here immediately.

## 1. System Overview

**mpv-player** is a high-performance desktop media player built on **Electron**, leveraging **libmpv** via a custom **Node Native Addon** (C++/Objective-C) to deliver cinema-grade rendering (HDR/Dolby Vision) on macOS and Windows.

### 1.1 Core Value Proposition
- **Correct HDR Output**: Uses macOS `CAOpenGLLayer` with EDR (Extended Dynamic Range) support and PQ color space.
- **Modern Tech Stack**: Vue 3 Composition API + TypeScript + Electron + Node-API.
- **Robust Architecture**: Domain-Driven Design (DDD) principles with strict layering and state machine-driven logic.

---

## 2. High-Level Architecture (Architecture Diagram)

The system follows a strict **Layered Architecture**. Dependencies flow **inwards** (or downwards).

```mermaid
flowchart TB
    %% Styling
    classDef ui fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
    classDef ipc fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c
    classDef app fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
    classDef domain fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#bf360c
    classDef infra fill:#eceff1,stroke:#546e7a,stroke-width:2px,color:#263238
    classDef native fill:#263238,stroke:#000,stroke-width:2px,color:#fff

    subgraph UserInterface ["Presentation Layer (Renderer Process)"]
        direction TB
        UI_Vue[UI Components]:::ui
        UI_State[UI State & Logic]:::ui
        UI_Vue --> UI_State
    end

    subgraph CommLayer ["Communication Layer"]
        IPC[IPC Bridge / API Gateway]:::ipc
    end

    subgraph MainProcess ["Backend Logic (Main Process)"]
        direction TB
        
        subgraph AppLayer ["Application Layer"]
            App_Orch["VideoPlayerApp<br/>(Orchestrator)"]:::app
            App_Win[WindowManager]:::app
            App_Config[ConfigManager]:::app
        end

        subgraph DomainLayer ["Core Domain Layer"]
            Core_Facade["CorePlayer<br/>(Facade)"]:::domain
            Core_SM[PlayerStateMachine]:::domain
            Core_Sched[PlaybackScheduler]:::domain
            Core_Model["Domain Models<br/>(Media, Playlist)"]:::domain
        end

        subgraph InfraLayer ["Infrastructure Layer"]
            Infra_MPV["MpvMediaPlayer<br/>(Adapter)"]:::infra
            Infra_FS[FileSystemService]:::infra
            Infra_Task[TaskQueue]:::infra
        end
    end

    subgraph NativeLayer ["Native Layer (C++/Obj-C)"]
        Native_API[Node-API Binding]:::native
        Native_Lib[libmpv Core]:::native
        Native_Render[OpenGL/EDR Renderer]:::native
    end

    %% Flows
    UI_State <==>|JSON| IPC
    IPC ==>|Commands| App_Orch
    
    App_Orch --> App_Win
    App_Orch --> App_Config
    App_Orch --> Core_Facade

    Core_Facade --> Core_SM
    Core_Facade --> Core_Sched
    Core_Facade --> Infra_MPV

    Core_Sched --> Infra_Task
    
    Infra_MPV --> Native_API
    Native_API --> Native_Lib
    Native_API --> Native_Render
```

### 2.1 Key Modules Responsibilities

| Layer | Module | Responsibility |
| :--- | :--- | :--- |
| **UI** | `src/renderer` | User interaction, strictly "dumb" components driven by state from Main. |
| **Command** | `ipcHandlers` | **Router**. Exposes typed APIs (player, nas, fileSystem) and dispatches to Application Layer. |
| **Application** | `VideoPlayerApp` | **Orchestrator**. Manages Windows, Playlist, Config, and high-level user intents. |
| **Core** | `CorePlayer` | **Engine Facade**. Manages the lifecycle of the playback engine and state machine. |
| **Infrastructure** | `MpvMediaPlayer` | **Adapter**. Translates generic `MediaPlayer` commands into `libmpv` C calls. |
| **Native** | `native/` | **Bridge**. Handles the C++ <-> JS boundary and platform-specific rendering. |

---

## 3. Core Class Design (Class Diagram)

This diagram details the static structure and relationships between the main classes.

```mermaid
classDiagram
    direction TB
    
    namespace Application {
        class VideoPlayerApp {
            -corePlayer: CorePlayer
            -windowManager: WindowManager
            -configManager: ConfigManager
            -playlist: Playlist
            +createMainWindow()
            +handlePlayVideo(path)
        }
        
        class ConfigManager {
            -volume: number
            -playbackPositions: Map
            +load()
            +save()
        }

        class WindowManager {
            -windows: Map
            +createWindow(config)
            +getWindow(id)
        }
        
        class Playlist {
            -items: Array
            +add(item)
            +next()
        }
    }

    namespace CoreDomain {
        class CorePlayer {
            <<Interface>>
            +play(media)
            +getPlayerStatus()
            +setVideoWindow(win)
        }

        class CorePlayerImpl {
            -mediaPlayer: MediaPlayer
            -stateMachine: PlayerStateMachine
            -scheduler: PlaybackScheduler
            +play(media)
            +updateFromPlayerStatus()
        }

        class PlaybackScheduler {
            -queue: TaskQueue
            -stateMachine: PlayerStateMachine
            +schedule(task)
            -tryProcessNext()
        }

        class TaskQueue {
            -tasks: Array
            +enqueue(task)
            +dequeue()
            +peek()
        }
        
        class PlayerStateMachine {
            -state: InternalState
            +getState(): PlayerStatus
            +update(session)
        }
    }

    namespace Infrastructure {
        class MediaPlayer {
            <<Interface>>
            +play(media)
            +pause()
            +seek()
            +setVolume()
            +getCurrentSession()
            +onStatusChange(cb)
        }

        class MpvMediaPlayer {
            -controller: LibMPVController
            -windowId: number
            +initialize(windowId)
            +play(media)
        }
    }

    %% Relationships
    VideoPlayerApp --> CorePlayer : Owns
    VideoPlayerApp --> WindowManager : Uses
    VideoPlayerApp --> ConfigManager : Uses
    VideoPlayerApp --> Playlist : Manages
    
    CorePlayerImpl ..|> CorePlayer : Implements
    CorePlayerImpl --> PlaybackScheduler : Schedules
    CorePlayerImpl --> MediaPlayer : Reads Status
    CorePlayerImpl --> PlayerStateMachine : Updates
    
    PlaybackScheduler --> TaskQueue : Uses
    PlaybackScheduler --> PlayerStateMachine : Observes
    PlaybackScheduler --> MediaPlayer : Executes
    
    MpvMediaPlayer ..|> MediaPlayer : Implements
```

---

## 4. Execution Flows (Flowcharts & Sequence Diagrams)

### 4.1 Application Startup Flow

```mermaid
flowchart TD
    Start[main.ts: runApp] --> Bootstrap[bootstrap.ts]
    Bootstrap --> CreateCore[createCorePlayer]
    Bootstrap --> CreateApp[new VideoPlayerApp]
    Bootstrap --> SetupIPC[setupIpcHandlers]
    
    CreateApp --> LoadConfig[ConfigManager.load]
    CreateApp --> InitPlaylist[Playlist.init]
    
    Bootstrap --> CreateWin[VideoPlayerApp.createMainWindow]
    CreateWin --> WM[WindowManager.createWindow]
    WM --> ElectronWin[new BrowserWindow]
    
    Bootstrap --> ListenApp[registerAppListeners]
    ListenApp --> Ready[App Ready]
```

### 4.2 Play Video Sequence (User Interaction)

```mermaid
sequenceDiagram
    participant UI as Renderer (Vue)
    participant IPC as IPC Handler
    participant App as VideoPlayerApp
    participant Core as CorePlayer
    participant Sched as PlaybackScheduler
    participant MPV as MpvMediaPlayer
    participant Native as Native Addon

    UI->>IPC: player.playMedia(path)
    IPC->>App: handlePlayVideo(path)
    
    rect rgb(240, 248, 255)
    note right of App: Window Preparation
    App->>App: Check if video window exists
    App->>App: create/focus VideoWindow
    App->>Core: setVideoWindow(win)
    Core->>MPV: setWindowId(win.id)
    end
    
    App->>Core: ensureMediaPlayerReady()
    
    App->>UI: broadcast('play-video-start')
    
    App->>Core: play(Media)
    Core->>Sched: schedule('play')
    Sched->>Core: execute()
    Core->>MPV: play(Media)
    MPV->>Native: command("loadfile", path)
    
    loop Playback Loop
        Native->>MPV: Event (Property Change)
        MPV->>Core: emit('session-change')
        Core->>Core: StateMachine.update()
        Core->>App: emit('player-state')
        App->>UI: broadcast('player-status')
    end
```

### 4.3 State Update Flow (Data Flow)

How data bubbles up from the low-level engine to the UI.

```mermaid
flowchart BT
    MPV_Core[libmpv Core] -- "Events (C++)" --> NAPI[Node-API Binding]
    NAPI -- "Events (JS)" --> MMP[MpvMediaPlayer]
    
    subgraph "Infrastructure"
        MMP -- "Raw PlaybackSession" --> CP[CorePlayer]
    end
    
    subgraph "Domain Logic"
        CP -- "Session Data" --> PSM[PlayerStateMachine]
        PSM -- "Sanitized PlayerStatus" --> CP
    end
    
    subgraph "Application"
        CP -- "player-status Event" --> VPA[VideoPlayerApp]
    end
    
    subgraph "UI Boundary"
        VPA -- "IPC Broadcast" --> Renderer[Vue UI]
    end
```

---

## 5. State Management

The player logic is driven by a finite state machine to ensure deterministic behavior.

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOADING : play()
    LOADING --> PLAYING : playback_start
    PLAYING --> PAUSED : pause()
    PAUSED --> PLAYING : resume()
    
    %% Stop transitions (Strict flow: Active -> STOPPED)
    LOADING --> STOPPED : stop() / play(new)
    PLAYING --> STOPPED : stop() / play(new)
    PAUSED --> STOPPED : stop() / play(new)
    
    %% Lifecycle ends
    PLAYING --> ENDED : end_of_file
    
    %% Error handling
    LOADING --> ERROR : error
    PLAYING --> ERROR : error
    
    %% Reset path (Only from terminal states)
    STOPPED --> IDLE : reset()
    ENDED --> IDLE : reset()
    ERROR --> IDLE : reset()
    
    note right of PLAYING
        Auxiliary States (Orthogonal):
        * Seeking (Active in PLAYING/PAUSED)
        * Buffering (Network Status)
    end note
```

### 5.1 State Synchronization Strategy
*   **Source of Truth**: `libmpv` internal state.
*   **Polling/Events**: `MpvMediaPlayer` listens to `libmpv` events (via Native Addon) and updates `PlaybackSession`.
*   **Sanitization**: `PlayerStateMachine` takes raw `PlaybackSession` and derives a clean `PlayerStatus` (handling edge cases like "seeking while paused").
*   **Broadcast**: The sanitized `PlayerStatus` is broadcast to the UI via IPC. **UI never queries state directly; it only reacts to broadcasts.**

### 5.2 UI Interaction Patterns (Adjustable Values)

To solve the race conditions between "UI state" and "Backend status broadcasts", the system uses the **Adjustable Value Pattern**:

*   **Local Priority**: When the user is interacting (dragging a slider, typing), the UI state is disconnected from the backend broadcast to prevent "jumpy" controls.
*   **Protection Window**: After a user commits a change (e.g., `seek`), the system ignores incoming backend status updates for a short period (default 1000ms for timeline, 200ms for volume) to allow the backend state to catch up.
*   **Atomic Commits**: Seek operations are atomic; multiple `input` events during a click or drag update the local UI, but only the final `change` event (or a specific commit action) triggers the backend command, ensuring smooth interaction.
*   **Defensive Correction**: If the UI state and backend state remain out of sync after the protection window, the system performs a forced sync to prevent "stuck" controls.

### 5.3 Playback Scheduling (Async Task Management)

The `PlaybackScheduler` solves the **Temporal Dependency** problem (e.g., "I want to seek, but I must wait for the video to be loaded first"). It acts as a smart buffer between the application logic and the core player.

*   **Queue-Based**: Tasks are executed sequentially to prevent race conditions (e.g., `load` then `seek`).
*   **State-Gated**: A task at the head of the queue only runs if its `condition(currentState)` returns true.
*   **Event-Driven**: The scheduler subscribes to `PlayerStateMachine` state changes to re-evaluate blocked tasks immediately.

```mermaid
graph TD
    %% External Dependencies
    Client([CorePlayer])
    SM[PlayerStateMachine]
    MP[MediaPlayer]

    subgraph Scheduler ["Playback Scheduler"]
        direction TB
        Queue[TaskQueue]
        
        subgraph Logic ["Scheduling Logic"]
            Check{Condition<br/>Met?}
            Wait[Blocked: Wait for State]
        end
        
        Exec[Execute & Dequeue]
    end

    %% Data Flow
    Client -->|1. schedule| Queue
    Queue -->|2. peek| Check
    
    SM -.->|3. current state| Check
    SM -.->|4. state change| Check
    
    Check -- No --> Wait
    Wait -.->|retry| Check
    
    Check -- Yes --> Exec
    Exec -->|5. call| MP
    Exec -->|resolve| Client
    Exec -->|6. try next| Check

    style Check fill:#f96,stroke:#333,stroke-width:2px
    style Queue fill:#eee,stroke:#333
    style SM fill:#ccf,stroke:#333
    style MP fill:#dfd,stroke:#333
```

---

## 6. Directory Structure Mapping

```mermaid
graph LR
    src[src] --> main[main]
    src --> renderer[renderer]
    
    main --> app[application]
    main --> domain[domain]
    main --> infra[infrastructure]
    
    app --> core[core]
    app --> commands[command]
    app --> windows[windows]
    
    domain --> models[models]
    
    infra --> mpv[mpv]
    infra --> platform[platform]
    infra --> rendering[rendering]
```

## 7. Development Guidelines

### 7.1 Modifying Architecture
*   **Strict Layering**: Never import `VideoPlayerApp` into `CorePlayer`. Dependencies point down.
*   **Interface First**: If changing `CorePlayer` functionality, update the `MediaPlayer` interface first if it affects the contract.
*   **Single Source of Truth**: Update this document before merging any architectural changes.
