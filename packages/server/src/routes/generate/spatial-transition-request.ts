import type { PendingSpatialTransition } from "@marinara-engine/shared";

type SpatialGenerationMode = "conversation" | "roleplay" | "game";

export type SpatialGenerationRequestError = {
  statusCode: 400;
  error: string;
  code: "spatial_mode_unsupported" | "spatial_transition_requires_new_turn";
};

export function validateSpatialGenerationRequest(input: {
  mode: SpatialGenerationMode;
  pendingSpatialTransition?: PendingSpatialTransition | null;
  impersonate?: boolean;
  regenerateMessageId?: string | null;
  continueMessageId?: string | null;
}): SpatialGenerationRequestError | null {
  if (!input.pendingSpatialTransition) return null;
  if (input.mode !== "roleplay" && input.mode !== "game") {
    return {
      statusCode: 400,
      error: "Only Roleplay and Game chats can change hierarchical location.",
      code: "spatial_mode_unsupported",
    };
  }
  if (input.regenerateMessageId || input.continueMessageId) {
    return {
      statusCode: 400,
      error: "A hierarchical location change must be submitted as a new owner turn.",
      code: "spatial_transition_requires_new_turn",
    };
  }
  if (input.impersonate && input.mode !== "roleplay") {
    return {
      statusCode: 400,
      error: "Impersonated hierarchical location changes are only available in Roleplay mode.",
      code: "spatial_mode_unsupported",
    };
  }
  return null;
}
