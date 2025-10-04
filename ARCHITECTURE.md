# REI Network DAU Statistics Service Architecture

## Overview

This service uses a worker process architecture to provide high-performance, non-blocking statistics processing for REI Network blockchain data.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (server.js)                │
├─────────────────────────────────────────────────────────────┤
│  Express Server (Port 3000)                                │
│  ├── GET /api/stats/24h     (Returns cached data)          │
│  ├── GET /api/stats/history (Returns historical data)      │
│  ├── GET /health            (Health check)                 │
│  └── GET /                  (Service info)                 │
├─────────────────────────────────────────────────────────────┤
│  Cache Management                                           │
│  ├── Load cached statistics on startup                      │
│  ├── Serve data from memory cache                          │
│  └── Reload cache when worker completes                    │
├─────────────────────────────────────────────────────────────┤
│  Worker Process Management                                  │
│  ├── Start/stop worker processes                           │
│  ├── Handle worker messages (IPC)                          │
│  ├── Graceful shutdown handling                            │
│  └── Scheduled task execution (every 30 min)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ IPC Communication
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Worker Process (worker.js)                │
├─────────────────────────────────────────────────────────────┤
│  Data Processing Engine                                     │
│  ├── Get latest block number from RPC                      │
│  ├── Calculate 24-hour window                              │
│  ├── Process blocks in chunks (1200 blocks per record)    │
│  ├── Extract transaction data                              │
│  ├── Count unique addresses (DAU)                           │
│  ├── Generate record every 1200 blocks (1 hour)           │
│  ├── Clean up data older than 7 days                      │
│  └── Handle retries (3 attempts with 1s delay)           │
├─────────────────────────────────────────────────────────────┤
│  Cache Operations                                           │
│  ├── Load existing cache data                              │
│  ├── Process blocks in 1200-block chunks                 │
│  ├── Generate one record per 1200 blocks (1 hour)        │
│  ├── Save records to history.json                         │
│  ├── Merge last 24 records for 24h stats                 │
│  ├── Clean up data older than 7 days                     │
│  └── Send completion message to main process               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ File System
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Cache Directory                        │
├─────────────────────────────────────────────────────────────┤
│  cache/                                                     │
│  ├── statistics.json (Current 24h stats)                  │
│  └── history.json (Historical processing data)            │
└─────────────────────────────────────────────────────────────┘
```

## Process Flow

### 1. Service Startup

```
Main Process → Initialize Cache → Load Cached Data → Start Worker → Begin Scheduled Tasks
```

### 2. Data Processing (Every 30 minutes)

```
Scheduled Task → Start Worker → Process New Blocks in 1200-block chunks →
Generate Records → Update History → Clean Old Data → Notify Main Process
```

### 3. API Request

```
HTTP Request → Main Process → Merge Last 24 Records → Return Aggregated Data (Fast Response)
```

## Key Benefits

### 1. **Non-blocking Architecture**

- Main server remains responsive during heavy data processing
- API requests are served instantly from cache
- No impact on user experience during data updates

### 2. **Process Isolation**

- Worker crashes don't affect the main server
- Memory usage is isolated between processes
- Easy to restart worker without affecting API

### 3. **Record-based Processing**

- Processes blocks in 1200-block chunks
- Generates one record per 1200 blocks (1 hour)
- Merges last 24 records for 24-hour statistics
- Efficient storage and processing

### 4. **Fault Tolerance**

- Retry mechanism for failed block requests
- Graceful error handling and recovery
- Process-level isolation prevents cascading failures

### 5. **Data Management**

- Automatic cleanup of data older than 7 days
- Record-based storage prevents file bloat
- Efficient 24-hour aggregation from last 24 records
- Scalable storage architecture

### 6. **Scalability**

- Easy to add more worker processes
- Can distribute processing across multiple workers
- Independent scaling of API and processing components

## File Structure

```
rei-dau-stats/
├── server.js              # Main Express server
├── worker.js              # Worker process for data processing
├── test-worker.js         # Worker testing script
├── package.json           # Dependencies and scripts
├── README.md              # User documentation
├── ARCHITECTURE.md        # This architecture document
├── env.example           # Environment configuration
├── .gitignore            # Git ignore rules
└── cache/                # Cache directory (auto-created)
    ├── statistics.json   # Current statistics cache
    └── history.json      # Historical data cache
```

## Communication Patterns

### Main Process → Worker Process

- `{ type: 'run_task' }` - Trigger data processing

### Worker Process → Main Process

- `{ type: 'task_completed', timestamp, lastProcessedBlock }` - Processing completed
- `{ type: 'task_error', error, timestamp }` - Processing failed

## Performance Characteristics

### Response Times

- API responses: < 100ms (served from memory cache)
- Data processing: 2-5 minutes (depending on block count)
- Cache updates: < 1 second

### Resource Usage

- Main process: Low memory, handles HTTP requests
- Worker process: Higher memory during processing, terminates after completion
- Cache files: Persistent storage, grows over time

### Scalability

- Can handle high API request volumes
- Worker processing is independent of API load
- Easy to add more workers for increased processing capacity

## Error Handling

### Main Process

- Graceful worker process management
- Automatic worker restart on failure
- Fallback to cached data if worker fails

### Worker Process

- Retry mechanism for RPC calls (3 attempts, 1s delay)
- Comprehensive error logging
- Graceful failure with error reporting to main process

## Monitoring and Observability

### Logs

- Main process: HTTP requests, worker management, cache operations
- Worker process: Block processing progress, RPC calls, error details

### Health Checks

- `/health` endpoint shows processing status
- Worker process status monitoring
- Cache freshness indicators

### Metrics

- Last processed block number
- Processing status (running/idle)
- Cache update timestamps
- Error counts and types
