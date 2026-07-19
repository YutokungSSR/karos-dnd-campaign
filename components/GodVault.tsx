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

const EMPTY_RANK_DRAFT: RankDraft = {
  id: "",
  name: "",
  description: "",
  color: "#d8b35f",
  icon: "◆",
};

function normalizeColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
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
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterTagId, setFilterTagId] = useState("");
  const [filterRankId, setFilterRankId] = useState("");
  const [search, setSearch] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showManager, setShowManager] = useState<ManagerName>(null);

  const [newFolderName, setNewFolderName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#8a795f");
  const [newRankGroupName, setNewRankGroupName] = useState("");
  const [newRankGroupDescription, setNewRankGroupDescription] = useState("");
  const [selectedRankGroupId, setSelectedRankGroupId] = useState("");
  const [rankDraft, setRankDraft] = useState<RankDraft>(EMPTY_RANK_DRAFT);

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

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId]
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
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [ranks, selectedRankGroupId]
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

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
        .toLowerCase();
      const rankText = item.rank_ids
        .map((rankId) => rankById.get(rankId)?.name ?? "")
        .join(" ")
        .toLowerCase();

      const searchMatches =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
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
      if (!itemIds.has(link.item_id) || !campaignTagIds.has(link.tag_id)) continue;
      const current = tagsByItem.get(link.item_id) ?? [];
      current.push(link.tag_id);
      tagsByItem.set(link.item_id, current);
    }

    const ranksByItem = new Map<string, string[]>();
    for (const link of rankLinkResult.data ?? []) {
      if (!itemIds.has(link.item_id) || !campaignRankIds.has(link.rank_id)) continue;
      const current = ranksByItem.get(link.item_id) ?? [];
      current.push(link.rank_id);
      ranksByItem.set(link.item_id, current);
    }

    const withUrls = await Promise.all(
      rawItems.map(async (item) => {
        const { data } = await supabase.storage
          .from("god-vault-assets")
          .createSignedUrl(item.image_path, 3600);

        return {
          ...item,
          signed_url: data?.signedUrl,
          category_ids: categoriesByItem.get(item.id) ?? [],
          tag_ids: tagsByItem.get(item.id) ?? [],
          rank_ids: ranksByItem.get(item.id) ?? [],
        } as VaultItem;
      })
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

  function safeFilename(filename: string) {
    const extension = filename.includes(".")
      ? `.${filename.split(".").pop()}`
      : "";

    return `${crypto.randomUUID()}${extension.toLowerCase()}`;
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;

    setUploading(true);
    setMessage("");
    const supabase = getSupabase();
    let successCount = 0;

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        const storagePath = `${campaignId}/${safeFilename(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("god-vault-assets")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const baseName = file.name.replace(/\.[^.]+$/, "") || "รูปภาพใหม่";
        const { data: item, error: itemError } = await supabase
          .from("god_vault_items")
          .insert({
            campaign_id: campaignId,
            folder_id: selectedFolderId || null,
            name: baseName,
            description: "",
            image_path: storagePath,
            original_filename: file.name,
            mime_type: file.type,
            file_size: file.size,
            created_by: userId,
          })
          .select("*")
          .single();

        if (itemError) {
          await supabase.storage.from("god-vault-assets").remove([storagePath]);
          throw itemError;
        }

        if (filterCategoryId && item) {
          const { error } = await supabase
            .from("god_vault_item_categories")
            .insert({ item_id: item.id, category_id: filterCategoryId });
          if (error) throw error;
        }

        if (filterTagId && item) {
          const { error } = await supabase
            .from("god_vault_item_tags")
            .insert({ item_id: item.id, tag_id: filterTagId });
          if (error) throw error;
        }

        if (filterRankId && item) {
          const { error } = await supabase
            .from("god_vault_item_ranks")
            .insert({ item_id: item.id, rank_id: filterRankId });
          if (error) throw error;
        }

        successCount += 1;
      }

      setMessage(`นำเข้ารูปสำเร็จ ${successCount} รายการ`);
      await loadVault();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "อัปโหลดรูปไม่สำเร็จ"
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!newFolderName.trim()) return;

    const { error } = await getSupabase().from("god_vault_folders").insert({
      campaign_id: campaignId,
      parent_id: null,
      name: newFolderName.trim(),
      created_by: userId,
    });

    if (error) return setMessage(error.message);

    setNewFolderName("");
    setMessage("สร้างโฟลเดอร์แล้ว");
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

  async function createRankGroup(event: FormEvent) {
    event.preventDefault();
    if (!newRankGroupName.trim()) return;

    const nextSort =
      rankGroups.reduce((highest, group) => Math.max(highest, group.sort_order), -1) + 1;

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
    const first = await supabase
      .from("god_vault_ranks")
      .update({ sort_order: swapWith.sort_order })
      .eq("id", rank.id);
    if (first.error) return setMessage(first.error.message);

    const second = await supabase
      .from("god_vault_ranks")
      .update({ sort_order: rank.sort_order })
      .eq("id", swapWith.id);
    if (second.error) return setMessage(second.error.message);

    loadVault();
  }

  async function deleteFolder(folder: Folder) {
    const descendantIds = new Set<string>([folder.id]);
    let foundMore = true;

    while (foundMore) {
      foundMore = false;
      for (const entry of folders) {
        if (
          entry.parent_id &&
          descendantIds.has(entry.parent_id) &&
          !descendantIds.has(entry.id)
        ) {
          descendantIds.add(entry.id);
          foundMore = true;
        }
      }
    }

    const affectedItems = items.filter(
      (item) => item.folder_id && descendantIds.has(item.folder_id)
    );

    const confirmed = window.confirm(
      `ลบโฟลเดอร์ “${folder.name}” และรูปภายใน ${affectedItems.length} รายการอย่างถาวรใช่ไหม?\n\nโฟลเดอร์ย่อย ข้อมูล และไฟล์รูปทั้งหมดจะถูกลบทันทีและกู้คืนไม่ได้`
    );
    if (!confirmed) return;

    const supabase = getSupabase();
    const imagePaths = affectedItems.map((item) => item.image_path);

    if (imagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("god-vault-assets")
        .remove(imagePaths);

      if (storageError) {
        setMessage(`ลบไฟล์รูปไม่สำเร็จ: ${storageError.message}`);
        return;
      }
    }

    const { error } = await supabase
      .from("god_vault_folders")
      .delete()
      .eq("id", folder.id);

    if (error) return setMessage(error.message);

    if (selectedFolderId && descendantIds.has(selectedFolderId)) {
      setSelectedFolderId("");
    }
    if (
      selectedItemId &&
      affectedItems.some((item) => item.id === selectedItemId)
    ) {
      setSelectedItemId(null);
    }

    setMessage(
      `ลบโฟลเดอร์ “${folder.name}” และรูปภายใน ${affectedItems.length} รายการแล้ว`
    );
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

    const supabase = getSupabase();
    const imagePaths = affectedItems.map((item) => item.image_path);
    const itemIds = affectedItems.map((item) => item.id);

    if (imagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("god-vault-assets")
        .remove(imagePaths);
      if (storageError) {
        setMessage(`ลบไฟล์รูปไม่สำเร็จ: ${storageError.message}`);
        return;
      }
    }

    if (itemIds.length) {
      const { error: itemError } = await supabase
        .from("god_vault_items")
        .delete()
        .in("id", itemIds);
      if (itemError) return setMessage(itemError.message);
    }

    const { error } = await supabase
      .from("god_vault_categories")
      .delete()
      .eq("id", category.id);
    if (error) return setMessage(error.message);

    if (
      selectedItemId &&
      affectedItems.some((item) => item.id === selectedItemId)
    ) {
      setSelectedItemId(null);
    }
    if (filterCategoryId === category.id) setFilterCategoryId("");

    setMessage(
      `ลบหมวดหมู่ “${category.name}” และรูป ${affectedItems.length} รายการแล้ว`
    );
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
      ? await supabase.from("god_vault_item_categories").insert({
          item_id: selectedItem.id,
          category_id: categoryId,
        })
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
      ? await supabase.from("god_vault_item_tags").insert({
          item_id: selectedItem.id,
          tag_id: tagId,
        })
      : await supabase
          .from("god_vault_item_tags")
          .delete()
          .eq("item_id", selectedItem.id)
          .eq("tag_id", tagId);

    if (result.error) return setMessage(result.error.message);
    loadVault();
  }

  async function setItemRank(groupId: string, nextRankId: string) {
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

    if (nextRankId) {
      const { error } = await supabase.from("god_vault_item_ranks").insert({
        item_id: selectedItem.id,
        rank_id: nextRankId,
      });
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

    const supabase = getSupabase();
    const { error: storageError } = await supabase.storage
      .from("god-vault-assets")
      .remove([selectedItem.image_path]);

    if (storageError) {
      setMessage(`ลบไฟล์รูปไม่สำเร็จ: ${storageError.message}`);
      return;
    }

    const { error } = await supabase
      .from("god_vault_items")
      .delete()
      .eq("id", selectedItem.id);
    if (error) return setMessage(error.message);

    setSelectedItemId(null);
    setMessage(`ลบ “${selectedItem.name}” อย่างถาวรแล้ว`);
    loadVault();
  }

  function managerButton(name: Exclude<ManagerName, null>, label: string) {
    return (
      <button
        className="tinyButton"
        onClick={() => setShowManager(showManager === name ? null : name)}
      >
        {label}
      </button>
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
            onChange={(event) => uploadFiles(event.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => uploadFiles(event.target.files)}
          />

          <button
            className="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "กำลังอัปโหลด…" : "＋ อัปโหลดรูป"}
          </button>

          <button
            className="button ghost"
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            นำเข้าโฟลเดอร์
          </button>
        </div>
      </header>

      {message ? <p className="notice banner">{message}</p> : null}

      <div className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ค้นหาชื่อ คำอธิบาย แท็ก หรือระดับ…"
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
          {managerButton("folders", "โฟลเดอร์")}
          {managerButton("categories", "หมวดหมู่")}
          {managerButton("tags", "แท็ก")}
          {managerButton("ranks", "ระดับ")}
        </div>
      </div>

      {showManager ? (
        <section
          className={`${styles.managerPanel} ${
            showManager === "ranks" ? styles.rankManagerPanel : ""
          }`}
        >
          {showManager === "folders" ? (
            <>
              <div>
                <p className="eyebrow">Folder Manager</p>
                <h3>จัดการโฟลเดอร์</h3>
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
                {folders.map((folder) => (
                  <div key={folder.id}>
                    <span>▣ {folder.name}</span>
                    <div className={styles.rowActions}>
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
          ) : null}

          {showManager === "categories" ? (
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
                      <i
                        className={styles.colorDot}
                        style={{ backgroundColor: category.color }}
                      />
                      {category.icon} {category.name}
                    </span>
                    <div className={styles.rowActions}>
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
          ) : null}

          {showManager === "tags" ? (
            <>
              <div>
                <p className="eyebrow">Tag Manager</p>
                <h3>จัดการแท็ก</h3>
                <p className={styles.managerHint}>
                  การลบแท็กจะไม่ลบรูป
                </p>
              </div>

              <form className={styles.compactCreateForm} onSubmit={createTag}>
                <input
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  placeholder="ชื่อแท็กใหม่"
                  required
                />
                <input
                  className={styles.colorInput}
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
                      className={styles.managerTag}
                      style={{ borderColor: tag.color, color: tag.color }}
                    >
                      # {tag.name}
                    </span>
                    <div className={styles.rowActions}>
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
                        ลบแท็ก
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {showManager === "ranks" ? (
            <div className={styles.rankManager}>
              <section className={styles.rankGroupColumn}>
                <div>
                  <p className="eyebrow">Rank Sets</p>
                  <h3>ชุดระดับ</h3>
                  <p className={styles.managerHint}>
                    เช่น ความหายาก ระดับภัยคุกคาม หรือลำดับบอส
                  </p>
                </div>

                <form className={styles.stackForm} onSubmit={createRankGroup}>
                  <input
                    value={newRankGroupName}
                    onChange={(event) =>
                      setNewRankGroupName(event.target.value)
                    }
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
                  <button className="button">＋ สร้างชุดระดับ</button>
                </form>

                <div className={styles.rankGroupList}>
                  {rankGroups.map((group) => (
                    <button
                      key={group.id}
                      className={
                        selectedRankGroupId === group.id
                          ? styles.activeRankGroup
                          : ""
                      }
                      onClick={() => {
                        setSelectedRankGroupId(group.id);
                        setRankDraft(EMPTY_RANK_DRAFT);
                      }}
                    >
                      <strong>{group.name}</strong>
                      <span>
                        {ranks.filter((rank) => rank.group_id === group.id).length} ระดับ
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className={styles.rankEditorColumn}>
                {selectedRankGroup ? (
                  <>
                    <div className={styles.rankGroupHeader}>
                      <div>
                        <p className="eyebrow">Selected Rank Set</p>
                        <h3>{selectedRankGroup.name}</h3>
                        <p>{selectedRankGroup.description || "ไม่มีคำอธิบาย"}</p>
                      </div>
                      <div className={styles.rowActions}>
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

                    <form className={styles.rankForm} onSubmit={saveRank}>
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
                      <input
                        className={styles.iconInput}
                        value={rankDraft.icon}
                        onChange={(event) =>
                          setRankDraft((current) => ({
                            ...current,
                            icon: event.target.value,
                          }))
                        }
                        placeholder="ไอคอน"
                        maxLength={4}
                      />
                      <input
                        className={styles.colorInput}
                        type="color"
                        value={rankDraft.color}
                        onChange={(event) =>
                          setRankDraft((current) => ({
                            ...current,
                            color: event.target.value,
                          }))
                        }
                        aria-label="สีระดับ"
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
                      <button className="button">
                        {rankDraft.id ? "บันทึกระดับ" : "＋ เพิ่มระดับ"}
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

                    <div className={styles.rankList}>
                      {ranksInSelectedGroup.length ? (
                        ranksInSelectedGroup.map((rank, index) => (
                          <article key={rank.id} className={styles.rankRow}>
                            <span
                              className={styles.rankBadge}
                              style={{ borderColor: rank.color, color: rank.color }}
                            >
                              {rank.icon} {rank.name}
                            </span>
                            <p>{rank.description || "ไม่มีคำอธิบาย"}</p>
                            <div className={styles.rowActions}>
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
                        ))
                      ) : (
                        <p className={styles.managerHint}>
                          ชุดนี้ยังไม่มีระดับ เพิ่มระดับแรกจากแบบฟอร์มด้านบน
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    สร้างหรือเลือกชุดระดับจากด้านซ้าย
                  </div>
                )}
              </section>
            </div>
          ) : null}
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

          {folders.map((folder) => (
            <button
              key={folder.id}
              className={
                selectedFolderId === folder.id ? styles.activeFolder : ""
              }
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
                  ? folders.find((folder) => folder.id === selectedFolderId)
                      ?.name || "โฟลเดอร์"
                  : "รายการทั้งหมด"}
              </h3>
            </div>
            <span>{visibleItems.length} รายการ</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>กำลังเปิดคลังพระเจ้า…</div>
          ) : visibleItems.length ? (
            <div className={styles.itemGrid}>
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.itemCard} ${
                    selectedItemId === item.id ? styles.selectedCard : ""
                  }`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className={styles.itemImage}>
                    {item.signed_url ? (
                      <img src={item.signed_url} alt={item.name} />
                    ) : (
                      <span>ภาพ</span>
                    )}
                  </div>

                  <div className={styles.itemInfo}>
                    <strong>{item.name}</strong>

                    <div className={styles.cardRanks}>
                      {item.rank_ids.slice(0, 2).map((rankId) => {
                        const rank = rankById.get(rankId);
                        return rank ? (
                          <span
                            key={rank.id}
                            style={{ borderColor: rank.color, color: rank.color }}
                          >
                            {rank.icon} {rank.name}
                          </span>
                        ) : null;
                      })}
                    </div>

                    <div className={styles.cardCategories}>
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
                            style={{ borderColor: tag.color, color: tag.color }}
                          >
                            #{tag.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              ไม่พบรูปที่ตรงกับโฟลเดอร์และตัวกรองปัจจุบัน
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
                    <option value="">ไม่มีโฟลเดอร์</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset>
                  <legend>หมวดหมู่</legend>
                  <div className={styles.multiChoiceGrid}>
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
                  <div className={styles.multiChoiceGrid}>
                    {tags.length ? (
                      tags.map((tag) => (
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
                      ))
                    ) : (
                      <span className={styles.managerHint}>
                        ยังไม่มีแท็ก สร้างจากปุ่ม “แท็ก” ด้านบน
                      </span>
                    )}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>ระดับ</legend>
                  <div className={styles.itemRankSelectors}>
                    {rankGroups.length ? (
                      rankGroups.map((group) => {
                        const groupRanks = ranks
                          .filter((rank) => rank.group_id === group.id)
                          .sort((a, b) => a.sort_order - b.sort_order);
                        const currentRankId =
                          selectedItem.rank_ids.find((rankId) =>
                            groupRanks.some((rank) => rank.id === rankId)
                          ) ?? "";

                        return (
                          <label key={group.id}>
                            <span>{group.name}</span>
                            <select
                              value={currentRankId}
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
                      })
                    ) : (
                      <span className={styles.managerHint}>
                        ยังไม่มีชุดระดับ สร้างจากปุ่ม “ระดับ” ด้านบน
                      </span>
                    )}
                  </div>
                </fieldset>

                <div className={styles.fileMeta}>
                  <span>
                    ไฟล์: {selectedItem.original_filename || "ไม่ระบุ"}
                  </span>
                  <span>
                    ขนาด:{" "}
                    {selectedItem.file_size
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
