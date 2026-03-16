import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export function getAIProvider() {
  const provider = process.env.AI_PROVIDER || "anthropic";
  const model = process.env.AI_MODEL || "claude-sonnet-4-20250514";

  switch (provider) {
    case "anthropic":
      return createAnthropic()(model);
    case "openai":
      return createOpenAI()(model);
    default:
      return createAnthropic()(model);
  }
}
