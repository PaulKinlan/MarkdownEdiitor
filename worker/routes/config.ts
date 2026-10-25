import { createConfiguredModels, listModels } from "../agent/models";
import { defineRoutes } from "../route";
import { hasNativeWebSearch } from "../tools";

export default defineRoutes({
  method: "GET",
  pattern: /^\/api\/config$/,
  handle({ env }) {
    const models = createConfiguredModels(env);
    return Response.json({
      models: listModels(models).map((m) => ({ ...m, ...(hasNativeWebSearch(models, m.provider, m.modelId) ? { nativeWebSearch: true } : {}) })),
      webSearch: Boolean(env.BRAVE_API_KEY || env.TAVILY_API_KEY || env.DEEPSEEK_API_KEY),
    });
  },
});
