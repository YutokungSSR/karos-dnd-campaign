"use client";

import {
  ChangeEvent,
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
};

export default function GodVault({
  campaignId,
  userId,
}: {
  campaignId: string;
  userId: string;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showManager, setShowManager] = useState<"folders" | "categories" | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items.filter((item) => {
      const folderMatches =
        !selectedFolderId || item.folder_id === selectedFolderId;
      const categoryMatches =
        !filterCategoryId || item.category_ids.includes(filterCategoryId);
      const searchMatches =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query);

      return folderMatches && categoryMatches && searchMatches;
    });
  }, [filterCategoryId, items, search, selectedFolderId]);

  const loadVault = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();

    const [categoryResult, folderResult, itemResult, linkResult] =
      await Promise.all([
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
        supabase
          .from("god_vault_item_categories")
          .select("item_id,category_id"),
      ]);

    const firstError =
      categoryResult.error ||
      folderResult.error ||
      itemResult.error ||
      linkResult.error;

    if (firstError) {
      setMessage(firstError.message);
      setLoading(false);
      return;
    }

    const linksByItem = new Map<string, string[]>();
    for (const link of linkResult.data ?? []) {
      const current = linksByItem.get(link.item_id) ?? [];
      current.push(link.category_id);
      linksByItem.set(link.item_id, current);
    }

    const rawItems = itemResult.data ?? [];
    const withUrls = await Promise.all(
      rawItems.map(async (item) => {
        const { data } = await supabase.storage
          .from("god-vault-assets")
          .createSignedUrl(item.image_path, 3600);

        return {
          ...item,
          signed_url: data?.signedUrl,
          category_ids: linksByItem.get(item.id) ?? [],
        } as VaultItem;
      })
    );

    setCategories(categoryResult.data ?? []);
    setFolders(folderResult.data ?? []);
    setItems(withUrls);

    if (
      selectedItemId &&
      !withUrls.some((item) => item.id === selectedItemId)
    ) {
      setSelectedItemId(null);
    }

    setLoading(false);
  }, [campaignId, selectedItemId]);

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
          await supabase.storage
            .from("god-vault-assets")
            .remove([storagePath]);
          throw itemError;
        }

        if (filterCategoryId && item) {
          await supabase.from("god_vault_item_categories").insert({
            item_id: item.id,
            category_id: filterCategoryId,
          });
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

    const { error } = await getSupabase()
      .from("god_vault_folders")
      .insert({
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

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    if (!newCategoryName.trim()) return;

    const { error } = await getSupabase()
      .from("god_vault_categories")
      .insert({
        campaign_id: campaignId,
        name: newCategoryName.trim(),
        created_by: userId,
      });

    if (error) return setMessage(error.message);

    setNewCategoryName("");
    setMessage("สร้างหมวดหมู่แล้ว");
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

    if (error) {
      setMessage(error.message);
      return;
    }

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

      if (itemError) {
        setMessage(itemError.message);
        return;
      }
    }

    const { error } = await supabase
      .from("god_vault_categories")
      .delete()
      .eq("id", category.id);

    if (error) {
      setMessage(error.message);
      return;
    }

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

  async function saveSelectedItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem) return;

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "");
    const folderId = String(formData.get("folder_id") ?? "");

    if (!name) {
      setMessage("กรุณาใส่ชื่อรายการ");
      return;
    }

    const { error } = await getSupabase()
      .from("god_vault_items")
      .update({
        name,
        description,
        folder_id: folderId || null,
      })
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

    if (result.error) {
      setMessage(result.error.message);
      return;
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

    if (error) {
      setMessage(error.message);
      return;
    }

    setSelectedItemId(null);
    setMessage(`ลบ “${selectedItem.name}” อย่างถาวรแล้ว`);
    loadVault();
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
          placeholder="ค้นหาด้วยชื่อหรือคำอธิบาย…"
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

        <button
          className="tinyButton"
          onClick={() =>
            setShowManager(showManager === "folders" ? null : "folders")
          }
        >
          จัดการโฟลเดอร์
        </button>

        <button
          className="tinyButton"
          onClick={() =>
            setShowManager(
              showManager === "categories" ? null : "categories"
            )
          }
        >
          จัดการหมวดหมู่
        </button>
      </div>

      {showManager ? (
        <section className={styles.managerPanel}>
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
                    <button
                      className="tinyButton danger"
                      onClick={() => deleteFolder(folder)}
                    >
                      ลบ
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="eyebrow">Category Manager</p>
                <h3>จัดการหมวดหมู่</h3>
              </div>

              <form className="inlineForm" onSubmit={createCategory}>
                <input
                  value={newCategoryName}
                  onChange={(event) =>
                    setNewCategoryName(event.target.value)
                  }
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
                    <button
                      className="tinyButton danger"
                      onClick={() => deleteCategory(category)}
                    >
                      ลบ
                    </button>
                  </div>
                ))}
              </div>
            </>
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
                    <div className={styles.cardCategories}>
                      {item.category_ids.slice(0, 3).map((categoryId) => {
                        const category = categories.find(
                          (entry) => entry.id === categoryId
                        );
                        return category ? (
                          <span key={category.id}>{category.name}</span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              ยังไม่มีรูปในตำแหน่งนี้ กด “อัปโหลดรูป” เพื่อเพิ่มรายการแรก
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
                  <input
                    name="name"
                    defaultValue={selectedItem.name}
                    required
                  />
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
                  <div className={styles.categoryChecks}>
                    {categories.map((category) => (
                      <label key={category.id}>
                        <input
                          type="checkbox"
                          checked={selectedItem.category_ids.includes(
                            category.id
                          )}
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

                <div className={styles.fileMeta}>
                  <span>
                    ไฟล์: {selectedItem.original_filename || "ไม่ระบุ"}
                  </span>
                  <span>
                    ขนาด:{" "}
                    {selectedItem.file_size
                      ? `${(selectedItem.file_size / 1024 / 1024).toFixed(
                          2
                        )} MB`
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
              <p>
                คลิกรูปจากพื้นที่ตรงกลางเพื่อดูและแก้ไขรายละเอียด
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
