import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info'
});
