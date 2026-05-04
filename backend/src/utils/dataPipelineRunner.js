const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

const startDataPipeline = () => {
  if (!shouldRunPipeline()) {
    return;
  }

  const scriptPath = resolveScriptPath();
  if (!fs.existsSync(scriptPath)) {
    logger.warn('Data pipeline script not found', { scriptPath });
    return;
  }

  const pythonCommand = process.env.DATA_PIPELINE_PYTHON || 'python';
  logger.info('Starting data pipeline on startup', {
    scriptPath,
    pythonCommand,
  });

  const child = spawn(pythonCommand, [scriptPath], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (error) => {
    logger.error('Failed to start data pipeline', { message: error.message });
  });

  child.on('exit', (code) => {
    if (code === 0) {
      logger.info('Data pipeline completed successfully');
      return;
    }
    logger.warn('Data pipeline exited with a non-zero code', { code });
  });
};

module.exports = { startDataPipeline };
