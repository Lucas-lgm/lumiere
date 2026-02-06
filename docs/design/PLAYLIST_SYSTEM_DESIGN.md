# Playlist System Design Document

## 1. Introduction

This document describes the process architecture design of the playlist system in the MPV Electron player, adopting a frontend-controlled, main-process-synchronized pattern to ensure state consistency in multi-window environments.

## 2. Architecture Overview

The playlist system consists of three core components, implementing state management and data synchronization through IPC communication.

### Core Components

- **Main Window**: Primary user interaction interface, responsible for playlist management
- **Video Window**: Dedicated window for video playback
- **Main Process**: Central state manager, coordinating multi-window synchronization

```mermaid
flowchart TB
    classDef mainWindow fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
    classDef videoWindow fill:#bbdefb,stroke:#0d47a1,stroke-width:2px,color:#0a2463
    classDef mainProcess fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
    
    subgraph MainWindow ["Main Window"]
        Main_UI[Playlist UI]:::mainWindow
        Main_SDK[SDK Instance]:::mainWindow
        Main_UI --> Main_SDK
    end
    
    subgraph VideoWindow ["Video Window"]
        Video_UI[Video Playback UI]:::videoWindow
        Video_SDK[SDK Instance]:::videoWindow
        Video_UI --> Video_SDK
    end
    
    subgraph MainProcess ["Main Process"]
        PlaylistMgr[Playlist Management]:::mainProcess
        IPCServer[IPC Server]:::mainProcess
        PlaylistMgr --> IPCServer
    end
    
    Main_SDK -->|IPC Communication| IPCServer
    Video_SDK -->|IPC Communication| IPCServer
    IPCServer -->|State Sync| Main_SDK
    IPCServer -->|State Sync| Video_SDK
```

## 3. Core Components

### 3.1 Frontend Components
- **ControlView.vue**: Playlist UI display and user interaction
- **VideoPlayerSDK**: Core frontend playlist management and control

### 3.2 Main Process Components
- **videoPlayerApp**: Main process playlist management and cross-window synchronization
- **IPC Communication**: Frontend-backend communication bridge, including SET_PLAYLIST, PLAYLIST_UPDATED, GET_PLAYLIST channels

## 4. Data Structures

The playlist system uses streamlined data structures, including frontend media items, main process playlist entries, and SDK internal management structures, ensuring efficient data transmission and state management.

## 5. Scenario Flows

### 5.1 Scenario 1: Before Video Playback - Main Window Synchronizes Playlist to Main Process

**Scenario Description**: When the user adds videos to the playlist in the main window, the system synchronizes the playlist to the main process, preparing for subsequent video playback.

**Key Steps**:
1. User adds videos to the playlist
2. Main window updates local state
3. SDK synchronizes to main process
4. Main process updates central state

```mermaid
sequenceDiagram
    participant MainWin as Main Window
    participant SDK as SDK Instance
    participant MainProc as Main Process
    
    MainWin->>MainWin: User adds video
    MainWin->>SDK: Call addToPlaylist(video)
    SDK->>SDK: Update local playlist
    SDK->>MainProc: IPC send SET_PLAYLIST
    MainProc->>MainProc: Update playlist state
    MainProc->>SDK: Confirm receipt
    SDK->>MainWin: Update success callback
    MainWin->>MainWin: Refresh UI
```

### 5.2 Scenario 2: Video Window Opening - Pull Playlist from Main Process

**Scenario Description**: When the video window opens, it automatically pulls the latest playlist state from the main process to ensure synchronization with the main window.

**Key Steps**:
1. Video window opens
2. SDK initializes and requests playlist
3. Main process returns latest state
4. Video window updates display

```mermaid
sequenceDiagram
    participant VideoWin as Video Window
    participant VideoSDK as SDK Instance
    participant MainProc as Main Process
    
    VideoWin->>VideoWin: Window opens
    VideoWin->>VideoSDK: Initialize SDK
    VideoSDK->>MainProc: IPC send GET_PLAYLIST
    MainProc->>MainProc: Get current playlist
    MainProc->>VideoSDK: IPC return PLAYLIST_UPDATED
    VideoSDK->>VideoWin: Update playlist state
    VideoWin->>VideoWin: Refresh UI
```

### 5.3 Scenario 3: Data Update - Main Process Synchronizes Updates to All Windows

**Scenario Description**: When any window modifies the playlist, the main process synchronizes the update to all open windows, ensuring state consistency in multi-window environments.

**Key Steps**:
1. Source window modifies playlist
2. SDK synchronizes to main process
3. Main process broadcasts update
4. All windows receive and update

```mermaid
sequenceDiagram
    participant SourceWin as Source Window
    participant SourceSDK as SDK Instance
    participant MainProc as Main Process
    participant OtherWin as Other Windows
    participant OtherSDK as SDK Instance
    
    SourceWin->>SourceSDK: Modify playlist
    SourceSDK->>MainProc: IPC send SET_PLAYLIST
    MainProc->>MainProc: Update playlist state
    MainProc->>SourceSDK: Send confirmation
    MainProc->>OtherSDK: Broadcast PLAYLIST_UPDATED
    SourceSDK->>SourceWin: Update success callback
    OtherSDK->>OtherWin: Update playlist state
    SourceWin->>SourceWin: Refresh UI
    OtherWin->>OtherWin: Refresh UI
```

## 6. Update Mechanism

### 6.1 Core Update Flow

- **Frontend Trigger**: When adding, removing, moving videos or clearing the playlist, the SDK synchronizes to the main process
- **Main Process Handling**: Updates central state and broadcasts to all windows
- **Multi-window Synchronization**: All open windows receive updates and refresh UI

### 6.2 Update Flow Diagram

```mermaid
flowchart TD
    subgraph Main Window
        A[Frontend Operation] --> B[SDK Updates Local State]
        B --> C[IPC Sync to Main Process]
    end
    
    subgraph Main Process
        D[Main Process Updates State] --> E[Broadcast Update Event]
    end
    
    subgraph All Frontend Windows
        F[Receive Update Event] --> G[Update Local State]
        G --> H[Refresh UI]
    end
    
    C -->|IPC Notification| D
    E -->|IPC Broadcast| F
```

## 7. Video Switching Flow

### 7.1 Core Switching Flow

- **User Trigger**: Click on playlist item or previous/next buttons
- **Frontend Processing**: Set current playback item and synchronize to main process
- **Main Process Handling**: Execute video playback and broadcast status updates
- **Multi-window Update**: All windows receive status updates

### 7.2 Video Switching Flow Diagram

```mermaid
flowchart TD
    subgraph Main Window
        A[User Triggers Switch] --> B[Frontend Gets Target Video]
        B --> C[Set Current Playback Item]
        C --> D[Sync to Main Process]
        D --> E[Call SDK.play]
        E --> F[IPC Send to Main Process]
    end
    
    subgraph Main Process
        G[Main Process Executes Playback] --> H[Broadcast Status Update]
    end
    
    subgraph Video Window
        I[Receive and Update UI]
    end
    
    F -->|IPC Notification| G
    H -->|IPC Broadcast| I
```



## 8. Communication Mechanism

### 8.1 Key IPC Channels

- **GET_PLAYLIST**: Frontend requests playlist
- **SET_PLAYLIST**: Frontend synchronizes playlist to main process
- **PLAY_MEDIA**: Frontend requests video playback
- **PLAYLIST_UPDATED**: Main process broadcasts playlist updates
- **currentVideoChanged**: Main process notifies current video change
- **status**: Main process broadcasts playback status updates

### 8.2 Communication Flow Diagram

```mermaid
flowchart LR
    subgraph Main Window
        A[Send IPC Request] --> B[Receive Response/Broadcast]
    end
    
    subgraph Main Process
        C[Receive and Process Request] --> D[Send Response/Broadcast]
    end
    
    subgraph Video Window
        E[Receive Response/Broadcast]
    end
    
    A -->|IPC Communication| C
    D -->|IPC Communication| B
    D -->|IPC Broadcast| E
```

## 9. Core Features

- **Loop Playback**: Automatically starts from the beginning when reaching the last track
- **Random Playback**: Uses shuffle algorithm to reorder the playlist
- **Drag-and-Drop Sorting**: Supports adjusting playlist item order via drag-and-drop
- **Multi-window Synchronization**: Ensures consistent playlist state across all windows

## 10. Optimization Directions

- **Performance Optimization**: Reduce IPC communication, use batch synchronization
- **Reliability Optimization**: Enhance error handling and state consistency
- **Maintainability Optimization**: Improve code structure and documentation

## 11. Summary

The playlist system adopts a frontend-controlled, main-process-synchronized architecture pattern, ensuring state consistency in multi-window environments and providing users with a smooth playback experience.