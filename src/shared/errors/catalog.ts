import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALE_FILES: Record<string, Record<string, string>> = {};

function loadLocale(locale: string): Record<string, string> {
  if (LOCALE_FILES[locale]) return LOCALE_FILES[locale]!;
  try {
    const path = join(import.meta.dirname, 'i18n', `${locale}.json`);
    LOCALE_FILES[locale] = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    LOCALE_FILES[locale] = {};
  }
  return LOCALE_FILES[locale]!;
}

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? `{{${key}}}`));
}

export interface ErrorDef {
  code: string;
  status: number;
}

const CATALOG: Record<string, ErrorDef> = {
  BAD_REQUEST: { code: 'AUR-T0001', status: 400 },
  VALIDATION: { code: 'AUR-T0002', status: 400 },
  UNAUTHORIZED: { code: 'AUR-T0003', status: 401 },
  FORBIDDEN: { code: 'AUR-T0004', status: 403 },
  NOT_FOUND: { code: 'AUR-T0005', status: 404 },
  CONFLICT: { code: 'AUR-T0006', status: 409 },
  INTERNAL: { code: 'AUR-T0007', status: 500 },
  FILE_TYPE_NOT_ALLOWED: { code: 'AUR-T0008', status: 400 },
  INVALID_SECTION: { code: 'AUR-T0009', status: 400 },
  R2_NOT_CONFIGURED: { code: 'AUR-T0010', status: 500 },
  FILE_TOO_LARGE: { code: 'AUR-T0011', status: 413 },
  UNKNOWN_TASK_TYPE: { code: 'AUR-T0012', status: 400 },
  INSUFFICIENT_CREDITS: { code: 'AUR-T0013', status: 402 },
  INVALID_PROVIDER_KEY: { code: 'AUR-T0014', status: 400 },
  ENCRYPTION_NOT_CONFIGURED: { code: 'AUR-T0015', status: 500 },
  BILLING_NOT_CONFIGURED: { code: 'AUR-T0016', status: 500 },
  WORKSPACE_LIMIT_REACHED: { code: 'AUR-T0017', status: 403 },
  UNKNOWN_CREDIT_PACK: { code: 'AUR-T0018', status: 400 },
  NO_ACTIVE_SUBSCRIPTION: { code: 'AUR-T0019', status: 409 },
  MEASUREMENT_FROZEN: { code: 'AUR-T0020', status: 409 },
  SEARCH_NOT_CONFIGURED: { code: 'AUR-T0021', status: 500 },
  EXPERIMENT_NOT_COMPLETED: { code: 'AUR-T0022', status: 400 },
  NO_OUTCOMES_RECORDED: { code: 'AUR-T0023', status: 400 },
  RUN_NOT_INTERPRETATION: { code: 'AUR-T0024', status: 400 },
  RUN_NOT_COMPLETED: { code: 'AUR-T0025', status: 400 },
  RUN_INPUT_UNREADABLE: { code: 'AUR-T0026', status: 400 },
  RUN_OUTPUT_UNREADABLE: { code: 'AUR-T0027', status: 400 },
  LEARNING_ALREADY_ACCEPTED: { code: 'AUR-T0028', status: 400 },
  BUSINESS_WEBSITE_REQUIRED: { code: 'AUR-T0029', status: 400 },
  BUSINESS_CONTEXT_TOO_EMPTY: { code: 'AUR-T0030', status: 400 },
  NO_ACTIVE_ICP: { code: 'AUR-T0031', status: 400 },
  STRATEGY_NOT_SELECTED: { code: 'AUR-T0032', status: 400 },
  SECTION_NOT_PROPOSABLE: { code: 'AUR-T0033', status: 400 },
  RUN_ALREADY_FINISHED: { code: 'AUR-T0034', status: 409 },
  AGENT_RUN_IN_PROGRESS: { code: 'AUR-T0035', status: 409 },
  NO_METRIC_BINDING: { code: 'AUR-T0036', status: 400 },
  NO_ANALYTICS_SOURCE: { code: 'AUR-T0037', status: 400 },
  NO_MEASUREMENT_PERIOD: { code: 'AUR-T0038', status: 400 },
  // 502 e não 400: a requisição está correta e o recurso existe — quem recusou
  // foi a fonte. Um 400 aqui mandaria o fundador corrigir o que ele acertou.
  MEASUREMENT_READ_FAILED: { code: 'AUR-T0039', status: 502 },
  NO_ANALYTICS_PROPERTY: { code: 'AUR-T0040', status: 400 },
  ACTION_NOT_RESOLVABLE: { code: 'AUR-T0044', status: 409 },
  // AUR-T0041..0043 eram do Postiz, aposentado. Os números ficam queimados de
  // propósito: um código já citado num log ou num ticket não pode passar a
  // significar outra coisa.
  //
  // 503 e não 400: a instância não tem chave da conta AUREA, e não há nada que o
  // fundador possa corrigir na requisição dele.
  //
  // Os cinco códigos abaixo nasceram com prefixo do fornecedor anterior. Os
  // **números** não mudam na troca de provider: o significado de cada um é o
  // mesmo, e renumerar quebraria log e ticket sem ganho nenhum.
  SOCIAL_NOT_CONFIGURED: { code: 'AUR-T0045', status: 503 },
  SOCIAL_NOT_CONNECTED: { code: 'AUR-T0046', status: 400 },
  SOCIAL_ACCOUNT_NOT_CONNECTED: { code: 'AUR-T0047', status: 400 },
  // 502 pela mesma razão de MEASUREMENT_READ_FAILED: a requisição está correta
  // e o recurso existe — quem recusou foi o provider. Um 400 mandaria o
  // fundador corrigir o que ele acertou.
  SOCIAL_REQUEST_FAILED: { code: 'AUR-T0048', status: 502 },
  SOCIAL_PLAN_LIMIT: { code: 'AUR-T0049', status: 409 },
  ACTION_NOT_EDITABLE: { code: 'AUR-T0050', status: 409 },
  ACTION_NOTHING_TO_PUBLISH: { code: 'AUR-T0051', status: 409 },
};

export function translateError(
  code: string,
  locale: string,
  params?: Record<string, unknown>,
): string {
  const bundle = loadLocale(locale);
  const fallback = loadLocale('pt-BR');
  const template = bundle[code] ?? fallback[code] ?? code;
  return params ? interpolate(template, params) : template;
}

export function getErrorDef(key: keyof typeof CATALOG): ErrorDef {
  return CATALOG[key]!;
}

export { CATALOG };
