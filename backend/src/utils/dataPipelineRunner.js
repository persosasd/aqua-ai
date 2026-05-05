const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const logger = require('./logger');

const truthyValues = new Set(['true', '1', 'yes', 'on']);

const shouldRunPipeline = () => {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const flag = (process.env.DATA_PIPELINE_ON_START || '').toLowerCase();
  return truthyValues.has(flag);
};

const resolveScriptPath = () => {
  if (process.env.DATA_PIPELINE_SCRIPT) {
    return path.resolve(process.env.DATA_PIPELINE_SCRIPT);
  }
  return path.resolve(__dirname, '..', '..', 'data-pipeline', 'fetch_data.py');
};

const lockFilePath =
  process.env.DATA_PIPELINE_LOCK_FILE ||
  path.join(os.tmpdir(), 'aqua-ai-data-pipeline.lock');

const acquireLock = () => {
  try {
    fs.writeFileSync(lockFilePath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      logger.warn('Data pipeline lock exists; skipping start', {
        lockFilePath,
      });
      return false;
    }
    logger.error('Failed to acquire data pipeline lock', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });
    return false;
  }
};

const releaseLock = () => {
  fs.unlink(lockFilePath, (error) => {
    if (!error || error.code === 'ENOENT') {
      return;
    }
    logger.warn('Failed to release data pipeline lock', {
      message: error.message,
      code: error.code,
    });
  });
};

const startDataPipeline = () => {
  if (!shouldRunPipeline()) {
    return;
  }

  if (!acquireLock()) {
    return;
  }

  const scriptPath = resolveScriptPath();
  if (!fs.existsSync(scriptPath)) {
    logger.warn('Data pipeline script not found', { scriptPath });
    releaseLock();
    return;
  }

  const pythonCommand = process.env.DATA_PIPELINE_PYTHON || 'python3';
  logger.info('Starting data pipeline on startup', {
    scriptPath,
    pythonCommand,
  });

  const child = spawn(pythonCommand, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const output = chunk.toString().trim();
      if (output) {
        logger.info('Data pipeline output', { output });
      }
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const output = chunk.toString().trim();
      if (output) {
        logger.warn('Data pipeline error output', { output });
      }
    });
  }

  child.on('error', (error) => {
    logger.error('Failed to start data pipeline', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    releaseLock();
  });

  child.on('exit', (code) => {
    if (code === 0) {
      logger.info('Data pipeline completed successfully');
      releaseLock();
      return;
    }
    logger.warn('Data pipeline exited with a non-zero code', { code });
    releaseLock();
  });
};

module.exports = { startDataPipeline };
