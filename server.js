const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// REI Network RPC endpoint
const REI_RPC_URL = process.env.REI_RPC_URL || 'https://rpc.rei.network';

// Cache configuration
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'statistics.json');
const HISTORY_CACHE_FILE = path.join(CACHE_DIR, 'history.json');
const RECORDS_PER_24H = 24; // 24 hours = 24 records (28800 blocks / 1200)

// Global cache variables
let cachedStats = null;
let lastProcessedBlock = 0;
let lastProcessedBlockTimestamp = null;
let isProcessing = false;
let workerProcess = null;

/**
 * Initialize cache directory
 */
async function initializeCache() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    console.log('Cache directory initialized');
  } catch (error) {
    console.error('Failed to initialize cache directory:', error);
  }
}

/**
 * Load cached statistics
 */
async function loadCachedStats() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(data);
    cachedStats = parsed.stats;
    lastProcessedBlock = parsed.lastProcessedBlock;
    lastProcessedBlockTimestamp = parsed.lastProcessedBlockTimestamp;
    console.log(
      `Loaded cached stats from block ${lastProcessedBlock}${
        lastProcessedBlockTimestamp ? ` (${lastProcessedBlockTimestamp})` : ''
      }`
    );
    return parsed;
  } catch (error) {
    console.log('No cached statistics found, starting fresh');
    return null;
  }
}

/**
 * Save statistics to cache
 */
async function saveCachedStats(stats, lastBlock) {
  try {
    const data = {
      stats,
      lastProcessedBlock: lastBlock,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
    cachedStats = stats;
    lastProcessedBlock = lastBlock;
    console.log(`Saved statistics to cache up to block ${lastBlock}`);
  } catch (error) {
    console.error('Failed to save cached statistics:', error);
  }
}

/**
 * Load historical statistics
 */
async function loadHistoricalStats() {
  try {
    const data = await fs.readFile(HISTORY_CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

/**
 * Save historical statistics
 */
async function saveHistoricalStats(historicalData) {
  try {
    await fs.writeFile(
      HISTORY_CACHE_FILE,
      JSON.stringify(historicalData, null, 2)
    );
  } catch (error) {
    console.error('Failed to save historical statistics:', error);
  }
}

/**
 * Get block information by block number with retry mechanism
 */
async function getBlockByNumber(blockNumber, retryCount = 0) {
  const maxRetries = 3;

  try {
    const response = await axios.post(REI_RPC_URL, {
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: [`0x${blockNumber.toString(16)}`, true],
      id: 1,
    });
    return response.data.result;
  } catch (error) {
    console.error(
      `Failed to get block ${blockNumber} (attempt ${retryCount + 1}/${
        maxRetries + 1
      }):`,
      error.message
    );

    if (retryCount < maxRetries) {
      console.log(`Retrying block ${blockNumber} in 1 second...`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
      return getBlockByNumber(blockNumber, retryCount + 1);
    }

    console.error(`Max retries exceeded for block ${blockNumber}`);
    return null;
  }
}

/**
 * Get latest block number
 */
async function getLatestBlockNumber() {
  try {
    const response = await axios.post(REI_RPC_URL, {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    });
    return parseInt(response.data.result, 16);
  } catch (error) {
    console.error('Failed to get latest block number:', error.message);
    return null;
  }
}

/**
 * Start worker process
 */
function startWorker() {
  if (workerProcess) {
    console.log('Worker process already running');
    return;
  }

  console.log('Starting worker process...');
  workerProcess = spawn('node', ['worker.js'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  // Handle worker messages
  workerProcess.on('message', (message) => {
    console.log('Worker message:', message);

    if (message.type === 'task_completed') {
      isProcessing = false;
      console.log('Worker task completed successfully');
      // Reload cache to get updated data
      loadCachedStats();
    } else if (message.type === 'task_error') {
      isProcessing = false;
      console.error('Worker task failed:', message.error);
    }
  });

  // Handle worker output
  workerProcess.stdout.on('data', (data) => {
    console.log(`Worker: ${data}`);
  });

  workerProcess.stderr.on('data', (data) => {
    console.error(`Worker error: ${data}`);
  });

  // Handle worker exit
  workerProcess.on('exit', (code, signal) => {
    console.log(`Worker process exited with code ${code} and signal ${signal}`);
    workerProcess = null;
    isProcessing = false;
  });

  // Handle worker errors
  workerProcess.on('error', (error) => {
    console.error('Worker process error:', error);
    workerProcess = null;
    isProcessing = false;
  });
}

/**
 * Stop worker process
 */
function stopWorker() {
  if (workerProcess) {
    console.log('Stopping worker process...');
    workerProcess.kill();
    workerProcess = null;
    isProcessing = false;
  }
}

/**
 * Run scheduled task via worker
 */
function runScheduledTask() {
  if (isProcessing) {
    console.log('Task already running, skipping...');
    return;
  }

  if (!workerProcess) {
    console.log('Starting worker for scheduled task...');
    startWorker();
  }

  if (workerProcess) {
    isProcessing = true;
    workerProcess.send({ type: 'run_task' });
  }
}

/**
 * Get 24-hour statistics by merging last 28 records
 */
async function get24HourStats() {
  try {
    const historicalData = await loadHistoricalStats();

    if (historicalData.length === 0) {
      return {
        totalBlocks: 0,
        totalTransactions: 0,
        uniqueAddresses: [],
        uniqueAddressCount: 0,
        blockRange: {
          start: 0,
          end: 0,
        },
        recordCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // Get last 24 records (24 hours worth)
    const last24Records = historicalData.slice(-RECORDS_PER_24H);

    // Merge statistics from all records
    let totalBlocks = 0;
    let totalTransactions = 0;
    const uniqueAddresses = new Set();
    let earliestBlock = Infinity;
    let latestBlock = 0;
    let earliestTimestamp = null;
    let latestTimestamp = null;

    for (const record of last24Records) {
      totalBlocks += record.stats.totalBlocks;
      totalTransactions += record.stats.totalTransactions;

      // Merge unique addresses
      if (record.stats.uniqueAddresses) {
        for (const address of record.stats.uniqueAddresses) {
          uniqueAddresses.add(address);
        }
      }

      // Track block range and timestamps
      if (record.blockRange) {
        earliestBlock = Math.min(earliestBlock, record.blockRange.start);
        latestBlock = Math.max(latestBlock, record.blockRange.end);

        // Track timestamps
        if (record.blockRange.startTimestamp) {
          const startTime = new Date(record.blockRange.startTimestamp);
          if (!earliestTimestamp || startTime < earliestTimestamp) {
            earliestTimestamp = startTime;
          }
        }
        if (record.blockRange.endTimestamp) {
          const endTime = new Date(record.blockRange.endTimestamp);
          if (!latestTimestamp || endTime > latestTimestamp) {
            latestTimestamp = endTime;
          }
        }
      }
    }

    return {
      totalBlocks,
      totalTransactions,
      uniqueAddresses: Array.from(uniqueAddresses),
      uniqueAddressCount: uniqueAddresses.size,
      blockRange: {
        start: earliestBlock === Infinity ? 0 : earliestBlock,
        end: latestBlock,
        startTimestamp: earliestTimestamp
          ? earliestTimestamp.toISOString()
          : null,
        endTimestamp: latestTimestamp ? latestTimestamp.toISOString() : null,
      },
      recordCount: last24Records.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to get 24-hour statistics:', error);

    // Fallback to cached stats if available
    if (cachedStats) {
      return {
        ...cachedStats,
        timestamp: new Date().toISOString(),
      };
    }

    // Return empty stats as last resort
    return {
      totalBlocks: 0,
      totalTransactions: 0,
      uniqueAddresses: [],
      uniqueAddressCount: 0,
      blockRange: {
        start: 0,
        end: 0,
      },
      recordCount: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

// API routes
app.get('/api/stats/24h', async (req, res) => {
  try {
    const stats = await get24HourStats();

    res.json({
      success: true,
      data: stats,
      message: 'Successfully retrieved 24-hour statistics',
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to retrieve statistics',
    });
  }
});

// Historical statistics endpoint
app.get('/api/stats/history', async (req, res) => {
  try {
    const historicalData = await loadHistoricalStats();
    res.json({
      success: true,
      data: historicalData,
      message: 'Successfully retrieved historical statistics',
    });
  } catch (error) {
    console.error('Failed to get historical statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to retrieve historical statistics',
    });
  }
});

// Recent records endpoint (last 24 records)
app.get('/api/stats/records', async (req, res) => {
  try {
    const historicalData = await loadHistoricalStats();
    const last24Records = historicalData.slice(-RECORDS_PER_24H);

    res.json({
      success: true,
      data: {
        records: last24Records,
        count: last24Records.length,
        totalRecords: historicalData.length,
      },
      message: 'Successfully retrieved recent records',
    });
  } catch (error) {
    console.error('Failed to get recent records:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to retrieve recent records',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'REI Network DAU Stats',
    lastProcessedBlock,
    lastProcessedBlockTimestamp,
    isProcessing,
  });
});

// Root path
app.get('/', (req, res) => {
  res.json({
    message: 'REI Network DAU Statistics Service',
    endpoints: {
      'GET /api/stats/24h':
        'Get 24-hour statistics (merged from last 24 records)',
      'GET /api/stats/records': 'Get recent records (last 24 records)',
      'GET /api/stats/history': 'Get all historical statistics',
      'GET /health': 'Health check',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
  });
});

// Initialize and start server
async function startServer() {
  try {
    // Initialize cache directory
    await initializeCache();

    // Load cached statistics
    await loadCachedStats();

    // Run initial scheduled task via worker
    console.log('Running initial data processing via worker...');
    runScheduledTask();

    // Set up periodic task (every 30 minutes)
    setInterval(() => {
      console.log('Running scheduled task via worker...');
      runScheduledTask();
    }, 30 * 60 * 1000); // 30 minutes

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...');
      stopWorker();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      stopWorker();
      process.exit(0);
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 REI Network DAU Statistics Service started`);
      console.log(`📊 Service URL: http://localhost:${PORT}`);
      console.log(`📈 API endpoint: http://localhost:${PORT}/api/stats/24h`);
      console.log(
        `📚 History endpoint: http://localhost:${PORT}/api/stats/history`
      );
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      console.log(`⏰ Scheduled task runs every 30 minutes via worker process`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;
