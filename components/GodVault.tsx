"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import styles from "./GodVault.module.css";

type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_default: boolean;
};

type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

type Tag = {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
};

type RankGroup = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  sort_order: number;
};

type Rank = {
  id: string;
  group_id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sort_order: number;
};

type VaultItem = {
  id: string;
  campaign_id: string;
  folder_id: string | null;
  name: string;
  description: string;
  image_path: string;
  original_filename: string | null;
  file_size: number | null;
  created_at: string;
  signed_url?: string;
  category_ids: string[];
  tag_ids: string[];
  rank_ids: string[];
};

type ManagerName =
  | "folders"
  | "categories"
  | "tags"
  | "ranks"
  | null;

type RankDraft = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
};

type ImportProgress = {
  active: boolean;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  folders: number;
  currentName: string;
};

const EMPTY_RANK_DRAFT: RankDraft = {
  id: "",
  name: "",
  description: "",
  color: "#d8b35f",
  icon: "◆",
};

const EMPTY_IMPORT_PROGRESS: ImportProgress = {
  active: false,
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  folders: 0,
  currentName: "",
};

function normalizeColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function safeBaseName(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || "รูปภาพใหม่";
}

function safeStorageName(filename: string) {
  const extension = filename.includes(".")
    ? `.${filename.split(".").pop()?.toLowerCase()}`
    : "";
  return `${crypto.randomUUID()}${extension}`;
}

function chunks<T>(values: T[], size = 100) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function pathKey(parentId: string | null, name: string) {
  return `${parentId ?? "root"}::${name.trim().toLocaleLowerCase("th-TH")}`;
}

export default function GodVault({
  campaignId,
  userId,
}: {
  campaignId: string;
  userId: string;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rankGroups, setRankGroups] = useState<RankGroup[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [items, setItems] = useState<VaultItem[]>([]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterTagId, setFilterTagId] = useState("");
  const [filterRankId, setFilterRankId] = useState("");
  const [search, setSearch] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showManager, setShowManager] = useState<ManagerName>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress>(
    EMPTY_IMPORT_PROGRESS
  );

  const [newFolderName, setNewFolderName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#8a795f");
  const [newRankGroupName, setNewRankGroupName] = useState("");
  const [newRankGroupDescription, setNewRankGroupDescription] = useState("");
  const [selectedRankGroupId, setSelectedRankGroupId] = useState("");
  const [rankDraft, setRankDraft] = useState<RankDraft>(EMPTY_RANK_DRAFT);

  const [bulkFolderId, setBulkFolderId] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkRankId, setBulkRankId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const tagById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags]
  );
  const rankById = useMemo(
    () => new Map(ranks.map((rank) => [rank.id, rank])),
    [ranks]
  );
  const rankGroupById = useMemo(
    () => new Map(rankGroups.map((group) => [group.id, group])),
    [rankGroups]
  );
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  const selectedIdSet = useMemo(
    () => new Set(selectedItemIds),
    [selectedItemIds]
  );

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIdSet.has(item.id)),
    [items, selectedIdSet]
  );

  const selectedRankGroup = useMemo(
    () =>
      rankGroups.find((group) => group.id === selectedRankGroupId) ?? null,
    [rankGroups, selectedRankGroupId]
  );

  const ranksInSelectedGroup = useMemo(
    () =>
      ranks
        .filter((rank) => rank.group_id === selectedRankGroupId)
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order || a.name.localeCompare(b.name, "th")
        ),
    [ranks, selectedRankGroupId]
  );

  const flattenedFolders = useMemo(() => {
    const output: Array<Folder & { depth: number }> = [];
    const children = new Map<string | null, Folder[]>();

    for (const folder of folders) {
      const parent = folder.parent_id ?? null;
      const current = children.get(parent) ?? [];
      current.push(folder);
      children.set(parent, current);
    }

    for (const values of children.values()) {
      values.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name, "th")
      );
    }

    const visit = (parentId: string | null, depth: number) => {
      for (const folder of children.get(parentId) ?? []) {
        output.push({ ...folder, depth });
        visit(folder.id, depth + 1);
      }
    };

    visit(null, 0);
    return output;
  }, [folders]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("th-TH");

    return items.filter((item) => {
      const folderMatches =
        !selectedFolderId || item.folder_id === selectedFolderId;
      const categoryMatches =
        !filterCategoryId || item.category_ids.includes(filterCategoryId);
      const tagMatches = !filterTagId || item.tag_ids.includes(filterTagId);
      const rankMatches = !filterRankId || item.rank_ids.includes(filterRankId);

      const tagText = item.tag_ids
        .map((tagId) => tagById.get(tagId)?.name ?? "")
        .join(" ")
        .toLocaleLowerCase("th-TH");
      const rankText = item.rank_ids
        .map((rankId) => rankById.get(rankId)?.name ?? "")
        .join(" ")
        .toLocaleLowerCase("th-TH");

      const searchMatches =
        !query ||
        item.name.toLocaleLowerCase("th-TH").includes(query) ||
        item.description.toLocaleLowerCase("th-TH").includes(query) ||
        tagText.includes(query) ||
        rankText.includes(query);

      return (
        folderMatches &&
        categoryMatches &&
        tagMatches &&
        rankMatches &&
        searchMatches
      );
    });
  }, [
    filterCategoryId,
    filterRankId,
    filterTagId,
    items,
    rankById,
    search,
    selectedFolderId,
    tagById,
  ]);

  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selectedIdSet.has(item.id));

  const loadVault = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();

    const [
      categoryResult,
      folderResult,
      itemResult,
      categoryLinkResult,
      tagResult,
      tagLinkResult,
      rankGroupResult,
      rankResult,
      rankLinkResult,
    ] = await Promise.all([
      supabase
        .from("god_vault_categories")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("god_vault_folders")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("god_vault_items")
        .select("*")
        .eq("campaign_id", campaignId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("god_vault_item_categories").select("item_id,category_id"),
      supabase
        .from("god_vault_tags")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("name"),
      supabase.from("god_vault_item_tags").select("item_id,tag_id"),
      supabase
        .from("god_vault_rank_groups")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("god_vault_ranks")
        .select("*")
        .order("sort_order")
        .order("name"),
      supabase.from("god_vault_item_ranks").select("item_id,rank_id"),
    ]);

    const firstError =
      categoryResult.error ||
      folderResult.error ||
      itemResult.error ||
      categoryLinkResult.error ||
      tagResult.error ||
      tagLinkResult.error ||
      rankGroupResult.error ||
      rankResult.error ||
      rankLinkResult.error;

    if (firstError) {
      setMessage(firstError.message);
      setLoading(false);
      return;
    }

    const rawItems = itemResult.data ?? [];
    const itemIds = new Set(rawItems.map((item) => item.id));
    const groups = (rankGroupResult.data ?? []) as RankGroup[];
    const groupIds = new Set(groups.map((group) => group.id));
    const campaignRanks = ((rankResult.data ?? []) as Rank[]).filter((rank) =>
      groupIds.has(rank.group_id)
    );
    const campaignRankIds = new Set(campaignRanks.map((rank) => rank.id));
    const campaignTagIds = new Set(
      ((tagResult.data ?? []) as Tag[]).map((tag) => tag.id)
    );

    const categoriesByItem = new Map<string, string[]>();
    for (const link of categoryLinkResult.data ?? []) {
      if (!itemIds.has(link.item_id)) continue;
      const current = categoriesByItem.get(link.item_id) ?? [];
      current.push(link.category_id);
      categoriesByItem.set(link.item_id, current);
    }

    const tagsByItem = new Map<string, string[]>();
    for (const link of tagLinkResult.data ?? []) {
      if (!itemIds.has(link.item_id) || !campaignTagIds.has(link.tag_id)) {
        continue;
      }
      const current = tagsByItem.get(link.item_id) ?? [];
      current.push(link.tag_id);
      tagsByItem.set(link.item_id, current);
    }

    const ranksByItem = new Map<string, string[]>();
    for (const link of rankLinkResult.data ?? []) {
      if (!itemIds.has(link.item_id) || !campaignRankIds.has(link.rank_id)) {
        continue;
      }
      const current = ranksByItem.get(link.item_id) ?? [];
      current.push(link.rank_id);
      ranksByItem.set(link.item_id, current);
    }

    const paths = rawItems.map((item) => item.image_path);
    const signedMap = new Map<string, string>();
    if (paths.length) {
      const { data } = await supabase.storage
        .from("god-vault-assets")
        .createSignedUrls(paths, 3600);
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) {
          signedMap.set(entry.path, entry.signedUrl);
        }
      }
    }

    const withUrls = rawItems.map(
      (item) =>
        ({
          ...item,
          signed_url: signedMap.get(item.image_path),
          category_ids: categoriesByItem.get(item.id) ?? [],
          tag_ids: tagsByItem.get(item.id) ?? [],
          rank_ids: ranksByItem.get(item.id) ?? [],
        }) as VaultItem
    );

    setCategories(categoryResult.data ?? []);
    setFolders(folderResult.data ?? []);
    setTags(tagResult.data ?? []);
    setRankGroups(groups);
    setRanks(campaignRanks);
    setItems(withUrls);

    setSelectedItemId((current) =>
      current && withUrls.some((item) => item.id === current) ? current : null
    );
    setSelectedItemIds((current) =>
      current.filter((id) => withUrls.some((item) => item.id === id))
    );
    setSelectedRankGroupId((current) =>
      current && groups.some((group) => group.id === current)
        ? current
        : groups[0]?.id ?? ""
    );

    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  async function removeStoragePaths(paths: string[]) {
    const supabase = getSupabase();
    for (const group of chunks(Array.from(new Set(paths)), 100)) {
      if (!group.length) continue;
      const { error } = await supabase.storage
        .from("god-vault-assets")
        .remove(group);
      if (error) throw error;
    }
  }

  async function ensureFolderPath(
    names: string[],
    baseParentId: string | null,
    cache: Map<string, string>
  ) {
    const supabase = getSupabase();
    let parentId = baseParentId;

    for (const rawName of names) {
      const name = rawName.trim();
      if (!name) continue;

      const key = pathKey(parentId, name);
      const existing = cache.get(key);
      if (existing) {
        parentId = existing;
        continue;
      }

      const { data, error } = await supabase
        .from("god_vault_folders")
        .insert({
          campaign_id: campaignId,
          parent_id: parentId,
          name,
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) throw error;
      cache.set(key, data.id);
      parentId = data.id;
    }

    return parentId;
  }

  async function applyUploadMetadata(itemId: string) {
    const supabase = getSupabase();

    if (filterCategoryId) {
      const { error } = await supabase
        .from("god_vault_item_categories")
        .upsert(
          { item_id: itemId, category_id: filterCategoryId },
          { onConflict: "item_id,category_id", ignoreDuplicates: true }
        );
      if (error) throw error;
    }

    if (filterTagId) {
      const { error } = await supabase
        .from("god_vault_item_tags")
        .upsert(
          { item_id: itemId, tag_id: filterTagId },
          { onConflict: "item_id,tag_id", ignoreDuplicates: true }
        );
      if (error) throw error;
    }

    if (filterRankId) {
      const { error } = await supabase
        .from("god_vault_item_ranks")
        .upsert(
          { item_id: itemId, rank_id: filterRankId },
          { onConflict: "item_id,rank_id", ignoreDuplicates: true }
        );
      if (error) throw error;
    }
  }

  async function uploadFiles(files: FileList | null, preserveFolders = false) {
    if (!files?.length) return;

    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (!imageFiles.length) {
      setMessage("ไม่พบไฟล์รูปที่รองรับในรายการที่เลือก");
      return;
    }

    const folderPaths = new Set<string>();
    if (preserveFolders) {
      for (const file of imageFiles) {
        const relative = file.webkitRelativePath || file.name;
        const parts = relative.split("/").filter(Boolean);
        const directory = parts.slice(0, -1);
        for (let index = 1; index <= directory.length; index += 1) {
          folderPaths.add(directory.slice(0, index).join("/"));
        }
      }
    }

    const confirmed = window.confirm(
      preserveFolders
        ? `พบนำเข้า ${imageFiles.length} รูป และ ${folderPaths.size} โฟลเดอร์\n\nระบบจะสร้างโครงสร้างโฟลเดอร์ตามต้นฉบับใต้ตำแหน่งที่เลือก ดำเนินการต่อหรือไม่?`
        : `นำเข้ารูป ${imageFiles.length} รายการไปยังโฟลเดอร์ที่เลือกใช่ไหม?`
    );
    if (!confirmed) return;

    setUploading(true);
    setMessage("");
    setImportProgress({
      active: true,
      total: imageFiles.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      folders: folderPaths.size,
      currentName: "เตรียมการนำเข้า…",
    });

    const supabase = getSupabase();
    const folderCache = new Map<string, string>();
    for (const folder of folders) {
      folderCache.set(pathKey(folder.parent_id, folder.name), folder.id);
    }

    let succeeded = 0;
    let failed = 0;

    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      setImportProgress((current) => ({
        ...current,
        completed: index,
        succeeded,
        failed,
        currentName: file.name,
      }));

      let storagePath = "";
      try {
        let targetFolderId = selectedFolderId || null;
        if (preserveFolders) {
          const relative = file.webkitRelativePath || file.name;
          const parts = relative.split("/").filter(Boolean);
          const directory = parts.slice(0, -1);
          targetFolderId = await ensureFolderPath(
            directory,
            selectedFolderId || null,
            folderCache
          );
        }

        storagePath = `${campaignId}/${safeStorageName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("god-vault-assets")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) throw uploadError;

        const { data: item, error: itemError } = await supabase
          .from("god_vault_items")
          .insert({
            campaign_id: campaignId,
            folder_id: targetFolderId,
            name: safeBaseName(file.name),
            description: "",
            image_path: storagePath,
            original_filename: file.name,
            mime_type: file.type,
            file_size: file.size,
            created_by: userId,
          })
          .select("id")
          .single();
        if (itemError) throw itemError;

        await applyUploadMetadata(item.id);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        if (storagePath) {
          await supabase.storage
            .from("god-vault-assets")
            .remove([storagePath]);
        }
        console.error("God Vault upload failed", file.name, error);
      }
    }

    setImportProgress({
      active: false,
      total: imageFiles.length,
      completed: imageFiles.length,
      succeeded,
      failed,
      folders: folderPaths.size,
      currentName: "",
    });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";

    setMessage(
      failed
        ? `นำเข้าสำเร็จ ${succeeded} รายการ และไม่สำเร็จ ${failed} รายการ`
        : `นำเข้ารูปสำเร็จ ${succeeded} รายการ`
    );
    await loadVault();
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!newFolderName.trim()) return;

    const { error } = await getSupabase().from("god_vault_folders").insert({
      campaign_id: campaignId,
      parent_id: selectedFolderId || null,
      name: newFolderName.trim(),
      created_by: userId,
    });

    if (error) return setMessage(error.message);
    setNewFolderName("");
    setMessage(
      selectedFolderId
        ? "สร้างโฟลเดอร์ย่อยแล้ว"
        : "สร้างโฟลเดอร์แล้ว"
    );
    loadVault();
  }

  async function renameFolder(folder: Folder) {
    const nextName = window.prompt("ชื่อโฟลเดอร์ใหม่", folder.name)?.trim();
    if (!nextName || nextName === folder.name) return;

    const { error } = await getSupabase()
      .from("god_vault_folders")
      .update({ name: nextName })
      .eq("id", folder.id);

    if (error) return setMessage(error.message);
    setMessage(`เปลี่ยนชื่อโฟลเดอร์เป็น “${nextName}” แล้ว`);
    loadVault();
  }

  function descendantFolderIds(folderId: string) {
    const ids = new Set<string>([folderId]);
    let found = true;
    while (found) {
      found = false;
      for (const folder of folders) {
        if (
          folder.parent_id &&
          ids.has(folder.parent_id) &&
          !ids.has(folder.id)
        ) {
          ids.add(folder.id);
          found = true;
        }
      }
    }
    return ids;
  }

  async function deleteFolder(folder: Folder) {
    const descendantIds = descendantFolderIds(folder.id);
    const affectedItems = items.filter(
      (item) => item.folder_id && descendantIds.has(item.folder_id)
    );

    const confirmed = window.confirm(
      `ลบโฟลเดอร์ “${folder.name}” และรูปภายใน ${affectedItems.length} รายการอย่างถาวรใช่ไหม?\n\nโฟลเดอร์ย่อย ข้อมูล และไฟล์รูปทั้งหมดจะถูกลบทันทีและกู้คืนไม่ได้`
    );
    if (!confirmed) return;

    try {
      await removeStoragePaths(affectedItems.map((item) => item.image_path));
      const { error } = await getSupabase()
        .from("god_vault_folders")
        .delete()
        .eq("id", folder.id);
      if (error) throw error;

      if (selectedFolderId && descendantIds.has(selectedFolderId)) {
        setSelectedFolderId("");
      }
      setSelectedItemId(null);
      setSelectedItemIds((current) =>
        current.filter(
          (id) => !affectedItems.some((item) => item.id === id)
        )
      );
      setMessage(
        `ลบโฟลเดอร์ “${folder.name}” และรูปภายใน ${affectedItems.length} รายการแล้ว`
      );
      loadVault();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ลบโฟลเดอร์ไม่สำเร็จ"
      );
    }
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    if (!newCategoryName.trim()) return;

    const { error } = await getSupabase().from("god_vault_categories").insert({
      campaign_id: campaignId,
      name: newCategoryName.trim(),
      created_by: userId,
    });

    if (error) return setMessage(error.message);
    setNewCategoryName("");
    setMessage("สร้างหมวดหมู่แล้ว");
    loadVault();
  }

  async function editCategory(category: Category) {
    const nextName = window.prompt("ชื่อหมวดหมู่", category.name)?.trim();
    if (!nextName) return;
    const nextIcon = window.prompt("ไอคอนหมวดหมู่", category.icon);
    if (nextIcon === null) return;
    const nextColorInput = window.prompt("สีป้ายแบบ Hex", category.color);
    if (nextColorInput === null) return;

    const { error } = await getSupabase()
      .from("god_vault_categories")
      .update({
        name: nextName,
        icon: nextIcon.trim() || category.icon,
        color: normalizeColor(nextColorInput, category.color),
      })
      .eq("id", category.id);

    if (error) return setMessage(error.message);
    setMessage(`แก้ไขหมวดหมู่ “${nextName}” แล้ว`);
    loadVault();
  }

  async function deleteCategory(category: Category) {
    const affectedItems = items.filter((item) =>
      item.category_ids.includes(category.id)
    );
    const confirmed = window.confirm(
      `ลบหมวดหมู่ “${category.name}” และรูปที่อยู่ในหมวดนี้ ${affectedItems.length} รายการอย่างถาวรใช่ไหม?\n\nรูปจะถูกลบทันที แม้บางรูปจะอยู่ในหมวดหมู่อื่นด้วย และไม่สามารถกู้คืนได้`
    );
    if (!confirmed) return;

    try {
      await removeStoragePaths(affectedItems.map((item) => item.image_path));
      for (const group of chunks(affectedItems.map((item) => item.id), 100)) {
        if (!group.length) continue;
        const { error } = await getSupabase()
          .from("god_vault_items")
          .delete()
          .in("id", group);
        if (error) throw error;
      }
      const { error } = await getSupabase()
        .from("god_vault_categories")
        .delete()
        .eq("id", category.id);
      if (error) throw error;

      setSelectedItemId(null);
      setSelectedItemIds((current) =>
        current.filter(
          (id) => !affectedItems.some((item) => item.id === id)
        )
      );
      if (filterCategoryId === category.id) setFilterCategoryId("");
      setMessage(
        `ลบหมวดหมู่ “${category.name}” และรูป ${affectedItems.length} รายการแล้ว`
      );
      loadVault();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ลบหมวดหมู่ไม่สำเร็จ"
      );
    }
  }

  async function createTag(event: FormEvent) {
    event.preventDefault();
    if (!newTagName.trim()) return;

    const { error } = await getSupabase().from("god_vault_tags").insert({
      campaign_id: campaignId,
      name: newTagName.trim(),
      color: newTagColor,
      created_by: userId,
    });

    if (error) return setMessage(error.message);
    setNewTagName("");
    setNewTagColor("#8a795f");
    setMessage("สร้างแท็กแล้ว");
    loadVault();
  }

  async function editTag(tag: Tag) {
    const nextName = window.prompt("ชื่อแท็ก", tag.name)?.trim();
    if (!nextName) return;
    const nextColorInput = window.prompt("สีแท็กแบบ Hex", tag.color);
    if (nextColorInput === null) return;

    const { error } = await getSupabase()
      .from("god_vault_tags")
      .update({
        name: nextName,
        color: normalizeColor(nextColorInput, tag.color),
      })
      .eq("id", tag.id);

    if (error) return setMessage(error.message);
    setMessage(`แก้ไขแท็ก “${nextName}” แล้ว`);
    loadVault();
  }

  async function deleteTag(tag: Tag) {
    const usedCount = items.filter((item) => item.tag_ids.includes(tag.id)).length;
    const confirmed = window.confirm(
      `ลบแท็ก “${tag.name}” ใช่ไหม?\n\nแท็กจะถูกนำออกจาก ${usedCount} รายการ แต่รูปจะไม่ถูกลบ`
    );
    if (!confirmed) return;

    const { error } = await getSupabase()
      .from("god_vault_tags")
      .delete()
      .eq("id", tag.id);
    if (error) return setMessage(error.message);

    if (filterTagId === tag.id) setFilterTagId("");
    setMessage(`ลบแท็ก “${tag.name}” แล้ว`);
    loadVault();
  }

  async function createRankGroup(event: FormEvent) {
    event.preventDefault();
    if (!newRankGroupName.trim()) return;

    const nextSort =
      rankGroups.reduce(
        (highest, group) => Math.max(highest, group.sort_order),
        -1
      ) + 1;

    const { data, error } = await getSupabase()
      .from("god_vault_rank_groups")
      .insert({
        campaign_id: campaignId,
        name: newRankGroupName.trim(),
        description: newRankGroupDescription.trim(),
        sort_order: nextSort,
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) return setMessage(error.message);
    setNewRankGroupName("");
    setNewRankGroupDescription("");
    if (data?.id) setSelectedRankGroupId(data.id);
    setMessage("สร้างชุดระดับแล้ว");
    loadVault();
  }

  async function editRankGroup(group: RankGroup) {
    const nextName = window.prompt("ชื่อชุดระดับ", group.name)?.trim();
    if (!nextName) return;
    const nextDescription = window.prompt(
      "คำอธิบายชุดระดับ",
      group.description
    );
    if (nextDescription === null) return;

    const { error } = await getSupabase()
      .from("god_vault_rank_groups")
      .update({ name: nextName, description: nextDescription })
      .eq("id", group.id);

    if (error) return setMessage(error.message);
    setMessage(`แก้ไขชุดระดับ “${nextName}” แล้ว`);
    loadVault();
  }

  async function deleteRankGroup(group: RankGroup) {
    const groupRankIds = ranks
      .filter((rank) => rank.group_id === group.id)
      .map((rank) => rank.id);
    const usedCount = items.filter((item) =>
      item.rank_ids.some((rankId) => groupRankIds.includes(rankId))
    ).length;

    const confirmed = window.confirm(
      `ลบชุดระดับ “${group.name}” ใช่ไหม?\n\nระดับทั้งหมดภายในชุดและการกำหนดระดับจาก ${usedCount} รายการจะถูกนำออก แต่รูปจะไม่ถูกลบ`
    );
    if (!confirmed) return;

    const { error } = await getSupabase()
      .from("god_vault_rank_groups")
      .delete()
      .eq("id", group.id);
    if (error) return setMessage(error.message);

    setRankDraft(EMPTY_RANK_DRAFT);
    setMessage(`ลบชุดระดับ “${group.name}” แล้ว`);
    loadVault();
  }

  async function saveRank(event: FormEvent) {
    event.preventDefault();
    if (!selectedRankGroupId || !rankDraft.name.trim()) return;

    const payload = {
      group_id: selectedRankGroupId,
      name: rankDraft.name.trim(),
      description: rankDraft.description.trim(),
      color: rankDraft.color,
      icon: rankDraft.icon.trim() || "◆",
      created_by: userId,
    };

    if (rankDraft.id) {
      const { error } = await getSupabase()
        .from("god_vault_ranks")
        .update({
          name: payload.name,
          description: payload.description,
          color: payload.color,
          icon: payload.icon,
        })
        .eq("id", rankDraft.id);
      if (error) return setMessage(error.message);
      setMessage(`แก้ไขระดับ “${payload.name}” แล้ว`);
    } else {
      const nextSort =
        ranksInSelectedGroup.reduce(
          (highest, rank) => Math.max(highest, rank.sort_order),
          -1
        ) + 1;
      const { error } = await getSupabase().from("god_vault_ranks").insert({
        ...payload,
        sort_order: nextSort,
      });
      if (error) return setMessage(error.message);
      setMessage(`เพิ่มระดับ “${payload.name}” แล้ว`);
    }

    setRankDraft(EMPTY_RANK_DRAFT);
    loadVault();
  }

  async function deleteRank(rank: Rank) {
    const usedCount = items.filter((item) => item.rank_ids.includes(rank.id)).length;
    const confirmed = window.confirm(
      `ลบระดับ “${rank.name}” ใช่ไหม?\n\nระดับนี้กำลังถูกใช้กับ ${usedCount} รายการ การเชื่อมโยงจะถูกนำออก แต่รูปจะไม่ถูกลบ`
    );
    if (!confirmed) return;

    const { error } = await getSupabase()
      .from("god_vault_ranks")
      .delete()
      .eq("id", rank.id);
    if (error) return setMessage(error.message);

    if (rankDraft.id === rank.id) setRankDraft(EMPTY_RANK_DRAFT);
    if (filterRankId === rank.id) setFilterRankId("");
    setMessage(`ลบระดับ “${rank.name}” แล้ว`);
    loadVault();
  }

  async function moveRank(rank: Rank, direction: -1 | 1) {
    const index = ranksInSelectedGroup.findIndex((entry) => entry.id === rank.id);
    const swapWith = ranksInSelectedGroup[index + direction];
    if (!swapWith) return;

    const supabase = getSupabase();
    const firstOrder = rank.sort_order;
    const secondOrder = swapWith.sort_order;
    const [first, second] = await Promise.all([
      supabase
        .from("god_vault_ranks")
        .update({ sort_order: secondOrder })
        .eq("id", rank.id),
      supabase
        .from("god_vault_ranks")
        .update({ sort_order: firstOrder })
        .eq("id", swapWith.id),
    ]);

    if (first.error || second.error) {
      setMessage(first.error?.message || second.error?.message || "เรียงระดับไม่สำเร็จ");
      return;
    }
    loadVault();
  }

  async function saveSelectedItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem) return;

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "");
    const folderId = String(formData.get("folder_id") ?? "");
    if (!name) return setMessage("กรุณาใส่ชื่อรายการ");

    const { error } = await getSupabase()
      .from("god_vault_items")
      .update({ name, description, folder_id: folderId || null })
      .eq("id", selectedItem.id);
    if (error) return setMessage(error.message);

    setMessage("บันทึกรายละเอียดแล้ว");
    loadVault();
  }

  async function toggleCategory(categoryId: string, checked: boolean) {
    if (!selectedItem) return;
    const supabase = getSupabase();
    const result = checked
      ? await supabase.from("god_vault_item_categories").upsert(
          { item_id: selectedItem.id, category_id: categoryId },
          { onConflict: "item_id,category_id", ignoreDuplicates: true }
        )
      : await supabase
          .from("god_vault_item_categories")
          .delete()
          .eq("item_id", selectedItem.id)
          .eq("category_id", categoryId);
    if (result.error) return setMessage(result.error.message);
    loadVault();
  }

  async function toggleTag(tagId: string, checked: boolean) {
    if (!selectedItem) return;
    const supabase = getSupabase();
    const result = checked
      ? await supabase.from("god_vault_item_tags").upsert(
          { item_id: selectedItem.id, tag_id: tagId },
          { onConflict: "item_id,tag_id", ignoreDuplicates: true }
        )
      : await supabase
          .from("god_vault_item_tags")
          .delete()
          .eq("item_id", selectedItem.id)
          .eq("tag_id", tagId);
    if (result.error) return setMessage(result.error.message);
    loadVault();
  }

  async function setItemRank(groupId: string, rankId: string) {
    if (!selectedItem) return;
    const groupRankIds = ranks
      .filter((rank) => rank.group_id === groupId)
      .map((rank) => rank.id);
    const supabase = getSupabase();

    if (groupRankIds.length) {
      const { error } = await supabase
        .from("god_vault_item_ranks")
        .delete()
        .eq("item_id", selectedItem.id)
        .in("rank_id", groupRankIds);
      if (error) return setMessage(error.message);
    }

    if (rankId) {
      const { error } = await supabase.from("god_vault_item_ranks").upsert(
        { item_id: selectedItem.id, rank_id: rankId },
        { onConflict: "item_id,rank_id", ignoreDuplicates: true }
      );
      if (error) return setMessage(error.message);
    }
    loadVault();
  }

  async function deleteSelectedItem() {
    if (!selectedItem) return;
    const confirmed = window.confirm(
      `ลบ “${selectedItem.name}” อย่างถาวรใช่ไหม?\n\nข้อมูลและไฟล์รูปจะถูกลบทันทีและไม่สามารถกู้คืนได้`
    );
    if (!confirmed) return;

    try {
      await removeStoragePaths([selectedItem.image_path]);
      const { error } = await getSupabase()
        .from("god_vault_items")
        .delete()
        .eq("id", selectedItem.id);
      if (error) throw error;

      setSelectedItemId(null);
      setSelectedItemIds((current) =>
        current.filter((id) => id !== selectedItem.id)
      );
      setMessage(`ลบ “${selectedItem.name}” อย่างถาวรแล้ว`);
      loadVault();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ลบรายการไม่สำเร็จ"
      );
    }
  }

  function toggleSelection(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    );
  }

  function selectAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleItems.map((item) => item.id));
      setSelectedItemIds((current) =>
        current.filter((id) => !visibleIds.has(id))
      );
    } else {
      setSelectedItemIds((current) =>
        Array.from(
          new Set([...current, ...visibleItems.map((item) => item.id)])
        )
      );
    }
  }

  function clearSelection() {
    setSelectedItemIds([]);
    setSelectionMode(false);
  }

  async function bulkMoveItems() {
    if (!selectedItemIds.length) return;
    setBulkBusy(true);
    const folderId = bulkFolderId || null;
    const { error } = await getSupabase()
      .from("god_vault_items")
      .update({ folder_id: folderId })
      .in("id", selectedItemIds);
    setBulkBusy(false);
    if (error) return setMessage(error.message);
    setMessage(`ย้าย ${selectedItemIds.length} รายการแล้ว`);
    loadVault();
  }

  async function bulkCategory(action: "add" | "remove") {
    if (!selectedItemIds.length || !bulkCategoryId) return;
    setBulkBusy(true);
    const supabase = getSupabase();
    let errorMessage = "";

    for (const group of chunks(selectedItemIds, 100)) {
      const result =
        action === "add"
          ? await supabase.from("god_vault_item_categories").upsert(
              group.map((itemId) => ({
                item_id: itemId,
                category_id: bulkCategoryId,
              })),
              { onConflict: "item_id,category_id", ignoreDuplicates: true }
            )
          : await supabase
              .from("god_vault_item_categories")
              .delete()
              .in("item_id", group)
              .eq("category_id", bulkCategoryId);
      if (result.error) {
        errorMessage = result.error.message;
        break;
      }
    }

    setBulkBusy(false);
    if (errorMessage) return setMessage(errorMessage);
    setMessage(
      `${action === "add" ? "เพิ่ม" : "นำออก"}หมวดหมู่ให้ ${
        selectedItemIds.length
      } รายการแล้ว`
    );
    loadVault();
  }

  async function bulkTag(action: "add" | "remove") {
    if (!selectedItemIds.length || !bulkTagId) return;
    setBulkBusy(true);
    const supabase = getSupabase();
    let errorMessage = "";

    for (const group of chunks(selectedItemIds, 100)) {
      const result =
        action === "add"
          ? await supabase.from("god_vault_item_tags").upsert(
              group.map((itemId) => ({ item_id: itemId, tag_id: bulkTagId })),
              { onConflict: "item_id,tag_id", ignoreDuplicates: true }
            )
          : await supabase
              .from("god_vault_item_tags")
              .delete()
              .in("item_id", group)
              .eq("tag_id", bulkTagId);
      if (result.error) {
        errorMessage = result.error.message;
        break;
      }
    }

    setBulkBusy(false);
    if (errorMessage) return setMessage(errorMessage);
    setMessage(
      `${action === "add" ? "เพิ่ม" : "นำออก"}แท็กให้ ${
        selectedItemIds.length
      } รายการแล้ว`
    );
    loadVault();
  }

  async function bulkSetRank(clear = false) {
    if (!selectedItemIds.length || !bulkRankId) return;
    const selectedRank = rankById.get(bulkRankId);
    if (!selectedRank) return;

    setBulkBusy(true);
    const supabase = getSupabase();
    const groupRankIds = ranks
      .filter((rank) => rank.group_id === selectedRank.group_id)
      .map((rank) => rank.id);
    let errorMessage = "";

    for (const group of chunks(selectedItemIds, 100)) {
      const removeResult = await supabase
        .from("god_vault_item_ranks")
        .delete()
        .in("item_id", group)
        .in("rank_id", groupRankIds);
      if (removeResult.error) {
        errorMessage = removeResult.error.message;
        break;
      }

      if (!clear) {
        const addResult = await supabase.from("god_vault_item_ranks").upsert(
          group.map((itemId) => ({ item_id: itemId, rank_id: bulkRankId })),
          { onConflict: "item_id,rank_id", ignoreDuplicates: true }
        );
        if (addResult.error) {
          errorMessage = addResult.error.message;
          break;
        }
      }
    }

    setBulkBusy(false);
    if (errorMessage) return setMessage(errorMessage);
    setMessage(
      clear
        ? `ล้างระดับในชุด “${rankGroupById.get(selectedRank.group_id)?.name ?? "ระดับ"}” จาก ${selectedItemIds.length} รายการแล้ว`
        : `กำหนดระดับ “${selectedRank.name}” ให้ ${selectedItemIds.length} รายการแล้ว`
    );
    loadVault();
  }

  async function bulkDeleteItems() {
    if (!selectedItems.length) return;
    const confirmed = window.confirm(
      `ลบ ${selectedItems.length} รายการอย่างถาวรใช่ไหม?\n\nข้อมูลและไฟล์รูปทั้งหมดจะถูกลบทันทีและไม่สามารถกู้คืนได้`
    );
    if (!confirmed) return;

    setBulkBusy(true);
    try {
      await removeStoragePaths(selectedItems.map((item) => item.image_path));
      for (const group of chunks(selectedItems.map((item) => item.id), 100)) {
        const { error } = await getSupabase()
          .from("god_vault_items")
          .delete()
          .in("id", group);
        if (error) throw error;
      }
      const deletedCount = selectedItems.length;
      setSelectedItemId(null);
      clearSelection();
      setMessage(`ลบ ${deletedCount} รายการอย่างถาวรแล้ว`);
      await loadVault();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ลบหลายรายการไม่สำเร็จ"
      );
    } finally {
      setBulkBusy(false);
    }
  }

  function renderFolderOptions(includeNoFolder = true) {
    return (
      <>
        {includeNoFolder ? <option value="">ไม่มีโฟลเดอร์</option> : null}
        {flattenedFolders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {`${"— ".repeat(folder.depth)}${folder.name}`}
          </option>
        ))}
      </>
    );
  }

  return (
    <section className={styles.vaultShell}>
      <header className={styles.vaultHeader}>
        <div>
          <p className="eyebrow">DM Asset Library</p>
          <h2>♛ คลังพระเจ้า</h2>
          <p>
            จัดเก็บรูป ฉาก ตัวละคร มอนสเตอร์ ไอเทม และข้อมูลสำคัญของแคมเปญ
          </p>
        </div>

        <div className={styles.headerActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => uploadFiles(event.target.files, false)}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => uploadFiles(event.target.files, true)}
          />

          <button
            className="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "กำลังนำเข้า…" : "＋ อัปโหลดรูป"}
          </button>
          <button
            className="button ghost"
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            ▣ นำเข้าโฟลเดอร์
          </button>
          <button
            className={`button ghost ${selectionMode ? styles.selectionActive : ""}`}
            onClick={() => {
              setSelectionMode((current) => !current);
              if (selectionMode) setSelectedItemIds([]);
            }}
          >
            {selectionMode ? "ออกจากโหมดเลือก" : "เลือกหลายรายการ"}
          </button>
        </div>
      </header>

      {message ? <p className="notice banner">{message}</p> : null}

      {importProgress.total > 0 ? (
        <section className={styles.importStatus}>
          <div>
            <strong>
              {importProgress.active ? "กำลังนำเข้าโฟลเดอร์" : "สรุปการนำเข้า"}
            </strong>
            <span>
              {importProgress.completed}/{importProgress.total} รูป · สำเร็จ {importProgress.succeeded} · ผิดพลาด {importProgress.failed}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <i
              style={{
                width: `${Math.round(
                  (importProgress.completed / importProgress.total) * 100
                )}%`,
              }}
            />
          </div>
          {importProgress.currentName ? (
            <small>{importProgress.currentName}</small>
          ) : null}
        </section>
      ) : null}

      <div className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ค้นหาด้วยชื่อ คำอธิบาย แท็ก หรือระดับ…"
        />
        <select
          value={filterCategoryId}
          onChange={(event) => setFilterCategoryId(event.target.value)}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          value={filterTagId}
          onChange={(event) => setFilterTagId(event.target.value)}
        >
          <option value="">ทุกแท็ก</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <select
          value={filterRankId}
          onChange={(event) => setFilterRankId(event.target.value)}
        >
          <option value="">ทุกระดับ</option>
          {rankGroups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {ranks
                .filter((rank) => rank.group_id === group.id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((rank) => (
                  <option key={rank.id} value={rank.id}>
                    {rank.icon} {rank.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        <div className={styles.managerButtons}>
          {(["folders", "categories", "tags", "ranks"] as const).map(
            (manager) => (
              <button
                key={manager}
                className="tinyButton"
                onClick={() =>
                  setShowManager(showManager === manager ? null : manager)
                }
              >
                {manager === "folders"
                  ? "โฟลเดอร์"
                  : manager === "categories"
                  ? "หมวดหมู่"
                  : manager === "tags"
                  ? "แท็ก"
                  : "ระดับ"}
              </button>
            )
          )}
        </div>
      </div>

      {selectionMode || selectedItemIds.length ? (
        <section className={styles.bulkPanel}>
          <div className={styles.bulkTitle}>
            <div>
              <strong>จัดการหลายรายการ</strong>
              <span>เลือกแล้ว {selectedItemIds.length} รายการ</span>
            </div>
            <div>
              <button className="tinyButton" onClick={selectAllVisible}>
                {allVisibleSelected ? "ยกเลิกที่เห็น" : "เลือกทั้งหมดที่เห็น"}
              </button>
              <button className="tinyButton" onClick={clearSelection}>
                ล้างการเลือก
              </button>
            </div>
          </div>

          <div className={styles.bulkGrid}>
            <div className={styles.bulkAction}>
              <label>ย้ายไปโฟลเดอร์</label>
              <select
                value={bulkFolderId}
                onChange={(event) => setBulkFolderId(event.target.value)}
              >
                {renderFolderOptions(true)}
              </select>
              <button
                className="tinyButton"
                disabled={bulkBusy || !selectedItemIds.length}
                onClick={bulkMoveItems}
              >
                ย้าย
              </button>
            </div>

            <div className={styles.bulkAction}>
              <label>หมวดหมู่</label>
              <select
                value={bulkCategoryId}
                onChange={(event) => setBulkCategoryId(event.target.value)}
              >
                <option value="">เลือกหมวดหมู่</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <div>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkCategoryId}
                  onClick={() => bulkCategory("add")}
                >
                  เพิ่ม
                </button>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkCategoryId}
                  onClick={() => bulkCategory("remove")}
                >
                  นำออก
                </button>
              </div>
            </div>

            <div className={styles.bulkAction}>
              <label>แท็ก</label>
              <select
                value={bulkTagId}
                onChange={(event) => setBulkTagId(event.target.value)}
              >
                <option value="">เลือกแท็ก</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <div>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkTagId}
                  onClick={() => bulkTag("add")}
                >
                  เพิ่ม
                </button>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkTagId}
                  onClick={() => bulkTag("remove")}
                >
                  นำออก
                </button>
              </div>
            </div>

            <div className={styles.bulkAction}>
              <label>ระดับ</label>
              <select
                value={bulkRankId}
                onChange={(event) => setBulkRankId(event.target.value)}
              >
                <option value="">เลือกระดับ</option>
                {rankGroups.map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {ranks
                      .filter((rank) => rank.group_id === group.id)
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((rank) => (
                        <option key={rank.id} value={rank.id}>
                          {rank.icon} {rank.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <div>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkRankId}
                  onClick={() => bulkSetRank(false)}
                >
                  กำหนด
                </button>
                <button
                  className="tinyButton"
                  disabled={bulkBusy || !bulkRankId}
                  onClick={() => bulkSetRank(true)}
                >
                  ล้างชุดนี้
                </button>
              </div>
            </div>

            <button
              className="button danger"
              disabled={bulkBusy || !selectedItemIds.length}
              onClick={bulkDeleteItems}
            >
              ลบ {selectedItemIds.length} รายการถาวร
            </button>
          </div>
        </section>
      ) : null}

      {showManager ? (
        <section className={styles.managerPanel}>
          {showManager === "folders" ? (
            <>
              <div>
                <p className="eyebrow">Folder Manager</p>
                <h3>จัดการโฟลเดอร์</h3>
                <p className={styles.managerHint}>
                  โฟลเดอร์ใหม่จะถูกสร้างภายในโฟลเดอร์ที่กำลังเลือก
                </p>
              </div>
              <form className="inlineForm" onSubmit={createFolder}>
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="ชื่อโฟลเดอร์ใหม่"
                  required
                />
                <button className="button">สร้าง</button>
              </form>
              <div className={styles.manageList}>
                {flattenedFolders.map((folder) => (
                  <div key={folder.id} style={{ paddingLeft: 9 + folder.depth * 16 }}>
                    <span>▣ {folder.name}</span>
                    <div>
                      <button
                        className="tinyButton"
                        onClick={() => renameFolder(folder)}
                      >
                        เปลี่ยนชื่อ
                      </button>
                      <button
                        className="tinyButton danger"
                        onClick={() => deleteFolder(folder)}
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : showManager === "categories" ? (
            <>
              <div>
                <p className="eyebrow">Category Manager</p>
                <h3>จัดการหมวดหมู่</h3>
              </div>
              <form className="inlineForm" onSubmit={createCategory}>
                <input
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="ชื่อหมวดหมู่ใหม่"
                  required
                />
                <button className="button">สร้าง</button>
              </form>
              <div className={styles.manageList}>
                {categories.map((category) => (
                  <div key={category.id}>
                    <span>
                      {category.icon} {category.name}
                    </span>
                    <div>
                      <button
                        className="tinyButton"
                        onClick={() => editCategory(category)}
                      >
                        แก้ไข
                      </button>
                      <button
                        className="tinyButton danger"
                        onClick={() => deleteCategory(category)}
                      >
                        ลบพร้อมรูป
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : showManager === "tags" ? (
            <>
              <div>
                <p className="eyebrow">Tag Manager</p>
                <h3>จัดการแท็ก</h3>
              </div>
              <form className={styles.compactForm} onSubmit={createTag}>
                <input
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  placeholder="ชื่อแท็กใหม่"
                  required
                />
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(event) => setNewTagColor(event.target.value)}
                  aria-label="สีแท็ก"
                />
                <button className="button">สร้าง</button>
              </form>
              <div className={styles.manageList}>
                {tags.map((tag) => (
                  <div key={tag.id}>
                    <span
                      className={styles.tagBadge}
                      style={{ borderColor: tag.color, color: tag.color }}
                    >
                      #{tag.name}
                    </span>
                    <div>
                      <button
                        className="tinyButton"
                        onClick={() => editTag(tag)}
                      >
                        แก้ไข
                      </button>
                      <button
                        className="tinyButton danger"
                        onClick={() => deleteTag(tag)}
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.rankManager}>
              <div className={styles.rankGroupsPane}>
                <div>
                  <p className="eyebrow">Rank System</p>
                  <h3>ชุดระดับ</h3>
                </div>
                <form className={styles.stackForm} onSubmit={createRankGroup}>
                  <input
                    value={newRankGroupName}
                    onChange={(event) => setNewRankGroupName(event.target.value)}
                    placeholder="ชื่อชุดระดับ"
                    required
                  />
                  <textarea
                    value={newRankGroupDescription}
                    onChange={(event) =>
                      setNewRankGroupDescription(event.target.value)
                    }
                    placeholder="คำอธิบายชุดระดับ"
                  />
                  <button className="button">สร้างชุดระดับ</button>
                </form>
                <div className={styles.groupList}>
                  {rankGroups.map((group) => (
                    <button
                      key={group.id}
                      className={
                        selectedRankGroupId === group.id
                          ? styles.activeGroup
                          : ""
                      }
                      onClick={() => {
                        setSelectedRankGroupId(group.id);
                        setRankDraft(EMPTY_RANK_DRAFT);
                      }}
                    >
                      <strong>{group.name}</strong>
                      <small>{group.description || "ไม่มีคำอธิบาย"}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.ranksPane}>
                {selectedRankGroup ? (
                  <>
                    <div className={styles.rankGroupHeader}>
                      <div>
                        <h3>{selectedRankGroup.name}</h3>
                        <p>{selectedRankGroup.description}</p>
                      </div>
                      <div>
                        <button
                          className="tinyButton"
                          onClick={() => editRankGroup(selectedRankGroup)}
                        >
                          แก้ไขชุด
                        </button>
                        <button
                          className="tinyButton danger"
                          onClick={() => deleteRankGroup(selectedRankGroup)}
                        >
                          ลบชุด
                        </button>
                      </div>
                    </div>

                    <div className={styles.rankWorkspace}>
                      <div className={styles.rankList}>
                        {ranksInSelectedGroup.map((rank, index) => (
                          <article key={rank.id}>
                            <span
                              className={styles.rankBadge}
                              style={{
                                color: rank.color,
                                borderColor: rank.color,
                              }}
                            >
                              {rank.icon} {rank.name}
                            </span>
                            <p>{rank.description || "ไม่มีคำอธิบาย"}</p>
                            <div>
                              <button
                                className="tinyButton"
                                disabled={index === 0}
                                onClick={() => moveRank(rank, -1)}
                              >
                                ↑
                              </button>
                              <button
                                className="tinyButton"
                                disabled={index === ranksInSelectedGroup.length - 1}
                                onClick={() => moveRank(rank, 1)}
                              >
                                ↓
                              </button>
                              <button
                                className="tinyButton"
                                onClick={() =>
                                  setRankDraft({
                                    id: rank.id,
                                    name: rank.name,
                                    description: rank.description,
                                    color: rank.color,
                                    icon: rank.icon,
                                  })
                                }
                              >
                                แก้ไข
                              </button>
                              <button
                                className="tinyButton danger"
                                onClick={() => deleteRank(rank)}
                              >
                                ลบ
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>

                      <form className={styles.rankForm} onSubmit={saveRank}>
                        <h4>{rankDraft.id ? "แก้ไขระดับ" : "เพิ่มระดับ"}</h4>
                        <input
                          value={rankDraft.name}
                          onChange={(event) =>
                            setRankDraft((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="ชื่อระดับ"
                          required
                        />
                        <textarea
                          value={rankDraft.description}
                          onChange={(event) =>
                            setRankDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          placeholder="คำอธิบายระดับ"
                        />
                        <div className={styles.rankVisualInputs}>
                          <input
                            value={rankDraft.icon}
                            onChange={(event) =>
                              setRankDraft((current) => ({
                                ...current,
                                icon: event.target.value,
                              }))
                            }
                            placeholder="ไอคอน"
                          />
                          <input
                            type="color"
                            value={rankDraft.color}
                            onChange={(event) =>
                              setRankDraft((current) => ({
                                ...current,
                                color: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <button className="button">
                          {rankDraft.id ? "บันทึกระดับ" : "เพิ่มระดับ"}
                        </button>
                        {rankDraft.id ? (
                          <button
                            type="button"
                            className="tinyButton"
                            onClick={() => setRankDraft(EMPTY_RANK_DRAFT)}
                          >
                            ยกเลิกแก้ไข
                          </button>
                        ) : null}
                      </form>
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    สร้างหรือเลือกชุดระดับก่อน
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <div className={styles.vaultLayout}>
        <aside className={styles.folderPane}>
          <div className={styles.paneTitle}>
            <span>โฟลเดอร์</span>
            <small>{items.length} รายการ</small>
          </div>
          <button
            className={!selectedFolderId ? styles.activeFolder : ""}
            onClick={() => setSelectedFolderId("")}
          >
            <span>♛ รายการทั้งหมด</span>
            <b>{items.length}</b>
          </button>
          {flattenedFolders.map((folder) => (
            <button
              key={folder.id}
              className={
                selectedFolderId === folder.id ? styles.activeFolder : ""
              }
              style={{ paddingLeft: 10 + folder.depth * 15 }}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <span>▣ {folder.name}</span>
              <b>
                {items.filter((item) => item.folder_id === folder.id).length}
              </b>
            </button>
          ))}
        </aside>

        <section className={styles.galleryPane}>
          <div className={styles.galleryHeading}>
            <div>
              <p className="eyebrow">Vault Contents</p>
              <h3>
                {selectedFolderId
                  ? folderById.get(selectedFolderId)?.name || "โฟลเดอร์"
                  : "รายการทั้งหมด"}
              </h3>
            </div>
            <span>{visibleItems.length} รายการ</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>กำลังเปิดคลังพระเจ้า…</div>
          ) : visibleItems.length ? (
            <div className={styles.itemGrid}>
              {visibleItems.map((item) => {
                const selected = selectedIdSet.has(item.id);
                return (
                  <button
                    key={item.id}
                    className={`${styles.itemCard} ${
                      selectedItemId === item.id ? styles.selectedCard : ""
                    } ${selected ? styles.bulkSelected : ""}`}
                    onClick={(event) => {
                      if (selectionMode || event.ctrlKey || event.metaKey) {
                        toggleSelection(item.id);
                      } else {
                        setSelectedItemId(item.id);
                      }
                    }}
                  >
                    {selectionMode || selected ? (
                      <span
                        className={`${styles.selectionMark} ${
                          selected ? styles.selectionChecked : ""
                        }`}
                      >
                        {selected ? "✓" : ""}
                      </span>
                    ) : null}
                    <div className={styles.itemImage}>
                      {item.signed_url ? (
                        <img src={item.signed_url} alt={item.name} />
                      ) : (
                        <span>ภาพ</span>
                      )}
                    </div>
                    <div className={styles.itemInfo}>
                      <strong>{item.name}</strong>
                      <div className={styles.cardBadges}>
                        {item.rank_ids.slice(0, 2).map((rankId) => {
                          const rank = rankById.get(rankId);
                          return rank ? (
                            <span
                              key={rank.id}
                              className={styles.rankBadge}
                              style={{
                                color: rank.color,
                                borderColor: rank.color,
                              }}
                            >
                              {rank.icon} {rank.name}
                            </span>
                          ) : null;
                        })}
                        {item.category_ids.slice(0, 2).map((categoryId) => {
                          const category = categoryById.get(categoryId);
                          return category ? (
                            <span key={category.id}>{category.name}</span>
                          ) : null;
                        })}
                        {item.tag_ids.slice(0, 2).map((tagId) => {
                          const tag = tagById.get(tagId);
                          return tag ? (
                            <span
                              key={tag.id}
                              style={{ color: tag.color }}
                            >
                              #{tag.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              ยังไม่มีรูปในตำแหน่งนี้ กด “อัปโหลดรูป” หรือ “นำเข้าโฟลเดอร์”
            </div>
          )}
        </section>

        <aside className={styles.detailPane}>
          {selectedItem ? (
            <>
              <div className={styles.detailPreview}>
                {selectedItem.signed_url ? (
                  <img src={selectedItem.signed_url} alt={selectedItem.name} />
                ) : (
                  <span>ไม่พบภาพตัวอย่าง</span>
                )}
              </div>

              <form
                key={selectedItem.id}
                className={styles.detailForm}
                onSubmit={saveSelectedItem}
              >
                <label>
                  ชื่อ
                  <input name="name" defaultValue={selectedItem.name} required />
                </label>
                <label>
                  คำอธิบาย
                  <textarea
                    name="description"
                    defaultValue={selectedItem.description}
                    placeholder="เขียนรายละเอียดของรูปหรือของชิ้นนี้"
                  />
                </label>
                <label>
                  โฟลเดอร์
                  <select
                    name="folder_id"
                    defaultValue={selectedItem.folder_id ?? ""}
                  >
                    {renderFolderOptions(true)}
                  </select>
                </label>

                <fieldset>
                  <legend>หมวดหมู่</legend>
                  <div className={styles.checkGrid}>
                    {categories.map((category) => (
                      <label key={category.id}>
                        <input
                          type="checkbox"
                          checked={selectedItem.category_ids.includes(category.id)}
                          onChange={(event) =>
                            toggleCategory(category.id, event.target.checked)
                          }
                        />
                        <span>
                          {category.icon} {category.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>แท็ก</legend>
                  <div className={styles.checkGrid}>
                    {tags.map((tag) => (
                      <label key={tag.id}>
                        <input
                          type="checkbox"
                          checked={selectedItem.tag_ids.includes(tag.id)}
                          onChange={(event) =>
                            toggleTag(tag.id, event.target.checked)
                          }
                        />
                        <span style={{ color: tag.color }}>#{tag.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>ระดับ</legend>
                  <div className={styles.rankSelectors}>
                    {rankGroups.map((group) => {
                      const groupRanks = ranks
                        .filter((rank) => rank.group_id === group.id)
                        .sort((a, b) => a.sort_order - b.sort_order);
                      const currentRank = groupRanks.find((rank) =>
                        selectedItem.rank_ids.includes(rank.id)
                      );
                      return (
                        <label key={group.id}>
                          <span>{group.name}</span>
                          <select
                            value={currentRank?.id ?? ""}
                            onChange={(event) =>
                              setItemRank(group.id, event.target.value)
                            }
                          >
                            <option value="">ไม่กำหนด</option>
                            {groupRanks.map((rank) => (
                              <option key={rank.id} value={rank.id}>
                                {rank.icon} {rank.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div className={styles.fileMeta}>
                  <span>ไฟล์: {selectedItem.original_filename || "ไม่ระบุ"}</span>
                  <span>
                    ขนาด: {selectedItem.file_size
                      ? `${(selectedItem.file_size / 1024 / 1024).toFixed(2)} MB`
                      : "ไม่ระบุ"}
                  </span>
                </div>

                <button className="button">บันทึกการแก้ไข</button>
                <button
                  type="button"
                  className="button danger"
                  onClick={deleteSelectedItem}
                >
                  ลบรายการถาวร
                </button>
              </form>
            </>
          ) : (
            <div className={styles.detailEmpty}>
              <span>✦</span>
              <strong>เลือกรายการ</strong>
              <p>คลิกรูปจากพื้นที่ตรงกลางเพื่อดูและแก้ไขรายละเอียด</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
