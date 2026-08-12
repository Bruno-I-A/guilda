import "server-only";

export type AiConfig = Readonly<{
  apiKey?: string;
  model: string;
}>;

function optionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function getAiConfig(): AiConfig {
  return {
    apiKey: optionalEnv(process.env.ANTHROPIC_API_KEY),
    model: optionalEnv(process.env.ANTHROPIC_MODEL) ?? "claude-sonnet-5",
  };
}

export function isAiConfigured(): boolean {
  return Boolean(getAiConfig().apiKey);
}
