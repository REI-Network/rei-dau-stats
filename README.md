# REI Network DAU Statistics Service

This is an Express-based Node.js service for retrieving REI Network's block, transaction, and unique address (DAU) statistics from the past 24 hours.

## Features

- 📊 Get the number of blocks produced in the past 24 hours
- 💰 Count transactions in the past 24 hours
- 👥 Calculate unique address count (DAU - Daily Active Users)
- 🚀 High-performance batch block data retrieval with caching
- ⏰ Automated scheduled processing every 30 minutes via worker process
- 💾 Persistent cache with incremental updates
- 📚 Historical statistics storage and retrieval
- 🔄 Worker process architecture for non-blocking operations
- 💚 Health check endpoint with processing status

## Installation and Usage

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the environment configuration file:

```bash
cp env.example .env
```

Edit the `.env` file to configure the REI Network RPC endpoint:

```
REI_RPC_URL=https://rpc.rei.network
PORT=3000
```

### 3. Start the Service

Production environment:

```bash
npm start
```

Development environment (auto-restart):

```bash
npm run dev
```

### 4. Run Worker Process (Optional)

You can also run the worker process independently for testing:

```bash
# Run worker once
npm run worker

# Run worker in development mode (auto-restart)
npm run worker:dev

# Test worker process functionality
npm run test:worker
```

## API Endpoints

### Get 24-Hour Statistics

**GET** `/api/stats/24h`

Returns cached statistics for the past 24 hours (updated every 30 minutes).

**Response Example:**

```json
{
  "success": true,
  "data": {
    "totalBlocks": 28800,
    "totalTransactions": 150000,
    "uniqueAddresses": ["0x123...", "0x456..."],
    "uniqueAddressCount": 5000,
    "blockRange": {
      "start": 1000000,
      "end": 1028800,
      "startTimestamp": "2024-01-14T10:30:00.000Z",
      "endTimestamp": "2024-01-15T10:30:00.000Z"
    },
    "recordCount": 24,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "message": "Successfully retrieved 24-hour statistics"
}
```

**Field Descriptions:**

- `totalBlocks`: Total number of blocks from last 24 records (24 hours)
- `totalTransactions`: Total number of transactions from last 24 records
- `uniqueAddresses`: Array of unique addresses (for debugging)
- `uniqueAddressCount`: Number of unique addresses (DAU)
- `blockRange`: Block range of the 24 records with timestamps
  - `start`: Starting block number
  - `end`: Ending block number
  - `startTimestamp`: Timestamp of the first block
  - `endTimestamp`: Timestamp of the last block
- `recordCount`: Number of records merged (should be 24 for 24 hours)
- `timestamp`: Data retrieval timestamp

### Get Recent Records

**GET** `/api/stats/records`

Returns the last 24 records (24 hours worth of data).

**Response Example:**

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "blockRange": {
          "start": 1000000,
          "end": 1000100,
          "startTimestamp": "2024-01-15T10:00:00.000Z",
          "endTimestamp": "2024-01-15T10:05:00.000Z"
        },
        "stats": {
          "totalBlocks": 100,
          "totalTransactions": 500,
          "uniqueAddresses": ["0x123...", "0x456..."],
          "uniqueAddressCount": 20
        },
        "timestamp": "2024-01-15T10:00:00.000Z"
      }
    ],
    "count": 24,
    "totalRecords": 168
  },
  "message": "Successfully retrieved recent records"
}
```

### Get Historical Statistics

**GET** `/api/stats/history`

Returns all historical statistics (limited to 7 days retention).

**Response Example:**

```json
{
  "success": true,
  "data": [
    {
      "blockRange": {
        "start": 1000000,
        "end": 1000100,
        "startTimestamp": "2024-01-15T10:00:00.000Z",
        "endTimestamp": "2024-01-15T10:05:00.000Z"
      },
      "stats": {
        "totalBlocks": 100,
        "totalTransactions": 500,
        "uniqueAddresses": ["0x123...", "0x456..."],
        "uniqueAddressCount": 20
      },
      "timestamp": "2024-01-15T10:00:00.000Z"
    }
  ],
  "message": "Successfully retrieved historical statistics"
}
```

### Health Check

**GET** `/health`

Check service status.

**Response Example:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "REI Network DAU Stats",
  "lastProcessedBlock": 1028800,
  "lastProcessedBlockTimestamp": "2024-01-15T10:30:00.000Z",
  "isProcessing": false
}
```

## Technical Implementation

### Data Retrieval Strategy

1. **Worker Process Architecture**: Scheduled processing runs in separate worker process
2. **Non-blocking Operations**: Main Express server remains responsive during data processing
3. **Incremental Updates**: Only process new blocks since last run
4. **Record-based Storage**: Generate one record every 1200 blocks (1 hour)
5. **24-hour Aggregation**: Merge last 24 records for 24-hour statistics
6. **Data Retention**: Automatically clean up data older than 7 days
7. **Parallel Retrieval**: Use Promise.all to retrieve block data in parallel
8. **Address Deduplication**: Use Set data structure to ensure address uniqueness
9. **Persistent Cache**: File-based caching for fast API responses

### Performance Optimizations

- **Worker Process**: Data processing runs in separate process, not blocking main server
- **Cached Responses**: API returns instantly from cache
- **Incremental Processing**: Only process new blocks, not entire history
- **Batch Processing**: Process blocks in configurable batches
- **Parallel Requests**: Concurrent block data retrieval
- **Error Handling**: Comprehensive error handling and retry mechanisms
- **Memory Optimization**: Efficient address deduplication and storage
- **Process Isolation**: Worker crashes don't affect main server

## Configuration

### Environment Variables

| Variable Name | Default Value             | Description              |
| ------------- | ------------------------- | ------------------------ |
| `REI_RPC_URL` | `https://rpc.rei.network` | REI Network RPC endpoint |
| `PORT`        | `3000`                    | Server port              |

### Custom RPC Endpoint

If you need to use a different REI Network RPC endpoint, modify the `REI_RPC_URL` variable in the `.env` file.

## Usage Examples

### Using curl to Get Data

```bash
# Get 24-hour statistics
curl http://localhost:3000/api/stats/24h

# Health check
curl http://localhost:3000/health
```

### Using JavaScript to Get Data

```javascript
const axios = require('axios');

async function getStats() {
  try {
    const response = await axios.get('http://localhost:3000/api/stats/24h');
    console.log('24-hour statistics:', response.data);
  } catch (error) {
    console.error('Failed to retrieve data:', error.message);
  }
}

getStats();
```

## Important Notes

1. **Network Connection**: Ensure the server can access the REI Network RPC endpoint
2. **Data Accuracy**: Statistics are based on block timestamps and may have slight time deviations
3. **Cache Directory**: The service creates a `cache/` directory for storing statistics data
4. **Worker Process**: Statistics are updated automatically every 30 minutes via worker process
5. **Non-blocking**: Main server remains responsive during data processing
6. **Record-based Storage**: One record is generated every 1200 blocks (1 hour) for efficient storage
7. **24-hour Aggregation**: 24-hour statistics are calculated by merging the last 24 records
8. **Smart Startup**: First run processes only 6 hours of recent data for quick startup
9. **Data Retention**: Historical data older than 7 days is automatically cleaned up
10. **Incremental Updates**: Only new blocks are processed, making the service very efficient
11. **Error Handling**: The service includes comprehensive error handling and returns detailed error messages
12. **Data Persistence**: Statistics are cached to disk and survive server restarts
13. **Process Isolation**: Worker process crashes don't affect the main server

## Troubleshooting

### Common Issues

1. **Connection Timeout**: Check network connectivity and RPC endpoint availability
2. **Inaccurate Data**: Verify the data format returned by the RPC endpoint
3. **Insufficient Memory**: For large datasets, consider increasing server memory or optimizing batch size

### Log Monitoring

The service outputs detailed log information during operation, including:

- Block processing progress
- Cache operations
- Scheduled task execution
- Error messages
- Performance statistics

### Cache Management

The service automatically manages cache files:

- `cache/statistics.json`: Current 24-hour statistics
- `cache/history.json`: Historical processing data
- Cache files are created automatically on first run
- Cache is updated incrementally with each scheduled task
- No manual cache management required

### Worker Process Architecture

The service uses a worker process architecture for optimal performance:

#### Main Process (server.js)

- Runs the Express API server
- Handles HTTP requests and responses
- Manages worker process lifecycle
- Loads and serves cached statistics

#### Worker Process (worker.js)

- Runs scheduled data processing tasks
- Handles heavy computational work (block processing)
- Communicates with main process via IPC
- Can be run independently for testing

#### Benefits

- **Non-blocking**: Main server remains responsive during data processing
- **Isolation**: Worker crashes don't affect the main server
- **Scalability**: Can easily add more worker processes if needed
- **Testing**: Worker can be tested independently

#### Process Communication

- Main process sends `run_task` messages to worker
- Worker sends `task_completed` or `task_error` messages back
- All communication is asynchronous and non-blocking

## License

MIT License
