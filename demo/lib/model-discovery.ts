import type { ModelCatalogPreset } from "./model-catalog";

export interface DiscoveredModel {
  id: string;
  name?: string;
  /** Native reasoning support advertised by the provider. */
  reasoning?: boolean;
  /** Image input support advertised by the provider. */
  vision?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = positiveNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  const name = cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);

  const model: DiscoveredModel = { id };
  if (name && name !== id) model.name = name;
  if (typeof value.reasoning === "boolean") model.reasoning = value.reasoning;
  const vision = typeof value.vision === "boolean"
    ? value.vision
    : Array.isArray(value.modalities) && value.modalities.includes("image")
      ? true
      : undefined;
  if (vision !== undefined) model.vision = vision;

  // OpenAI-compatible relays commonly expose limits as `context_window` /
  // `max_output_tokens`; other providers nest them under `limit`.
  const limit = isRecord(value.limit) ? value.limit : undefined;
  const contextWindow = firstNumber(value.context_window, value.contextWindow, limit?.context);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  const maxTokens = firstNumber(value.max_output_tokens, value.maxOutputTokens, limit?.output);
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  return model;
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

/** The advertised model with the given id, for filling one model's details. */
export function findDiscoveredModel(
  models: readonly DiscoveredModel[],
  id: string,
): DiscoveredModel | undefined {
  const wanted = id.trim();
  if (!wanted) return undefined;
  return models.find((model) => model.id === wanted);
}

/**
 * Turn a provider-advertised model into a models.dev-shaped preset. This backs
 * "fill model details" for a custom provider models.dev does not know: the
 * provider's own list carries context window, output limit, vision and
 * reasoning, but never a price.
 */
export function discoveryModelToPreset(model: DiscoveredModel): ModelCatalogPreset {
  const preset: ModelCatalogPreset = {};
  if (model.name) preset.name = model.name;
  if (typeof model.reasoning === "boolean") preset.reasoning = model.reasoning;
  if (model.vision === true) preset.input = ["text", "image"];
  else if (model.vision === false) preset.input = ["text"];
  if (model.contextWindow !== undefined) preset.contextWindow = model.contextWindow;
  if (model.maxTokens !== undefined) preset.maxTokens = model.maxTokens;
  return preset;
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}
