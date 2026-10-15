import { translateError, getErrorDef } from '../shared/errors/catalog.js';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message?: string, details?: unknown) {
    const def = getErrorDef('BAD_REQUEST');
    super(def.status, def.code, message ?? translateError(def.code, 'pt-BR'), details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message?: string) {
    const def = getErrorDef('UNAUTHORIZED');
    super(def.status, def.code, message ?? translateError(def.code, 'pt-BR'));
  }
}

export class ForbiddenError extends AppError {
  constructor(message?: string) {
    const def = getErrorDef('FORBIDDEN');
    super(def.status, def.code, message ?? translateError(def.code, 'pt-BR'));
  }
}

export class NotFoundError extends AppError {
  constructor(message?: string) {
    const def = getErrorDef('NOT_FOUND');
    super(def.status, def.code, message ?? translateError(def.code, 'pt-BR'));
  }
}

export class ConflictError extends AppError {
  constructor(message?: string, details?: unknown) {
    const def = getErrorDef('CONFLICT');
    super(def.status, def.code, message ?? translateError(def.code, 'pt-BR'), details);
  }
}

export class FileTypeNotAllowedError extends AppError {
  constructor(params: { contentType: string; type: string }) {
    const def = getErrorDef('FILE_TYPE_NOT_ALLOWED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class InvalidSectionError extends AppError {
  constructor(params: { section: string }) {
    const def = getErrorDef('INVALID_SECTION');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class R2NotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('R2_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class FileTooLargeError extends AppError {
  constructor(params: { size: number; maxSize: number }) {
    const def = getErrorDef('FILE_TOO_LARGE');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class UnknownTaskTypeHttpError extends AppError {
  constructor(params: { taskType: string }) {
    const def = getErrorDef('UNKNOWN_TASK_TYPE');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(params: { required: number; available: number }) {
    const def = getErrorDef('INSUFFICIENT_CREDITS');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class InvalidProviderKeyError extends AppError {
  constructor(params: { provider: string }) {
    const def = getErrorDef('INVALID_PROVIDER_KEY');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class EncryptionNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('ENCRYPTION_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class BillingNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('BILLING_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class SearchNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('SEARCH_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class ExperimentNotCompletedError extends AppError {
  constructor() {
    const def = getErrorDef('EXPERIMENT_NOT_COMPLETED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoOutcomesRecordedError extends AppError {
  constructor() {
    const def = getErrorDef('NO_OUTCOMES_RECORDED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class WorkspaceLimitReachedError extends AppError {
  constructor(params: { current: number; max: number }) {
    const def = getErrorDef('WORKSPACE_LIMIT_REACHED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class UnknownCreditPackError extends AppError {
  constructor(params: { packId: string }) {
    const def = getErrorDef('UNKNOWN_CREDIT_PACK');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

// Distinta de NotFoundError: a organização existe, e o problema é o estado
// dela, não a existência do recurso — a mesma razão pela qual WORKSPACE_LIMIT
// não é 404. 409 porque a requisição conflita com o estado atual (sem
// assinatura, ou cancelada), não com a identidade do que foi pedido.
/**
 * The measurement contract — metric, baseline, target, success criteria — is
 * fixed once an experiment is approved. See docs/domains/experiments.md §13:
 * defining success after seeing results invalidates the test.
 */
export class MeasurementFrozenError extends AppError {
  constructor() {
    const def = getErrorDef('MEASUREMENT_FROZEN');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoActiveSubscriptionError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ACTIVE_SUBSCRIPTION');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

// The four (five, counting the P2002 translation below) refusals in
// POST /learnings/from-run. Catalog entries so `apiErrorMessage` shows
// localized copy instead of raw English to a PT/ES founder.
export class RunNotInterpretationError extends AppError {
  constructor() {
    const def = getErrorDef('RUN_NOT_INTERPRETATION');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class RunNotCompletedError extends AppError {
  constructor() {
    const def = getErrorDef('RUN_NOT_COMPLETED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class RunInputUnreadableError extends AppError {
  constructor() {
    const def = getErrorDef('RUN_INPUT_UNREADABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class RunOutputUnreadableError extends AppError {
  constructor() {
    const def = getErrorDef('RUN_OUTPUT_UNREADABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class LearningAlreadyAcceptedError extends AppError {
  constructor() {
    const def = getErrorDef('LEARNING_ALREADY_ACCEPTED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

// As cinco recusas dos agentes de preenchimento. Todas 400 e não 404: o
// recurso existe, o que falta é o dado de entrada que tornaria o run útil —
// e recusar aqui é o que evita cobrar crédito por um run sem como funcionar.
export class BusinessWebsiteRequiredError extends AppError {
  constructor() {
    const def = getErrorDef('BUSINESS_WEBSITE_REQUIRED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class BusinessContextTooEmptyError extends AppError {
  constructor() {
    const def = getErrorDef('BUSINESS_CONTEXT_TOO_EMPTY');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoActiveIcpError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ACTIVE_ICP');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class StrategyNotSelectedError extends AppError {
  constructor() {
    const def = getErrorDef('STRATEGY_NOT_SELECTED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class RunAlreadyFinishedError extends AppError {
  constructor(params: { status: string }) {
    const def = getErrorDef('RUN_ALREADY_FINISHED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class AgentRunInProgressError extends AppError {
  constructor(params: { runId: string; taskType: string; startedAt: string }) {
    const def = getErrorDef('AGENT_RUN_IN_PROGRESS');
    super(def.status, def.code, translateError(def.code, 'pt-BR'), params);
  }
}

export class SectionNotProposableError extends AppError {
  constructor(params: { section: string }) {
    const def = getErrorDef('SECTION_NOT_PROPOSABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

// As três recusas de setup da medição automática, com códigos distintos porque
// a tela decide coisas diferentes com cada uma: pedir amarração, pedir conexão,
// ou pedir as datas do experimento (spec §9).
export class NoMetricBindingError extends AppError {
  constructor() {
    const def = getErrorDef('NO_METRIC_BINDING');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoAnalyticsSourceError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ANALYTICS_SOURCE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoMeasurementPeriodError extends AppError {
  constructor() {
    const def = getErrorDef('NO_MEASUREMENT_PERIOD');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/** A recusa da própria fonte, com a mensagem dela nos detalhes. */
export class MeasurementReadFailedError extends AppError {
  constructor(params: { reason: string }) {
    const def = getErrorDef('MEASUREMENT_READ_FAILED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

/**
 * Conectado, sem property. Distinto de `NoAnalyticsSourceError`: aqui a
 * credencial existe e o que falta é a escolha — e a tela oferece escolher, não
 * conectar.
 */
export class NoAnalyticsPropertyError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ANALYTICS_PROPERTY');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/**
 * As recusas da publicação social. Códigos distintos porque a tela faz coisas
 * diferentes com cada uma: dizer que a instância não está configurada, mandar
 * conectar as redes, mandar conectar *aquela* rede, mostrar a mensagem do
 * provider, avisar do limite do plano, ou dizer que não há o que fazer.
 */
export class SocialNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('SOCIAL_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class SocialNotConnectedError extends AppError {
  constructor() {
    const def = getErrorDef('SOCIAL_NOT_CONNECTED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/**
 * A rede pedida não tem conta conectada — ou tem uma que o provider marcou como
 * desconectada, que para fins de publicação é o mesmo: falharia.
 */
export class SocialAccountNotConnectedError extends AppError {
  constructor(params: { platform: string }) {
    const def = getErrorDef('SOCIAL_ACCOUNT_NOT_CONNECTED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

/** A recusa do próprio provider, com a mensagem dele nos detalhes. */
export class SocialRequestFailedError extends AppError {
  constructor(params: { reason: string }) {
    const def = getErrorDef('SOCIAL_REQUEST_FAILED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class SocialPlanLimitError extends AppError {
  constructor() {
    const def = getErrorDef('SOCIAL_PLAN_LIMIT');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class ActionNotResolvableError extends AppError {
  constructor() {
    const def = getErrorDef('ACTION_NOT_RESOLVABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/** Editar depois da aprovação mudaria o que foi aprovado. */
export class ActionNotEditableError extends AppError {
  constructor() {
    const def = getErrorDef('ACTION_NOT_EDITABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/**
 * Não há alvo publicável e não há `providerRequestId`: publicar de novo os alvos
 * incertos criaria post duplicado, e não existe id para consultar. A saída é
 * humana, alvo por alvo.
 */
export class ActionNothingToPublishError extends AppError {
  constructor() {
    const def = getErrorDef('ACTION_NOTHING_TO_PUBLISH');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}
