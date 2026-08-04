import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { LibraryFolderScope } from "@marinara-engine/shared";

export type { LibraryFolderScope } from "@marinara-engine/shared";

export type LibraryFolder = {
  id: string;
  scope: LibraryFolderScope;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "marinara-library-folders-v1";

export const libraryFolderKeys = {
  all: ["library-folders"] as const,
  list: (scope: LibraryFolderScope) => [...libraryFolderKeys.all, scope] as const,
};

function readLegacyFolders(): LibraryFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (folder): folder is LibraryFolder =>
        folder &&
        typeof folder === "object" &&
        (folder.scope === "lorebooks" || folder.scope === "presets" || folder.scope === "agents") &&
        typeof folder.id === "string" &&
        typeof folder.name === "string" &&
        Array.isArray(folder.itemIds),
    );
  } catch {
    return [];
  }
}

function writeLegacyFolders(folders: LibraryFolder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
}

function sortFolders(folders: LibraryFolder[]) {
  return [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

const migrationPromises = new Map<LibraryFolderScope, Promise<void>>();

function migrateLegacyFolders(scope: LibraryFolderScope) {
  const existingPromise = migrationPromises.get(scope);
  if (existingPromise) return existingPromise;

  const migrationPromise = (async () => {
    const allLegacyFolders = readLegacyFolders();
    const scopedFolders = allLegacyFolders.filter((folder) => folder.scope === scope);
    if (scopedFolders.length === 0) return;

    await api.post(`/library-folders/${scope}/migrate`, {
      folders: scopedFolders.map(({ id, name, collapsed, sortOrder, itemIds }) => ({
        id,
        name,
        collapsed,
        sortOrder,
        itemIds,
      })),
    });
    writeLegacyFolders(allLegacyFolders.filter((folder) => folder.scope !== scope));
  })().catch((error) => {
    migrationPromises.delete(scope);
    throw error;
  });

  migrationPromises.set(scope, migrationPromise);
  return migrationPromise;
}

export function getNextUnnamedLibraryFolderName(folders: Array<{ name: string }>) {
  const names = new Set(folders.map((folder) => folder.name.toLowerCase()));
  if (!names.has("unnamed")) return "unnamed";
  let index = 2;
  while (names.has(`unnamed ${index}`)) index++;
  return `unnamed ${index}`;
}

export function useLibraryFolders(scope: LibraryFolderScope) {
  return useQuery({
    queryKey: libraryFolderKeys.list(scope),
    queryFn: async () => {
      await migrateLegacyFolders(scope);
      return sortFolders(await api.get<LibraryFolder[]>(`/library-folders/${scope}`));
    },
  });
}

export function useCreateLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      return api.post<LibraryFolder>(`/library-folders/${scope}`, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) }),
  });
}

export function useUpdateLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; collapsed?: boolean; itemIds?: string[] }) => {
      return api.patch<LibraryFolder>(`/library-folders/${scope}/${id}`, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) }),
  });
}

export function useDeleteLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/library-folders/${scope}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) }),
  });
}

export function useMoveLibraryItem(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      itemIds,
      folderId,
    }: {
      itemId?: string;
      itemIds?: string[];
      folderId: string | null;
    }) => {
      const ids = Array.from(new Set(itemIds ?? (itemId ? [itemId] : [])));
      if (ids.length === 0) return;
      await api.post(`/library-folders/${scope}/move`, { itemIds: ids, folderId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) }),
  });
}
