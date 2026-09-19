import pino from 'pino'

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['RELAYER_PRIVATE_KEY', '*.privateKey', '*.sig'],
    censor: '[redacted]',
  },
})
