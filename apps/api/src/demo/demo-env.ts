// Imported first by demo-reset: the environment must be in place before the app module loads.
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';

const envFile = process.argv[2] ?? '.env.demo';
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });
// The builder needs the job workers (thumbnails, notifications) in this process.
process.env.JOBS_ENABLED = 'true';
// Only problems on screen while building.
process.env.LOG_LEVEL = 'warn';
