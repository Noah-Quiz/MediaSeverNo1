const winston = require("winston");
const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf, colorize } = format;

const upperCaseLevel = format((info) => {
  info.level = info.level.toUpperCase();
  return info;
});

const logFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] [${level}]: ${message}`;
});

const getLogger = (customLabel) => {
  return createLogger({
    format: combine(
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      label({ label: customLabel }),
      upperCaseLevel(),
      colorize(),
      logFormat
    ),
    transports: [
      new transports.Console()
    ],
  });
};

module.exports = getLogger;
