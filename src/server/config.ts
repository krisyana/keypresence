export interface Config {
  databaseUrl: string | null;
  pgliteDir: string;
  appUrl: string;
  port: number;
  masterSecret: string;
  jobsInProcess: boolean;
  aiProvider: 'rules' | 'anthropic';
  anthropicApiKey: string | null;
  production: boolean;
}

const PLACEHOLDER = 'change-me-change-me-change-me-change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const masterSecret = env.MASTER_SECRET || PLACEHOLDER;
  if (masterSecret.length < 32) throw new Error('MASTER_SECRET must be at least 32 characters');
  if (production && masterSecret === PLACEHOLDER) {
    throw new Error('Refusing to start in production with the placeholder MASTER_SECRET');
  }
  return {
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR || '.data/pglite',
    appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    port: Number(env.PORT || 8787),
    masterSecret,
    jobsInProcess: (env.JOBS_IN_PROCESS ?? '1') !== '0',
    aiProvider: env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'rules',
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    production,
  };
}
