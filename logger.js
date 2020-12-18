const winston = require('winston') 
const config = require('./config')
const { combine, timestamp, label, printf, splat} = winston.format;

const myFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

const logger = winston.createLogger({
  level: config.logger.level,
  //format: winston.format.json(),
  format: combine(
    label({ label: 'oracledb' }),
    timestamp(),
    splat(),
    myFormat
  ),
  //defaultMeta: { service: 'oracledb' },
  transports: [
    //
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
/*if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}*/

module.exports = {
  logger: logger,
}