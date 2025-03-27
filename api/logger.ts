import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import fs from "fs";
import path from "path";

// Ensure logs directory exists
const logDir = path.resolve("logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Custom log format
const logFormat = winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

// Logger instance
const logger = winston.createLogger({
    level: "info", // Default level
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.errors({ stack: true }), // Log error stack traces
        winston.format.splat(),
        logFormat
    ),
    transports: [
        // ✅ Console logs with color for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            ),
        }),

        // ✅ Error logs only
        new winston.transports.File({
            filename: path.join(logDir, "error.log"),
            level: "error",
        }),

        // ✅ All logs combined
        new winston.transports.File({
            filename: path.join(logDir, "combined.log"),
        }),

        // ✅ Daily rotating log file
        new DailyRotateFile({
            filename: path.join(logDir, "daily-%DATE%.log"),
            datePattern: "YYYY-MM-DD",
            zippedArchive: true,
            maxSize: "20m",
            maxFiles: "7d", // Keep logs for 14 days
        }),
    ],
});

export default logger;
