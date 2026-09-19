import { z } from 'zod'

const schema = z.object({
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'relayer key must be 0x + 64 hex'),
  CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'contract address missing'),
  RPC_URL: z.string().url().default('https://testnet-rpc.monad.xyz'),
  RPC_URL_FALLBACK: z.string().url().default('https://rpc.ankr.com/monad_testnet'),
  CHAIN_ID: z.coerce.number().int().default(10143),
  PORT: z.coerce.number().int().default(8080),
  OP_KEY: z.string().min(6, 'operator panel needs a secret'),
})

/** Validated at startup: the process must crash immediately if anything is missing. */
export const env = (() => {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // Never print values — only which keys are wrong.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
    throw new Error(`invalid environment:\n  ${issues}`)
  }
  return parsed.data
})()
