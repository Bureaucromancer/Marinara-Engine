// ──────────────────────────────────────────────
// React Query: Scenario hooks
// ──────────────────────────────────────────────
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import type { CreateScenarioInput, Scenario, UpdateScenarioInput } from "@marinara-engine/shared";
import { achievementKeys, trackAchievementEvent } from "./use-achievements";
import {
  collectAllPaginatedItems,
  flattenPaginatedItems,
  getNextPageOffset,
  LIBRARY_PAGE_SIZE,
  type PaginatedList,
} from "../lib/list-pagination";

export const scenarioKeys = {
  all: ["scenarios"] as const,
  list: () => [...scenarioKeys.all, "list"] as const,
  page: (search: string, sort: string, favoriteFilter: string) =>
    [...scenarioKeys.list(), "page", search, sort, favoriteFilter] as const,
  detail: (id: string) => [...scenarioKeys.all, "detail", id] as const,
};

export interface ScenarioPageOptions {
  search?: string;
  sort?: string;
  /** "" | "favorites" | "non-favorites" */
  favoriteFilter?: string;
}

function buildScenarioPageParams(options: ScenarioPageOptions, offset: number) {
  const params = new URLSearchParams({ limit: String(LIBRARY_PAGE_SIZE), offset: String(offset) });
  const search = (options.search ?? "").trim();
  if (search) params.set("search", search);
  if (options.sort) params.set("sort", options.sort);
  if (options.favoriteFilter) params.set("favoriteFilter", options.favoriteFilter);
  return params;
}

export function useScenarios() {
  return useQuery({
    queryKey: scenarioKeys.list(),
    queryFn: () => api.get<Scenario[]>("/scenarios"),
    staleTime: 5 * 60_000,
  });
}

export function useScenarioPages(options: ScenarioPageOptions) {
  const search = (options.search ?? "").trim();
  const sort = options.sort ?? "";
  const favoriteFilter = options.favoriteFilter ?? "";

  return useInfiniteQuery({
    queryKey: scenarioKeys.page(search, sort, favoriteFilter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<PaginatedList<Scenario>>(
        `/scenarios?${buildScenarioPageParams(options, Number(pageParam) || 0).toString()}`,
      ),
    getNextPageParam: getNextPageOffset,
    staleTime: 5 * 60_000,
  });
}

export function flattenScenarioPages(data: { pages?: Array<PaginatedList<Scenario>> } | undefined) {
  return flattenPaginatedItems(data?.pages);
}

/** Imperative twin of useScenarioPages, for bulk actions that need every match. */
export function fetchAllScenarioPages(options: ScenarioPageOptions = {}) {
  return collectAllPaginatedItems<Scenario>((offset) =>
    api.get<PaginatedList<Scenario>>(`/scenarios?${buildScenarioPageParams(options, offset).toString()}`),
  );
}

export function useScenario(id: string | null) {
  return useQuery({
    queryKey: scenarioKeys.detail(id ?? ""),
    queryFn: () => api.get<Scenario>(`/scenarios/${id}`),
    enabled: !!id,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 3;
    },
  });
}

export function useCreateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateScenarioInput> & { name: string }) =>
      api.post<Scenario>("/scenarios", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scenarioKeys.all });
      trackAchievementEvent("library_changed");
      qc.invalidateQueries({ queryKey: achievementKeys.all });
    },
  });
}

export function useUpdateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateScenarioInput & { id: string }) =>
      api.patch<Scenario>(`/scenarios/${id}`, input),
    onSuccess: (data, variables) => {
      qc.setQueryData(scenarioKeys.detail(variables.id), data);
      qc.invalidateQueries({ queryKey: scenarioKeys.list() });
    },
  });
}

export function useDeleteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/scenarios/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: scenarioKeys.detail(id) });
      qc.invalidateQueries({ queryKey: scenarioKeys.all });
      trackAchievementEvent("library_changed");
      qc.invalidateQueries({ queryKey: achievementKeys.all });
    },
  });
}

/**
 * Server-side duplicate (the character convention), so npc id minting and the
 * favorite/originalFilename resets happen in one place rather than being
 * reimplemented here.
 */
export function useDuplicateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Scenario>(`/scenarios/${id}/duplicate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: scenarioKeys.all }),
  });
}

export function useUploadScenarioImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, image }: { id: string; image: string }) =>
      api.post<Scenario>(`/scenarios/${id}/image`, { image }),
    onSuccess: (data, variables) => {
      qc.setQueryData(scenarioKeys.detail(variables.id), data);
      qc.invalidateQueries({ queryKey: scenarioKeys.all });
    },
  });
}
