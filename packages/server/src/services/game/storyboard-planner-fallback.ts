export const STORYBOARD_FALLBACK_BEAT_MAX_CHARS = 2000;

const STORYBOARD_REVIEW_PLAN_KIND = "marinara-storyboard-review-plan-v1";
const STORYBOARD_PLANNER_ERROR_MAX_CHARS = 1200;

export interface StoryboardReviewPlanEnvelope {
  kind: typeof STORYBOARD_REVIEW_PLAN_KIND;
  plan: unknown;
  plannerError: string | null;
  usedFallbackPlanner: boolean;
}

export function compactStoryboardFallbackBeat(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length <= STORYBOARD_FALLBACK_BEAT_MAX_CHARS) return text;

  const contentLimit = STORYBOARD_FALLBACK_BEAT_MAX_CHARS - 3;
  const candidate = text.slice(0, contentLimit + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const cutoff = wordBoundary > 0 ? wordBoundary : contentLimit;
  return `${candidate.slice(0, cutoff).trimEnd()}...`;
}

export function createStoryboardReviewPlanEnvelope(args: {
  plan: unknown;
  plannerError: string | null;
  usedFallbackPlanner: boolean;
}): StoryboardReviewPlanEnvelope {
  return {
    kind: STORYBOARD_REVIEW_PLAN_KIND,
    plan: args.plan,
    plannerError: args.plannerError,
    usedFallbackPlanner: args.usedFallbackPlanner,
  };
}

export function resolveStoryboardReviewPlanEnvelope(value: unknown): {
  plan: unknown;
  plannerError: string | null;
  usedFallbackPlanner: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { plan: value, plannerError: null, usedFallbackPlanner: false };
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== STORYBOARD_REVIEW_PLAN_KIND || !("plan" in record)) {
    return { plan: value, plannerError: null, usedFallbackPlanner: false };
  }

  const plannerError =
    typeof record.plannerError === "string"
      ? record.plannerError.trim().slice(0, STORYBOARD_PLANNER_ERROR_MAX_CHARS) || null
      : null;
  return {
    plan: record.plan,
    plannerError,
    usedFallbackPlanner: record.usedFallbackPlanner === true || plannerError != null,
  };
}
