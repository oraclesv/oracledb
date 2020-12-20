const winston = require('winston') 
const config = require('./config')
const { combine, timestamp, label, printf, splat} = winston.format;

const myFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});
    
const DailyRotateFile = require('winston-daily-rotate-file');

const transport = new winston.transports.DailyRotateFile({
  filename: 'oracledb-%DATE%.log',
  datePattern: 'YYYY-MM-DD-HH',
  zippedArchive: true,
  frequency: '24h',
  //maxSize: '200m',
  maxFiles: '30d'
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
    transport,
    //new winston.transports.File({ filename: 'error.log', level: 'error' }),
    //new winston.transports.File({ filename: 'combined.log' }),
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