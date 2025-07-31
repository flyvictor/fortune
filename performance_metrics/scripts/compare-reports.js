const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));

if (!argv.base || !argv.comp) {
  console.error('Please provide --base and --comp arguments');
  process.exit(1);
}

if (!argv.fileName) {
  console.error('Please provide --fileName argument');
  process.exit(1);
}

if (
  !fs.existsSync(`./reports/${argv.base}`) ||
  !fs.existsSync(`./reports/${argv.comp}`)
) {
  console.error('Base or comparison report file does not exist');
  process.exit(1);
}

/**
 * Determines which value is better based on direction.
 * @param {number} base
 * @param {number} comp
 * @param {boolean} higherBetter
 * @returns {'base' | 'comp'}
 */
function determineWinner(base, comp, higherBetter) {
  if (higherBetter) {
    return comp > base ? 'comp' : 'base';
  } else {
    return comp < base ? 'comp' : 'base';
  }
}

/**
 * Calculates the absolute and percentage difference between two numbers.
 * @param {number} base
 * @param {number} comp
 * @returns {{ diff: number, percent: number | null }}
 */
function calculateDiff(base, comp) {
  const diff = Math.abs(comp - base);
  const percent = base !== 0 ? (diff / base) * 100 : null;
  return { diff, percent };
}

/**
 * Compares two numeric metrics and returns the comparison object.
 * @param {number} base
 * @param {number} comp
 * @param {boolean} higherBetter
 * @returns {object}
 */
function compareMetric(base, comp, higherBetter) {
  const winner = determineWinner(base, comp, higherBetter);
  const { diff, percent } = calculateDiff(base, comp);

  return {
    base: +base.toFixed(6),
    comp: +comp.toFixed(6),
    winner,
    diff: +diff.toFixed(6),
    percent: percent == null ? null : +percent.toFixed(2),
  };
}

/**
 * Compares two sections (e.g. cpuUsages) and returns the comparison results.
 * @param {object} baseSection
 * @param {object} compSection
 * @param {boolean} higherBetter
 * @returns {object}
 */
function compareSection(baseSection, compSection, higherBetter) {
  const result = {};

  for (const metric of Object.keys(baseSection)) {
    const baseValue = baseSection[metric];
    const compValue = compSection[metric];

    if (typeof baseValue !== 'number' || typeof compValue !== 'number')
      continue;

    result[metric] = compareMetric(baseValue, compValue, higherBetter);
  }

  return result;
}

/**
 * Main function to compare two reports.
 * @param {object} base
 * @param {object} comp
 * @param {object} direction – map of section names to boolean: true if higher is better
 * @returns {object}
 */
function compareReports(base, comp, direction = {}) {
  const finalResult = {};

  for (const section of Object.keys(base)) {
    if (!(section in comp)) continue;

    const higherBetter = !!direction[section];
    finalResult[section] = compareSection(
      base[section],
      comp[section],
      higherBetter,
    );
  }

  return finalResult;
}

function runComparison(fileName) {
  const baseline = JSON.parse(
    fs.readFileSync(`./reports/${argv.base}/${fileName}`, 'utf8'),
  );
  const current = JSON.parse(
    fs.readFileSync(`./reports/${argv.comp}/${fileName}`, 'utf8'),
  );

  // Define which sections are “higher better”
  const direction = {
    requests: true, // more requests is better
    // cpuUsages, memUsages, latency: left false => lower is better
  };
  const diff = compareReports(baseline, current, direction);
  console.log(JSON.stringify(diff, null, 2));
}

runComparison(argv.fileName);
