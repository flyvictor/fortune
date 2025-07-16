const autocannon = require('autocannon');
const Docker = require('dockerode');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const { MongoClient } = require('mongodb');

const outputPrefix = argv.outputPrefix || new Date().toISOString();
const mongodbUrl = process.env.MONGO_DB_URL || 'mongodb://localhost:27017';
const mongodbDbName = 'test-app';

const appUrl = process.env.TEST_APP_URL || 'http://localhost:4000';

// async/await
async function executePerfomanceTest(autocannonOptions) {
  const dockerStatsData = [];
  const docker = new Docker();

  // Clean up the database before starting the test
  await dropAllCollections(mongodbUrl, mongodbDbName);
  await docker.getContainer('performance_metrics-mongo-seed-1').restart();
  await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for 2 second to ensure DB is clean and mongo-seed is ready

  // Ready to execute the performance test
  const container = docker.getContainer('performance_metrics-test-app-1');

  const interval = setInterval(async () => {
    const stats = await container.stats({
      'one-shot': true,
      stream: false,
    });
    dockerStatsData.push(stats);
  }, 10);

  const result = await autocannon(autocannonOptions);

  clearInterval(interval);

  return {
    cpuUsages: calcCpuUsages(dockerStatsData),
    memUsages: calcMemUsages(dockerStatsData),
    latency: result.latency,
    requests: result.requests,
  };
}

async function executeManyPerfomanceTests(
  autocannonOptions,
  {
    counter = 10, // default
    filename = 'performance-metrics-test.json', // default
  } = {},
) {
  const results = [];
  for (let i = 0; i < counter; i++) {
    const result = await executePerfomanceTest(autocannonOptions);
    results.push(result);

    await new Promise((resolve) => setTimeout(resolve, 1000)); // wait for 1 second before each iteration
  }

  const cpuUsages = calculateAverages(results.map((r) => r.cpuUsages));
  const memUsages = calculateAverages(results.map((r) => r.memUsages));
  const latency = calculateAverages(results.map((r) => r.latency));
  const requests = calculateAverages(results.map((r) => r.requests));

  const output = {
    cpuUsages,
    memUsages,
    latency,
    requests,
  };

  await fs.promises.mkdir(`./reports/${outputPrefix}`, { recursive: true });
  await fs.promises.writeFile(
    `./reports/${outputPrefix}/${filename}`,
    JSON.stringify(output, null, 2),
  );
}

async function run() {
  console.log('Starting performance tests...');

  console.log(
    '########## Testing simple fetch from /pets endpoint including owner data... ##########',
  );
  await executeManyPerfomanceTests(
    {
      url: `${appUrl}/pets?include=owner`,
      connections: 10, // default
      pipelining: 1, // default
      duration: 10, // default
    },
    {
      counter: 5, // default
      filename: 'simple-fetch.json', // default
    },
  );

  console.log(
    '########## Testing simple creation of pet documents... ##########',
  );
  await executeManyPerfomanceTests(
    {
      url: appUrl,
      connections: 10, // default
      pipelining: 1, // default
      duration: 10, // default
      requests: [
        {
          method: 'POST',
          path: '/pet-documents',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            'pet-documents': [
              {
                name: 'Rabies Vaccination Certificate',
                type: 'vaccination',
                issueDate: '2024-03-01T00:00:00Z',
                expiryDate: '2025-03-01T00:00:00Z',
                fileUrl: 'https://example.com/docs/rabies-vaccination.pdf',
                fileType: 'application/pdf',
                fileSize: 102400,
                issuingAuthority: 'City Vet Clinic',
                notes: 'Administered by Dr. Smith',
                links: {
                  pet: '68713c09d8a62cfa09ce8024',
                },
              },
            ],
          }),
        },
      ],
    },
    {
      counter: 5, // default
      filename: 'simple-creation.json', // default
    },
  );

  console.log('########## Testing simple update of pet document... ##########');
  await executeManyPerfomanceTests(
    {
      url: appUrl,
      connections: 10, // default
      pipelining: 1, // default
      duration: 10, // default
      requests: [
        {
          method: 'PATCH',
          path: '/pet-documents/64b5e7d6a1c9d1a10000000a', // Milo Beagle's document
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            {
              op: 'replace',
              path: '/pet-documents/0/notes',
              value: 'Updated notes for the pet document.',
            },
            {
              op: 'replace',
              path: '/pet-documents/0/links/pet',
              value: '68713c09d8a62cfa09ce8022',
            },
          ]),
        },
      ],
    },
    {
      counter: 5, // default
      filename: 'simple-update.json', // default
    },
  );
}

run().then(() => {
  process.exit(0);
});

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index),
    hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stddev(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function calcPercentiles(data) {
  return {
    average: mean(data),
    min: Math.min(...data),
    max: Math.max(...data),
    mean: mean(data),
    stddev: stddev(data),
    p0_001: percentile(data, 0.001),
    p0_01: percentile(data, 0.01),
    p0_1: percentile(data, 0.1),
    p1: percentile(data, 1),
    p2_5: percentile(data, 2.5),
    p10: percentile(data, 10),
    p25: percentile(data, 25),
    p50: percentile(data, 50),
    p75: percentile(data, 75),
    p90: percentile(data, 90),
    p97_5: percentile(data, 97.5),
    p99: percentile(data, 99),
    p99_9: percentile(data, 99.9),
    p99_99: percentile(data, 99.99),
    p99_999: percentile(data, 99.999),
  };
}

/**
 * Calculates the delta in usermode CPU usage from a series of Docker stats,
 * returning percentile statistics based on these deltas.
 *
 * ## Description:
 * - This function focuses only on **usermode CPU usage** (ignoring kernelmode).
 * - It calculates the difference in usermode usage between each consecutive reading.
 * - Converts **nanoseconds to milliseconds** for readability and practical analysis.
 * - Rounds each delta to **3 decimal digits precision**.
 * - Filters out any NaN values to ensure clean statistical computation.
 *
 * ## Parameters:
 * @param {Array<Object>} dockerStats - An array of Docker stats objects, each containing:
 *   - cpu_stats.cpu_usage.usage_in_usermode: The usermode CPU time used (in nanoseconds) at that reading.
 *
 * ## Returns:
 * @returns {Object} An object containing percentile statistics of usermode CPU usage deltas in **milliseconds**, including:
 *   - average, min, max, mean, stddev, p0_001, p0_01, p0_1, p1, p2_5, p10, p25, p50, p75, p90, p97_5, p99, p99_9, p99_99, p99_999
 *
 * ## Assumptions:
 * - The input array is **chronologically ordered** from oldest to newest.
 * - Counter resets (negative deltas) are treated as zero to avoid anomalies.
 * - `calcPercentiles` is a utility function defined elsewhere to calculate these percentile statistics.
 */
function calcCpuUsages(dockerStats) {
  let prevUsermode = null;

  const data = dockerStats
    .map((stat) => {
      const currUsermode = stat.cpu_stats.cpu_usage.usage_in_usermode;

      let usageDeltaMs = 0;
      if (prevUsermode !== null) {
        let usageDelta = currUsermode - prevUsermode;
        if (usageDelta < 0) {
          usageDelta = 0; // safeguard against counter resets
        }

        // Convert nanoseconds to milliseconds with 3 decimal digits
        usageDeltaMs = +(usageDelta / 1e6).toFixed(3);
      }

      prevUsermode = currUsermode;

      return usageDeltaMs;
    })
    .filter((v) => !isNaN(v));

  return calcPercentiles(data);
}

// Calculate memory usage percentage for each sample
function calcMemUsages(dockerStats) {
  const data = dockerStats
    .map((stat) => {
      const { usage, limit } = stat.memory_stats;
      if (limit <= 0) return 0;
      return (usage / limit) * 100;
    })
    .filter((v) => !isNaN(v));
  return calcPercentiles(data);
}

/**
 * Calculate per‑field averages for numeric properties.
 * @param {Array<Object>} data – array of objects with number fields
 * @returns {Object} averages by field name
 */
function calculateAverages(data) {
  const sums = {};
  const counts = {};

  data.forEach((item) => {
    Object.entries(item).forEach(([key, value]) => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        sums[key] = (sums[key] || 0) + value;
        counts[key] = (counts[key] || 0) + 1;
      }
    });
  });

  const averages = {};
  Object.keys(sums).forEach((key) => {
    averages[key] = sums[key] / counts[key];
  });
  return averages;
}

/**
 * Deletes all collections in the specified MongoDB database.
 *
 * @param {string} uri - The MongoDB connection URI (e.g., mongodb://localhost:27017)
 * @param {string} dbName - The name of the database to clean
 */
async function dropAllCollections(uri, dbName) {
  const client = new MongoClient(uri);

  try {
    // Connect to the database
    await client.connect();
    console.log(`\n### DB Clean - Connected to ${uri}`);

    const db = client.db(dbName);

    // Get all collection names
    const collections = await db.collections();

    if (collections.length === 0) {
      console.log('No collections found. Nothing to delete.');
      return;
    }

    // Drop each collection
    for (const collection of collections) {
      await collection.drop();
    }

    console.log(`All collections dropped from database '${dbName}'.`);
  } catch (err) {
    console.error('Error while dropping collections:', err);
  } finally {
    await client.close();
  }
}
