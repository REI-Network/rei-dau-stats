const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// REI Network RPC endpoint
const REI_RPC_URL = process.env.REI_RPC_URL || 'https://rpc.rei.network';

// Cache configuration
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'statistics.json');
const HISTORY_CACHE_FILE = path.join(CACHE_DIR, 'history.json');
const BATCH_SIZE = 28800; // Process every 28800 blocks (24 hours)
const BLOCK_BATCH_SIZE = 100; // RPC batch size for block retrieval
const RECORD_INTERVAL = 1200; // Generate record every 1200 blocks (1 hour)
const RECORDS_PER_24H = 24; // 24 hours = 24 records (28800 blocks / 1200)
const DATA_RETENTION_DAYS = 7; // Keep data for 7 days

// Worker state
let isProcessing = false;

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
      console.log(`Retrying block ${blockNumber} in 100ms...`);
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms
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
 * Load cached statistics
 */
async function loadCachedStats() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(data);
    console.log(`Loaded cached stats from block ${parsed.lastProcessedBlock}`);
    return parsed;
  } catch (error) {
    console.log('No cached statistics found, starting fresh');
    return null;
  }
}

/**
 * Save statistics to cache
 */
async function saveCachedStats(stats, lastBlock, lastBlockTimestamp = null) {
  try {
    const data = {
      stats,
      lastProcessedBlock: lastBlock,
      lastBlockTimestamp: lastBlockTimestamp,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
    console.log(
      `Saved statistics to cache up to block ${lastBlock}${
        lastBlockTimestamp ? ` (${lastBlockTimestamp})` : ''
      }`
    );
  } catch (error) {
    console.error('Failed to save cached statistics:', error);
  }
}

/**
 * Get block timestamp from block data
 */
async function getBlockTimestamp(blockNumber) {
  try {
    const block = await getBlockByNumber(blockNumber);
    if (block && block.timestamp) {
      return parseInt(block.timestamp, 16) * 1000; // Convert to milliseconds
    }
    return null;
  } catch (error) {
    console.error(`Failed to get timestamp for block ${blockNumber}:`, error);
    return null;
  }
}

/**
 * Save block record to history
 */
async function saveBlockRecord(blockRange, stats) {
  try {
    // Get timestamps for start and end blocks
    const startTimestamp = await getBlockTimestamp(blockRange.start);
    const endTimestamp = await getBlockTimestamp(blockRange.end);

    const record = {
      blockRange: {
        ...blockRange,
        startTimestamp: startTimestamp
          ? new Date(startTimestamp).toISOString()
          : null,
        endTimestamp: endTimestamp
          ? new Date(endTimestamp).toISOString()
          : null,
      },
      stats,
      timestamp: new Date().toISOString(),
    };

    const historicalData = await loadHistoricalStats();
    historicalData.push(record);

    // Don't limit records here - let cleanupOldData handle retention based on 7 days
    // This allows storing 7 days of history (168 records) for historical queries

    await saveHistoricalStats(historicalData);
    console.log(
      `Saved block record for blocks ${blockRange.start}-${blockRange.end} with timestamps`
    );
  } catch (error) {
    console.error('Failed to save block record:', error);
  }
}

/**
 * Clean up old data (older than 7 days)
 */
async function cleanupOldData() {
  try {
    const historicalData = await loadHistoricalStats();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_RETENTION_DAYS);

    const filteredData = historicalData.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= cutoffDate;
    });

    if (filteredData.length !== historicalData.length) {
      await saveHistoricalStats(filteredData);
      console.log(
        `Cleaned up ${historicalData.length - filteredData.length} old records`
      );
    }
  } catch (error) {
    console.error('Failed to cleanup old data:', error);
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
 * Process blocks and update statistics
 */
async function processBlocks(startBlock, endBlock, existingStats = null) {
  try {
    let totalBlocks = existingStats ? existingStats.totalBlocks : 0;
    let totalTransactions = existingStats ? existingStats.totalTransactions : 0;
    const uniqueAddresses = existingStats
      ? new Set(existingStats.uniqueAddresses || [])
      : new Set();

    console.log(`Processing blocks ${startBlock} to ${endBlock}`);

    // Process blocks in batches
    for (
      let blockNum = startBlock;
      blockNum <= endBlock;
      blockNum += BLOCK_BATCH_SIZE
    ) {
      const endBlockNum = Math.min(blockNum + BLOCK_BATCH_SIZE - 1, endBlock);

      console.log(`Processing batch: blocks ${blockNum} to ${endBlockNum}`);

      // Get a batch of blocks in parallel
      const blockPromises = [];
      for (let i = blockNum; i <= endBlockNum; i++) {
        blockPromises.push(getBlockByNumber(i));
      }

      const blocks = await Promise.all(blockPromises);

      for (const block of blocks) {
        if (block) {
          totalBlocks++;
          totalTransactions += block.transactions
            ? block.transactions.length
            : 0;

          // Count unique addresses
          if (block.transactions) {
            for (const tx of block.transactions) {
              if (tx.from) uniqueAddresses.add(tx.from.toLowerCase());
              if (tx.to) uniqueAddresses.add(tx.to.toLowerCase());
            }
          }
        }
      }
    }

    return {
      totalBlocks,
      totalTransactions,
      uniqueAddresses: Array.from(uniqueAddresses),
      uniqueAddressCount: uniqueAddresses.size,
    };
  } catch (error) {
    console.error('Failed to process blocks:', error);
    throw error;
  }
}

/**
 * Scheduled task to process new blocks
 */
async function scheduledTask() {
  if (isProcessing) {
    console.log('Scheduled task already running, skipping...');
    return;
  }

  try {
    isProcessing = true;
    console.log('Starting scheduled task...');

    const latestBlockNumber = await getLatestBlockNumber();
    if (!latestBlockNumber) {
      console.log('Unable to get latest block number, skipping scheduled task');
      return;
    }

    // Load cached data
    const cachedData = await loadCachedStats();
    let cachedStats = cachedData ? cachedData.stats : null;
    let lastProcessedBlock = cachedData ? cachedData.lastProcessedBlock : 0;

    // Calculate 24-hour window
    const blocksPerDay = (24 * 60 * 60) / 3; // Approximately 28800 blocks
    const startBlockNumber = Math.max(0, latestBlockNumber - blocksPerDay);

    // Determine blocks to process
    let blocksToProcess = [];
    if (lastProcessedBlock === 0) {
      // First run - process full 24-hour window
      // Start from 24 hours ago to get complete data
      blocksToProcess = [{ start: startBlockNumber, end: latestBlockNumber }];
      console.log(
        `First run: processing full 24-hour window (${startBlockNumber} to ${latestBlockNumber}) - ${
          latestBlockNumber - startBlockNumber + 1
        } blocks`
      );
      console.log(
        `This will build complete 24-hour cache with all historical data.`
      );
    } else {
      // Check if we need to backfill to get complete 24-hour data
      const blocksSinceLastRun = latestBlockNumber - lastProcessedBlock;
      const blocksIn24Hours = latestBlockNumber - startBlockNumber + 1;

      if (blocksSinceLastRun < blocksIn24Hours) {
        // Need to backfill to get complete 24-hour data
        blocksToProcess = [{ start: startBlockNumber, end: latestBlockNumber }];
        console.log(
          `Backfill: processing complete 24-hour window (${startBlockNumber} to ${latestBlockNumber}) - ${
            latestBlockNumber - startBlockNumber + 1
          } blocks to ensure complete data`
        );
        console.log(
          `This will backfill missing historical data to complete 24-hour coverage.`
        );
      } else {
        // Incremental update - process new blocks since last run
        const newBlocksStart = Math.max(
          lastProcessedBlock + 1,
          startBlockNumber
        );
        if (newBlocksStart <= latestBlockNumber) {
          blocksToProcess = [{ start: newBlocksStart, end: latestBlockNumber }];
          console.log(
            `Incremental update: processing new blocks ${newBlocksStart} to ${latestBlockNumber}`
          );
        }
      }
    }

    if (blocksToProcess.length === 0) {
      console.log('No new blocks to process');
      return;
    }

    // Process blocks in batches of BATCH_SIZE
    for (const range of blocksToProcess) {
      let currentStart = range.start;
      const endBlock = range.end;

      while (currentStart <= endBlock) {
        const currentEnd = Math.min(currentStart + BATCH_SIZE - 1, endBlock);

        console.log(
          `Processing batch: blocks ${currentStart} to ${currentEnd}`
        );

        // Process blocks in smaller chunks of RECORD_INTERVAL (100 blocks)
        let chunkStart = currentStart;
        while (chunkStart <= currentEnd) {
          const chunkEnd = Math.min(
            chunkStart + RECORD_INTERVAL - 1,
            currentEnd
          );

          console.log(`Processing chunk: blocks ${chunkStart} to ${chunkEnd}`);

          // Process this chunk
          const chunkStats = await processBlocks(
            chunkStart,
            chunkEnd,
            null // Start fresh for each chunk
          );

          // Save this chunk as a separate record
          await saveBlockRecord(
            { start: chunkStart, end: chunkEnd },
            chunkStats
          );

          // Update overall cached stats
          if (!cachedStats) {
            cachedStats = chunkStats;
          } else {
            // Merge stats
            cachedStats.totalBlocks += chunkStats.totalBlocks;
            cachedStats.totalTransactions += chunkStats.totalTransactions;

            // Merge unique addresses
            const existingAddresses = new Set(
              cachedStats.uniqueAddresses || []
            );
            const newAddresses = new Set(chunkStats.uniqueAddresses || []);
            const mergedAddresses = new Set([
              ...existingAddresses,
              ...newAddresses,
            ]);

            cachedStats.uniqueAddresses = Array.from(mergedAddresses);
            cachedStats.uniqueAddressCount = mergedAddresses.size;
          }

          chunkStart = chunkEnd + 1;
        }

        // Get timestamp for the last processed block
        const lastBlockTimestamp = await getBlockTimestamp(currentEnd);

        // Save updated cache with timestamp
        await saveCachedStats(
          cachedStats,
          currentEnd,
          lastBlockTimestamp ? new Date(lastBlockTimestamp).toISOString() : null
        );
        currentStart = currentEnd + 1;
      }
    }

    // Clean up old data
    await cleanupOldData();

    console.log('Scheduled task completed successfully');

    // Send completion message to parent process
    if (process.send) {
      process.send({
        type: 'task_completed',
        timestamp: new Date().toISOString(),
        lastProcessedBlock: latestBlockNumber,
      });
    }
  } catch (error) {
    console.error('Scheduled task failed:', error);

    // Send error message to parent process
    if (process.send) {
      process.send({
        type: 'task_error',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  } finally {
    isProcessing = false;
  }
}

// Handle messages from parent process
process.on('message', async (message) => {
  if (message.type === 'run_task') {
    await scheduledTask();
  }
});

// Run task immediately if started directly
if (require.main === module) {
  console.log('Worker started, running initial task...');
  scheduledTask()
    .then(() => {
      console.log('Initial task completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Initial task failed:', error);
      process.exit(1);
    });
}

module.exports = { scheduledTask };
