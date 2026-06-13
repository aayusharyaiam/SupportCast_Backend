import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  CUSTOMER_JWT_SECRET: z.string().min(16),
  CUSTOMER_JWT_EXPIRES_IN: z.string().default('2h'),
  MEDIASOUP_MIN_PORT: z.coerce.number().int().default(10000),
  MEDIASOUP_MAX_PORT: z.coerce.number().int().default(10100),
  MEDIASOUP_ANNOUNCED_IP: z.string().default('127.0.0.1'),
  MEDIASOUP_LISTEN_PORT: z.coerce.number().int().default(44444),
  TURN_URLS: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_CREDENTIAL: z.string().default(''),
  RECORDING_TEMP_DIR: z.string().default('/tmp/recordings'),
  SUPABASE_STORAGE_BUCKET: z.string().default('recordings'),
  LOG_LEVEL: z.string().default('info')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
