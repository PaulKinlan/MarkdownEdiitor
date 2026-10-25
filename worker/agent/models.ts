import { createModels, type Models, type MutableModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelInfo } from "../../src/shared/protocol";
import type { Env } from "../env";
import { addDemoModel } from "./demo-model";

// Providers read their keys from process.env (populated from Worker secrets
// under nodejs_compat). Only providers with a key are offered.
const PROVIDERS = [
  { key: "ANTHROPIC_API_KEY", id: "anthropic", create: anthropicProvider },
  { key: "DEEPSEEK_API_KEY", id: "deepseek", create: deepseekProvider },
  { key: "OPENAI_API_KEY", id: "openai", create: openaiProvider },
  { key: "GEMINI_API_KEY", id: "google", create: googleProvider },
  { key: "OPENROUTER_API_KEY", id: "openrouter", create: openrouterProvider },
] as const;

export function createConfiguredModels(env: Env): MutableModels {
  const models = createModels();
  for (const p of PROVIDERS) if (env[p.key]) models.setProvider(p.create());
  if (env.DEMO_MODEL === "1") addDemoModel(models);
  return models;
}

export function listModels(models: Models): ModelInfo[] {
  return models
    .getModels()
    .map((m) => ({ provider: m.provider, modelId: m.id, name: m.name, reasoning: !!m.reasoning, contextWindow: m.contextWindow }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}
