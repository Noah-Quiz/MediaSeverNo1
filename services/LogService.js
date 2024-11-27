const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../logs");

/**
 * Get the latest log file in the logs directory.
 */
const getLatestLogFile = () => {
  const files = fs.readdirSync(LOG_DIR);
  const logFiles = files.filter((file) => file.endsWith(".log"));

  if (logFiles.length === 0) {
    throw new Error("No log files found");
  }

  // Sort files by modification time in descending order
  logFiles.sort((a, b) => {
    const timeA = fs.statSync(path.join(LOG_DIR, a)).mtime;
    const timeB = fs.statSync(path.join(LOG_DIR, b)).mtime;
    return timeB - timeA;
  });

  return path.join(LOG_DIR, logFiles[0]);
};

/**
 * Read and return the content of the latest log file.
 */
const getLatestLogContent = () => {
  try {
    const latestLogFile = getLatestLogFile();
    const content = fs.readFileSync(latestLogFile, "utf-8");
    return content;
  } catch (error) {
    throw new Error(`Error reading log file: ${error.message}`);
  }
};

module.exports = { getLatestLogContent };
