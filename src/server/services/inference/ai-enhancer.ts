/**
 * Stage 4 (optional): AI-powered enhancement of inference results.
 * Wraps the classifier to provide structured ParsedField outputs
 * suitable for merging with other inference stages.
 */

import { classifyTransaction } from "@/server/services/ai/classifier";
import type { ParsedField } from "./text-parser";

export interface AIEnhanceResult {
  beneficiaryId?: ParsedField<string>;
  categoryId?: ParsedField<string>;
  description?: ParsedField<string>;
}

/**
 * Use AI to enhance inference results. This is the most expensive
 * stage and should only be triggered on user request ("Melhorar com IA").
 */
export async function enhanceWithAI(
  rawText: string,
  userId: string,
): Promise<AIEnhanceResult> {
  const result: AIEnhanceResult = {};

  try {
    const classification = await classifyTransaction(rawText, userId);

    if (classification.beneficiaryId) {
      result.beneficiaryId = {
        value: classification.beneficiaryId,
        confidence: classification.confidence,
        source: "ai",
      };
    }

    if (classification.categoryId) {
      result.categoryId = {
        value: classification.categoryId,
        confidence: classification.confidence,
        source: "ai",
      };
    }

    if (classification.suggestedDescription) {
      result.description = {
        value: classification.suggestedDescription,
        confidence: classification.confidence * 0.9,
        source: "ai",
      };
    }
  } catch (error) {
    console.error("AI enhancement failed:", error);
    // Return empty — AI is optional, non-blocking
  }

  return result;
}
