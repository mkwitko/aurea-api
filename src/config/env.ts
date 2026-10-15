import { z } from 'zod';

// Uma chave presente mas em branco no .env chega como '' e derrotaria o
// `?? default` de quem consome. Normalizar aqui mantém a armadilha desarmada
// para todos os consumidores.
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

// Single source of validated configuration. No process.env access elsewhere.
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),

  REDIS_URL: z.string().default('redis://localhost:6380'),

  AI_PROVIDER_BASE_URL: z.string().default('https://api.deepseek.com'),
  AI_PROVIDER_API_KEY: optionalText,
  AI_MODEL_TIER1: optionalText,
  AI_MODEL_TIER2: optionalText,
  AI_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // 32 bytes em base64. Validada no boot: chave malformada tem que derrubar o
  // processo, não a primeira gravação de BYOK três dias depois.
  AI_KEY_ENCRYPTION_KEY: optionalText.refine(
    (v) => v === undefined || Buffer.from(v, 'base64').length === 32,
    'AI_KEY_ENCRYPTION_KEY must be 32 bytes encoded as base64',
  ),
  AI_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AI_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  // Sem sinal de vida por este tempo, o reaper considera o run morto. Folgado
  // de propósito em relação ao AI_RUN_TIMEOUT_MS: fechar um run vivo apaga
  // trabalho já pago, esperar mais só atrasa o estorno.
  AI_RUN_STALE_MS: z.coerce.number().int().positive().default(600_000),
  AI_RUN_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // Dois minutos sem sinal de vida é morte, não lentidão: uma publicação é uma
  // chamada HTTP, não um run de modelo.
  ACTION_STALE_MS: z.coerce.number().int().positive().default(120_000),
  ACTION_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ACTION_EXECUTION_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // O relógio dos experimentos. Granularidade de dia não precisa de mais: a
  // decisão compara datas, e atrasar quinze minutos é invisível para quem
  // declarou a duração em dias.
  EXPERIMENT_CLOCK_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  TAVILY_API_KEY: optionalText,

  // Tracing (Langfuse), self-hosted — traces carry customer business context,
  // so there is no cloud default. All three or none: a key without a baseUrl
  // would otherwise fall back to Langfuse Cloud, exactly what self-hosting
  // exists to avoid.
  LANGFUSE_SECRET_KEY: optionalText,
  LANGFUSE_PUBLIC_KEY: optionalText,
  LANGFUSE_BASEURL: optionalText,

  // Ausente desliga as rotas de billing e a rota do webhook: melhor a rota não
  // existir do que existir sem verificação de assinatura.
  STRIPE_SECRET_KEY: optionalText,
  STRIPE_WEBHOOK_SECRET: optionalText,
  STRIPE_PRICE_STARTER: optionalText,
  STRIPE_PRICE_GROWTH: optionalText,
  STRIPE_PRICE_SCALE: optionalText,
  STRIPE_PRICE_PACK_SMALL: optionalText,
  STRIPE_PRICE_PACK_MEDIUM: optionalText,
  STRIPE_PRICE_PACK_LARGE: optionalText,

  // OAuth do Google para conectar uma property do GA4. As três opcionais: sem
  // elas, só o caminho de service account existe, e isso é estado legítimo.
  GOOGLE_OAUTH_CLIENT_ID: optionalText,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalText,
  // Explícita, não derivada do host da requisição: o Google exige
  // correspondência exata com o que está registrado no console, e um valor
  // derivado falha como `redirect_uri_mismatch` — o erro mais caro de
  // diagnosticar deste fluxo.
  GOOGLE_OAUTH_REDIRECT_URI: optionalText,

  // A chave do provider social é da **conta AUREA**, não de um workspace: o que
  // separa clientes é o `external_id` carimbado em cada conta conectada
  // (spec §4). Opcional como as três acima: sem ela as rotas sociais respondem
  // 503 e o resto do produto sobe normal — e a suíte não precisa de chave nenhuma.
  POST_FOR_ME_API_KEY: optionalText,
  POST_FOR_ME_BASE_URL: z.string().url().default('https://api.postforme.dev'),
  /** Quantas leituras de status antes de desistir e marcar entrega incerta. */
  ACTION_POLL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(200).default(20),

  // Base do success/cancel do checkout e do retorno do portal. É o front, não a API.
  APP_URL: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v), 'APP_URL must have http or https protocol')
    .default('http://localhost:5173'),
});

// O default de localhost é conveniência de desenvolvimento, e em produção ele é
// uma armadilha: APP_URL é a base do success/cancel do checkout e do retorno do
// portal, então esquecê-la manda quem acabou de pagar para o localhost de alguém.
// Bootar limpo com isso é pior que não bootar — mesmo raciocínio já aplicado à
// AI_KEY_ENCRYPTION_KEY, que também falha no boot em vez de na primeira gravação.
export const envSchema = baseEnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && isLoopback(value.APP_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_URL'],
      message: 'APP_URL must be the public frontend url in production, not a loopback address',
    });
  }

  // Meia configuração de OAuth é um botão que leva a uma tela de erro do
  // Google. As três juntas, ou nenhuma.
  const oauth = {
    GOOGLE_OAUTH_CLIENT_ID: value.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: value.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: value.GOOGLE_OAUTH_REDIRECT_URI,
  } as const;
  const present = Object.entries(oauth).filter(([, v]) => v !== undefined);
  if (present.length > 0 && present.length < 3) {
    for (const [key, v] of Object.entries(oauth)) {
      if (v === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'set all three GOOGLE_OAUTH_* variables, or none of them',
        });
      }
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail closed: never boot with invalid configuration.
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
