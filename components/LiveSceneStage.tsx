"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import styles from "./LiveSceneStage.module.css";

type AssetType =
  | "scene"
  | "character"
  | "monster"
  | "item"
  | "effect"
  | "custom";

type MotionName =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "scale";

type StageState = {
  campaign_id: string;
  draft_scene_id: string | null;
  next_scene_id: string | null;
  published_version: number;
  published_snapshot: PublishedSnapshot | null;
  published_at: string | null;
  published_by: string | null;
  editor_user_id: string | null;
  editor_expires_at: string | null;
};

type PublishedAsset = {
  asset_id: string;
  name: string;
  asset_type: AssetType;
  storage_path: string;
};

type PublishedObject = {
  id: string;
  asset_id: string;
  name: string;
  object_type: AssetType;
  storage_path: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  rotation_deg: number;
  z_index: number;
  opacity: number;
  flip_x: boolean;
  visible: boolean;
  enter_motion: MotionName;
  exit_motion: MotionName;
  motion_duration_ms: number;
  motion_delay_ms: number;
};

type PublishedSnapshot = {
  source_scene_id: string;
  scene_name: string;
  background: PublishedAsset | null;
  transition: {
    color: string;
    out_ms: number;
    hold_ms: number;
    in_ms: number;
  };
  objects: PublishedObject[];
};

type Category = {
  id: string;
  campaign_id: string;
  name: string;
};

type Asset = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  name: string;
  asset_type: AssetType;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string;
  signed_url?: string;
};

type Scene = {
  id: string;
  campaign_id: string;
  name: string;
  background_asset_id: string | null;
  transition_color: string;
  transition_out_ms: number;
  transition_hold_ms: number;
  transition_in_ms: number;
  updated_at: string;
};

type SceneObject = {
  id: string;
  scene_id: string;
  asset_id: string;
  name: string;
  object_type: AssetType;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  rotation_deg: number;
  z_index: number;
  opacity: number;
  flip_x: boolean;
  visible: boolean;
  enter_motion: MotionName;
  exit_motion: MotionName;
  motion_duration_ms: number;
  motion_delay_ms: number;
  updated_at: string;
};

type VaultItem = {
  id: string;
  name: string;
  description: string;
  image_path: string;
  original_filename: string | null;
  mime_type: string | null;
  signed_url?: string;
};

type CampaignCharacter = {
  id: string;
  name: string;
  portrait_url: string | null;
};

type LockResult = {
  acquired: boolean;
  editor_user_id: string | null;
  editor_name: string;
  expires_at: string | null;
};

type LiveSceneStageProps = {
  campaignId: string;
  userId: string;
};

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "scene", label: "ฉาก / แผนที่" },
  { value: "character", label: "ตัวละคร" },
  { value: "monster", label: "มอนสเตอร์" },
  { value: "item", label: "ไอเทม" },
  { value: "effect", label: "เอฟเฟกต์" },
  { value: "custom", label: "กำหนดเอง" },
];

const MOTIONS: Array<{ value: MotionName; label: string }> = [
  { value: "none", label: "ไม่มี Motion" },
  { value: "fade", label: "เรือนจาง" },
  { value: "slide-left", label: "เลื่อนเข้าจากซ้าย" },
  { value: "slide-right", label: "เลื่อนเข้าจากขวา" },
  { value: "slide-up", label: "เลื่อนขึ้นจากด้านล่าง" },
  { value: "scale", label: "ขยายเข้าฉาก" },
];

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
}

function safeFilename(filename: string) {
  const normalized = filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `image-${Date.now()}.png`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function motionClass(name: MotionName) {
  if (name === "fade") return styles.motionFade;
  if (name === "slide-left") return styles.motionSlideLeft;
  if (name === "slide-right") return styles.motionSlideRight;
  if (name === "slide-up") return styles.motionSlideUp;
  if (name === "scale") return styles.motionScale;
  return "";
}

export default function LiveSceneStage({
  campaignId,
  userId,
}: LiveSceneStageProps) {
  const [isDm, setIsDm] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [displaySnapshot, setDisplaySnapshot] =
    useState<PublishedSnapshot | null>(null);
  const [displayUrls, setDisplayUrls] = useState<Record<string, string>>({});
  const [stageLoading, setStageLoading] = useState(true);
  const [stageMessage, setStageMessage] = useState("");
  const [transitionCovered, setTransitionCovered] = useState(false);
  const [transitionColor, setTransitionColor] = useState("#000000");
  const [transitionDuration, setTransitionDuration] = useState(0);

  const [studioOpen, setStudioOpen] = useState(false);
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioMessage, setStudioMessage] = useState("");
  const [lockInfo, setLockInfo] = useState<LockResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [campaignCharacters, setCampaignCharacters] = useState<
    CampaignCharacter[]
  >([]);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [previewMode, setPreviewMode] = useState(false);

  const [sceneName, setSceneName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | "all">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState<AssetType>("scene");
  const [uploadCategoryId, setUploadCategoryId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const studioCanvasRef = useRef<HTMLDivElement | null>(null);
  const currentVersionRef = useRef(0);
  const transitionSequenceRef = useRef(0);
  const objectsRef = useRef<SceneObject[]>([]);
  const studioOpenRef = useRef(false);
  const restoringStudioRef = useRef(false);

  const studioSessionKey = useMemo(
    () => `live-scene-studio:${campaignId}:${userId}`,
    [campaignId, userId]
  );
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    studioOpenRef.current = studioOpen;
  }, [studioOpen]);

  useEffect(() => {
    let active = true;
    async function checkDmAccess() {
      const { data, error } = await getSupabase().rpc("is_campaign_dm", {
        target_campaign: campaignId,
      });
      if (active && !error) setIsDm(Boolean(data));
    }
    checkDmAccess();
    return () => {
      active = false;
    };
  }, [campaignId, userId]);

  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]
  );
  const sceneById = useMemo(
    () => new Map(scenes.map((scene) => [scene.id, scene])),
    [scenes]
  );
  const selectedScene = sceneById.get(selectedSceneId) ?? null;
  const selectedSceneObjects = useMemo(
    () =>
      objects
        .filter((object) => object.scene_id === selectedSceneId)
        .sort((left, right) => left.z_index - right.z_index),
    [objects, selectedSceneId]
  );
  const selectedObject =
    objects.find((object) => object.id === selectedObjectId) ?? null;
  const publishedSceneId =
    stageState?.published_snapshot?.source_scene_id ?? null;

  const visibleAssets = useMemo(() => {
    const search = assetSearch.trim().toLocaleLowerCase("th-TH");
    return assets.filter((asset) => {
      if (assetTypeFilter !== "all" && asset.asset_type !== assetTypeFilter) {
        return false;
      }
      if (categoryFilter !== "all" && asset.category_id !== categoryFilter) {
        return false;
      }
      return !search || asset.name.toLocaleLowerCase("th-TH").includes(search);
    });
  }, [assetSearch, assetTypeFilter, assets, categoryFilter]);

  const signSnapshot = useCallback(async (snapshot: PublishedSnapshot | null) => {
    if (!snapshot) return {};
    const paths = Array.from(
      new Set(
        [
          snapshot.background?.storage_path,
          ...snapshot.objects.map((object) => object.storage_path),
        ].filter((path): path is string => Boolean(path))
      )
    );
    if (!paths.length) return {};

    const { data, error } = await getSupabase()
      .storage.from("live-scene-assets")
      .createSignedUrls(paths, 60 * 60);
    if (error) throw error;

    const signed: Record<string, string> = {};
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) signed[entry.path] = entry.signedUrl;
    }

    await Promise.allSettled(
      Object.values(signed).map(
        (url) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = url;
          })
      )
    );
    return signed;
  }, []);

  const applyPublishedState = useCallback(
    async (nextState: StageState | null, animate: boolean) => {
      const nextVersion = Number(nextState?.published_version ?? 0);
      if (
        nextVersion === currentVersionRef.current &&
        displaySnapshot !== null
      ) {
        setStageState(nextState);
        return;
      }

      const sequence = transitionSequenceRef.current + 1;
      transitionSequenceRef.current = sequence;
      const snapshot = nextState?.published_snapshot ?? null;
      const urls = await signSnapshot(snapshot);
      if (sequence !== transitionSequenceRef.current) return;

      const shouldAnimate =
        animate && currentVersionRef.current > 0 && snapshot !== null;
      if (!shouldAnimate) {
        setDisplaySnapshot(snapshot);
        setDisplayUrls(urls);
        setStageState(nextState);
        currentVersionRef.current = nextVersion;
        setStageLoading(false);
        return;
      }

      const transition = snapshot.transition;
      setTransitionColor(transition.color || "#000000");
      setTransitionDuration(transition.out_ms);
      setTransitionCovered(true);
      await wait(transition.out_ms);
      if (sequence !== transitionSequenceRef.current) return;
      await wait(transition.hold_ms);
      if (sequence !== transitionSequenceRef.current) return;

      setDisplaySnapshot(snapshot);
      setDisplayUrls(urls);
      setStageState(nextState);
      currentVersionRef.current = nextVersion;
      setTransitionDuration(transition.in_ms);
      requestAnimationFrame(() => setTransitionCovered(false));
      setStageLoading(false);
    },
    [displaySnapshot, signSnapshot]
  );

  const loadPublishedStage = useCallback(
    async (animate = false) => {
      const { data, error } = await getSupabase()
        .from("live_scene_stage_state")
        .select("*")
        .eq("campaign_id", campaignId)
        .maybeSingle();

      if (error) {
        setStageMessage(error.message);
        setStageLoading(false);
        return;
      }
      await applyPublishedState((data as StageState | null) ?? null, animate);
    },
    [applyPublishedState, campaignId]
  );

  useEffect(() => {
    loadPublishedStage(false);
  }, [loadPublishedStage]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`live-scene-stage-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_scene_stage_state",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            applyPublishedState(null, false);
            return;
          }
          applyPublishedState(payload.new as StageState, true);
        }
      )
      .subscribe();

    const fallback = window.setInterval(() => loadPublishedStage(true), 30000);
    return () => {
      window.clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [applyPublishedState, campaignId, loadPublishedStage]);

  async function requestFullscreen(target: HTMLDivElement | null) {
    if (!target) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await target.requestFullscreen();
    }
  }

  const loadStudio = useCallback(async (preferredSceneOverride?: string) => {
    setStudioLoading(true);
    setStudioMessage("");
    const supabase = getSupabase();

    try {
      await supabase.rpc("ensure_live_scene_stage", {
        target_campaign: campaignId,
      });

      const [stateResult, categoryResult, assetResult, sceneResult, characterResult] =
        await Promise.all([
          supabase
            .from("live_scene_stage_state")
            .select("*")
            .eq("campaign_id", campaignId)
            .single(),
          supabase
            .from("live_scene_categories")
            .select("*")
            .eq("campaign_id", campaignId)
            .order("name"),
          supabase
            .from("live_scene_assets")
            .select("*")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false }),
          supabase
            .from("live_scenes")
            .select("*")
            .eq("campaign_id", campaignId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("characters")
            .select("id,name,portrait_url")
            .eq("campaign_id", campaignId)
            .order("name"),
        ]);

      const firstError =
        stateResult.error ||
        categoryResult.error ||
        assetResult.error ||
        sceneResult.error ||
        characterResult.error;
      if (firstError) throw firstError;

      const nextState = stateResult.data as StageState;
      const nextAssets = (assetResult.data ?? []) as Asset[];
      const paths = nextAssets.map((asset) => asset.storage_path);
      const signedMap = new Map<string, string>();
      if (paths.length) {
        const { data: signedRows, error: signError } = await supabase.storage
          .from("live-scene-assets")
          .createSignedUrls(paths, 60 * 60);
        if (signError) throw signError;
        for (const row of signedRows ?? []) {
          if (row.path && row.signedUrl) signedMap.set(row.path, row.signedUrl);
        }
      }

      const nextScenes = (sceneResult.data ?? []) as Scene[];
      const sceneIds = nextScenes.map((scene) => scene.id);
      let nextObjects: SceneObject[] = [];
      if (sceneIds.length) {
        const { data: objectRows, error: objectError } = await supabase
          .from("live_scene_objects")
          .select("*")
          .in("scene_id", sceneIds)
          .order("z_index");
        if (objectError) throw objectError;
        nextObjects = (objectRows ?? []) as SceneObject[];
      }

      const { data: vaultRows, error: vaultError } = await supabase
        .from("god_vault_items")
        .select("id,name,description,image_path,original_filename,mime_type")
        .eq("campaign_id", campaignId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (vaultError) throw vaultError;

      const nextVault = (vaultRows ?? []) as VaultItem[];
      if (nextVault.length) {
        const { data: signedVault } = await supabase.storage
          .from("god-vault-assets")
          .createSignedUrls(
            nextVault.map((item) => item.image_path),
            60 * 30
          );
        const vaultMap = new Map<string, string>();
        for (const row of signedVault ?? []) {
          if (row.path && row.signedUrl) vaultMap.set(row.path, row.signedUrl);
        }
        for (const item of nextVault) {
          item.signed_url = vaultMap.get(item.image_path);
        }
      }

      setStageState(nextState);
      setCategories((categoryResult.data ?? []) as Category[]);
      setAssets(
        nextAssets.map((asset) => ({
          ...asset,
          signed_url: signedMap.get(asset.storage_path),
        }))
      );
      setScenes(nextScenes);
      setObjects(nextObjects);
      setVaultItems(nextVault);
      setCampaignCharacters(
        (characterResult.data ?? []) as CampaignCharacter[]
      );

      const preferredCandidate = preferredSceneOverride || selectedSceneId;
      const preferredScene =
        (preferredCandidate &&
        nextScenes.some((scene) => scene.id === preferredCandidate)
          ? preferredCandidate
          : nextState.draft_scene_id) ?? nextScenes[0]?.id ?? "";
      setSelectedSceneId(preferredScene);
      setSelectedObjectId((current) =>
        nextObjects.some(
          (object) => object.id === current && object.scene_id === preferredScene
        )
          ? current
          : ""
      );
    } catch (error) {
      setStudioMessage(errorText(error));
    } finally {
      setStudioLoading(false);
    }
  }, [campaignId, selectedSceneId]);

  const openStudio = useCallback(
    async (preferredSceneId = "", restoring = false) => {
      if (!isDm || restoringStudioRef.current) return;
      restoringStudioRef.current = true;
      setStudioMessage("");

      try {
        const { data, error } = await getSupabase().rpc(
          "acquire_live_scene_lock",
          {
            target_campaign: campaignId,
            lease_seconds: 300,
          }
        );
        if (error) {
          if (!restoring) setStageMessage(error.message);
          return;
        }

        const result = data as LockResult;
        setLockInfo(result);
        if (!result.acquired) {
          window.sessionStorage.removeItem(studioSessionKey);
          setStageMessage(
            `${result.editor_name || "DM คนอื่น"} กำลังจัดฉากนี้อยู่ กรุณารอให้ Studio ถูกปล่อยก่อน`
          );
          return;
        }

        setStudioOpen(true);
        window.sessionStorage.setItem(
          studioSessionKey,
          JSON.stringify({ open: true, selectedSceneId: preferredSceneId })
        );
        await loadStudio(preferredSceneId || undefined);
      } finally {
        restoringStudioRef.current = false;
      }
    },
    [campaignId, isDm, loadStudio, studioSessionKey]
  );

  const closeStudio = useCallback(async () => {
    window.sessionStorage.removeItem(studioSessionKey);
    setStudioOpen(false);
    setPreviewMode(false);
    setSelectedObjectId("");
    setLockInfo(null);
    await getSupabase().rpc("release_live_scene_lock", {
      target_campaign: campaignId,
    });
  }, [campaignId, studioSessionKey]);

  useEffect(() => {
    if (!isDm || studioOpen || restoringStudioRef.current) return;

    const raw = window.sessionStorage.getItem(studioSessionKey);
    if (!raw) return;

    try {
      const saved = JSON.parse(raw) as {
        open?: boolean;
        selectedSceneId?: string;
      };
      if (saved.open) {
        void openStudio(saved.selectedSceneId ?? "", true);
      }
    } catch {
      window.sessionStorage.removeItem(studioSessionKey);
    }
  }, [isDm, openStudio, studioOpen, studioSessionKey]);

  useEffect(() => {
    if (!studioOpen) return;
    window.sessionStorage.setItem(
      studioSessionKey,
      JSON.stringify({ open: true, selectedSceneId })
    );
  }, [selectedSceneId, studioOpen, studioSessionKey]);

  useEffect(() => {
    if (!studioOpen || !lockInfo?.acquired) return;

    let refreshing = false;
    const refreshLock = async () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const { data, error } = await getSupabase().rpc(
          "acquire_live_scene_lock",
          {
            target_campaign: campaignId,
            lease_seconds: 300,
          }
        );
        if (error) {
          setStudioMessage(error.message);
          return;
        }

        const result = data as LockResult;
        setLockInfo(result);
        if (!result.acquired) {
          window.sessionStorage.removeItem(studioSessionKey);
          setStudioOpen(false);
          setStudioMessage(
            `${result.editor_name || "DM คนอื่น"} รับช่วงแก้ไขฉากนี้แล้ว`
          );
          return;
        }

        await loadStudio(selectedSceneId || undefined);
      } finally {
        refreshing = false;
      }
    };

    const heartbeat = window.setInterval(async () => {
      const { data } = await getSupabase().rpc("heartbeat_live_scene_lock", {
        target_campaign: campaignId,
        lease_seconds: 300,
      });
      if (!data && document.visibilityState === "visible") {
        await refreshLock();
      }
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshLock();
    };
    const handleFocus = () => void refreshLock();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    campaignId,
    loadStudio,
    lockInfo?.acquired,
    selectedSceneId,
    studioOpen,
    studioSessionKey,
  ]);

  useEffect(() => {
    return () => {
      if (studioOpenRef.current) {
        getSupabase().rpc("release_live_scene_lock", {
          target_campaign: campaignId,
        });
      }
    };
  }, [campaignId]);

  async function chooseScene(sceneId: string) {
    setSelectedSceneId(sceneId);
    setSelectedObjectId("");
    const { error } = await getSupabase().rpc("set_live_scene_draft", {
      target_campaign: campaignId,
      target_scene: sceneId,
    });
    if (error) setStudioMessage(error.message);
    else {
      setStageState((current) =>
        current ? { ...current, draft_scene_id: sceneId } : current
      );
    }
  }

  async function createScene() {
    const name = sceneName.trim();
    if (!name) return setStudioMessage("กรุณาตั้งชื่อฉากใหม่");
    const id = crypto.randomUUID();
    const { error } = await getSupabase().from("live_scenes").insert({
      id,
      campaign_id: campaignId,
      name,
      created_by: userId,
      updated_by: userId,
    });
    if (error) return setStudioMessage(error.message);
    setSceneName("");
    await getSupabase().rpc("set_live_scene_draft", {
      target_campaign: campaignId,
      target_scene: id,
    });
    setSelectedSceneId(id);
    await loadStudio(id);
  }

  async function updateScene(patch: Partial<Scene>) {
    if (!selectedScene) return;
    setScenes((current) =>
      current.map((scene) =>
        scene.id === selectedScene.id ? { ...scene, ...patch } : scene
      )
    );
    const { error } = await getSupabase()
      .from("live_scenes")
      .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", selectedScene.id);
    if (error) setStudioMessage(error.message);
  }

  async function deleteScene(scene: Scene) {
    const confirmed = window.confirm(
      `ลบฉาก “${scene.name}” ถาวรหรือไม่?\n\nวัตถุและการตั้งค่าทั้งหมดในฉากนี้จะถูกลบ และไม่สามารถกู้คืนได้`
    );
    if (!confirmed) return;
    const { error } = await getSupabase().rpc("delete_live_scene", {
      target_scene: scene.id,
    });
    if (error) return setStudioMessage(error.message);
    if (selectedSceneId === scene.id) setSelectedSceneId("");
    await loadStudio();
  }

  async function setNextScene(sceneId: string) {
    const { error } = await getSupabase().rpc("set_live_scene_next", {
      target_campaign: campaignId,
      target_scene: sceneId,
    });
    if (error) return setStudioMessage(error.message);
    setStageState((current) =>
      current ? { ...current, next_scene_id: sceneId } : current
    );
    setStudioMessage(`ตั้ง “${sceneById.get(sceneId)?.name}” เป็นฉากถัดไปแล้ว`);
  }

  async function publishScene(sceneId: string) {
    const scene = sceneById.get(sceneId);
    if (!scene) return;
    const confirmed = window.confirm(
      `ยืนยันการแสดงผล “${scene.name}” ให้ผู้เล่นทุกคนเห็นใช่ไหม?\n\nผู้เล่นจะเห็นฉากนี้พร้อม Transition ที่ตั้งไว้`
    );
    if (!confirmed) return;
    setStudioMessage("กำลังเผยแพร่ฉาก…");
    const { data, error } = await getSupabase().rpc("publish_live_scene", {
      target_campaign: campaignId,
      source_scene: sceneId,
    });
    if (error) return setStudioMessage(error.message);
    setStudioMessage(`เผยแพร่ “${scene.name}” สำเร็จ · เวอร์ชัน ${data}`);
    await loadStudio();
    await loadPublishedStage(true);
  }

  async function addCategory() {
    const name = categoryName.trim();
    if (!name) return;
    const { error } = await getSupabase().from("live_scene_categories").insert({
      campaign_id: campaignId,
      name,
      created_by: userId,
    });
    if (error) return setStudioMessage(error.message);
    setCategoryName("");
    await loadStudio();
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`ลบหมวดหมู่ “${category.name}” ถาวรหรือไม่?`)) return;
    const { error } = await getSupabase().rpc("delete_live_scene_category", {
      target_category: category.id,
    });
    if (error) return setStudioMessage(error.message);
    await loadStudio();
  }

  async function uploadAsset(
    file: File,
    name: string,
    assetType: AssetType,
    categoryId: string | null
  ) {
    if (!file.type.startsWith("image/")) {
      throw new Error("รองรับเฉพาะไฟล์รูปภาพเท่านั้น");
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error("ไฟล์รูปต้องมีขนาดไม่เกิน 15 MB");
    }
    const assetId = crypto.randomUUID();
    const storagePath = `${campaignId}/${assetId}/${safeFilename(file.name)}`;
    const supabase = getSupabase();
    const { error: uploadError } = await supabase.storage
      .from("live-scene-assets")
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("live_scene_assets").insert({
      id: assetId,
      campaign_id: campaignId,
      category_id: categoryId,
      name: name.trim() || file.name,
      asset_type: assetType,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type,
      created_by: userId,
    });
    if (insertError) {
      await supabase.storage.from("live-scene-assets").remove([storagePath]);
      throw insertError;
    }
  }

  async function submitUpload() {
    if (!uploadFile) return setStudioMessage("กรุณาเลือกไฟล์รูปก่อน");
    setUploading(true);
    setStudioMessage("");
    try {
      await uploadAsset(
        uploadFile,
        uploadName,
        uploadType,
        uploadCategoryId || null
      );
      setUploadFile(null);
      setUploadName("");
      const input = document.getElementById(
        "live-scene-upload-input"
      ) as HTMLInputElement | null;
      if (input) input.value = "";
      await loadStudio();
      setStudioMessage("อัปโหลดรูปเข้าสู่คลังฉากแล้ว");
    } catch (error) {
      setStudioMessage(errorText(error));
    } finally {
      setUploading(false);
    }
  }

  async function importRemoteImage(
    sourceId: string,
    url: string,
    name: string,
    assetType: AssetType,
    originalFilename: string
  ) {
    setImportingId(sourceId);
    setStudioMessage("");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`ดาวน์โหลดรูปไม่สำเร็จ (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], originalFilename || `${name}.png`, {
        type: blob.type || "image/png",
      });
      await uploadAsset(file, name, assetType, uploadCategoryId || null);
      await loadStudio();
      setStudioMessage(`เพิ่ม “${name}” เข้าคลังฉากแล้ว`);
    } catch (error) {
      setStudioMessage(errorText(error));
    } finally {
      setImportingId(null);
    }
  }

  async function deleteAsset(asset: Asset) {
    const confirmed = window.confirm(
      `ลบรูป “${asset.name}” ถาวรหรือไม่?\n\nไฟล์จะถูกลบออกจาก Storage และไม่สามารถกู้คืนได้`
    );
    if (!confirmed) return;
    const { data: storagePath, error } = await getSupabase().rpc(
      "delete_live_scene_asset",
      { target_asset: asset.id }
    );
    if (error) return setStudioMessage(error.message);
    if (storagePath) {
      const { error: storageError } = await getSupabase().storage
        .from("live-scene-assets")
        .remove([storagePath as string]);
      if (storageError) {
        setStudioMessage(
          `ลบข้อมูลรูปแล้ว แต่ลบไฟล์ Storage ไม่สำเร็จ: ${storageError.message}`
        );
      }
    }
    await loadStudio();
  }

  async function addAssetToScene(asset: Asset) {
    if (!selectedScene) return;
    const highestZ = selectedSceneObjects.reduce(
      (maximum, object) => Math.max(maximum, object.z_index),
      0
    );
    const newObject: SceneObject = {
      id: crypto.randomUUID(),
      scene_id: selectedScene.id,
      asset_id: asset.id,
      name: asset.name,
      object_type: asset.asset_type,
      x_pct: 50,
      y_pct: 54,
      width_pct:
        asset.asset_type === "character" || asset.asset_type === "monster"
          ? 28
          : 20,
      rotation_deg: 0,
      z_index: highestZ + 1,
      opacity: 1,
      flip_x: false,
      visible: true,
      enter_motion: "fade",
      exit_motion: "fade",
      motion_duration_ms: 650,
      motion_delay_ms: 0,
      updated_at: new Date().toISOString(),
    };
    const { error } = await getSupabase()
      .from("live_scene_objects")
      .insert(newObject);
    if (error) return setStudioMessage(error.message);
    setObjects((current) => [...current, newObject]);
    setSelectedObjectId(newObject.id);
  }

  function patchObject(objectId: string, patch: Partial<SceneObject>) {
    setObjects((current) =>
      current.map((object) =>
        object.id === objectId ? { ...object, ...patch } : object
      )
    );
  }

  async function saveObject(object: SceneObject) {
    const { error } = await getSupabase()
      .from("live_scene_objects")
      .update({
        name: object.name,
        x_pct: object.x_pct,
        y_pct: object.y_pct,
        width_pct: object.width_pct,
        rotation_deg: object.rotation_deg,
        z_index: object.z_index,
        opacity: object.opacity,
        flip_x: object.flip_x,
        visible: object.visible,
        enter_motion: object.enter_motion,
        exit_motion: object.exit_motion,
        motion_duration_ms: object.motion_duration_ms,
        motion_delay_ms: object.motion_delay_ms,
        updated_at: new Date().toISOString(),
      })
      .eq("id", object.id);
    if (error) setStudioMessage(error.message);
    else setStudioMessage(`บันทึก “${object.name}” ในฉากร่างแล้ว`);
  }

  async function deleteObject(object: SceneObject) {
    if (!window.confirm(`นำ “${object.name}” ออกจากฉากร่างหรือไม่?`)) return;
    const { error } = await getSupabase().rpc("delete_live_scene_object", {
      target_object: object.id,
    });
    if (error) return setStudioMessage(error.message);
    setObjects((current) => current.filter((entry) => entry.id !== object.id));
    setSelectedObjectId("");
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    object: SceneObject
  ) {
    if (previewMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: object.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: Number(object.x_pct),
      startY: Number(object.y_pct),
    };
    setSelectedObjectId(object.id);
  }

  useEffect(() => {
    function moveObject(event: PointerEvent) {
      const drag = dragRef.current;
      const canvas = studioCanvasRef.current;
      if (!drag || !canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const nextX = clamp(
        drag.startX + ((event.clientX - drag.startClientX) / bounds.width) * 100,
        -20,
        120
      );
      const nextY = clamp(
        drag.startY + ((event.clientY - drag.startClientY) / bounds.height) * 100,
        -20,
        120
      );
      patchObject(drag.id, { x_pct: nextX, y_pct: nextY });
    }

    async function finishDrag() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const object = objectsRef.current.find((entry) => entry.id === drag.id);
      if (object) await saveObject(object);
    }

    window.addEventListener("pointermove", moveObject);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", moveObject);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  const renderStageObjects = (
    snapshot: PublishedSnapshot,
    urls: Record<string, string>,
    version: number
  ) =>
    snapshot.objects.map((object) => {
      const url = urls[object.storage_path];
      if (!url || !object.visible) return null;
      const outerStyle: CSSProperties = {
        left: `${object.x_pct}%`,
        top: `${object.y_pct}%`,
        width: `${object.width_pct}%`,
        zIndex: object.z_index,
        opacity: object.opacity,
        transform: `translate(-50%, -50%) rotate(${object.rotation_deg}deg) scaleX(${
          object.flip_x ? -1 : 1
        })`,
      };
      const imageStyle: CSSProperties = {
        animationDuration: `${object.motion_duration_ms}ms`,
        animationDelay: `${object.motion_delay_ms}ms`,
      };
      return (
        <div
          className={styles.publishedObject}
          style={outerStyle}
          key={`${version}-${object.id}`}
        >
          <img
            className={motionClass(object.enter_motion)}
            style={imageStyle}
            src={url}
            alt={object.name}
            draggable={false}
          />
        </div>
      );
    });

  return (
    <>
      <section className={styles.stagePanel}>
        <header className={styles.stageHeader}>
          <div>
            <p>LIVE SCENE STAGE</p>
            <h2>เวทีฉากแบบเรียลไทม์</h2>
            <span>
              {displaySnapshot?.scene_name || "DM ยังไม่ได้เผยแพร่ฉาก"}
              {stageState?.published_version
                ? ` · เวอร์ชัน ${stageState.published_version}`
                : ""}
            </span>
          </div>
          <div className={styles.stageActions}>
            {isDm ? (
              <button type="button" onClick={() => void openStudio()}>
                ✦ เปิด DM Studio
              </button>
            ) : null}
            <button type="button" onClick={() => requestFullscreen(viewerRef.current)}>
              ⛶ เต็มจอ
            </button>
          </div>
        </header>

        {stageMessage ? <p className={styles.stageMessage}>{stageMessage}</p> : null}

        <div className={styles.viewerFrame} ref={viewerRef}>
          {stageLoading ? (
            <div className={styles.emptyStage}>
              <i>✦</i>
              <strong>กำลังเชื่อมต่อเวทีฉาก…</strong>
            </div>
          ) : displaySnapshot ? (
            <div className={styles.stageCanvas}>
              {displaySnapshot.background &&
              displayUrls[displaySnapshot.background.storage_path] ? (
                <img
                  className={styles.stageBackground}
                  src={displayUrls[displaySnapshot.background.storage_path]}
                  alt={displaySnapshot.background.name}
                  draggable={false}
                />
              ) : (
                <div className={styles.blankBackground} />
              )}
              {renderStageObjects(
                displaySnapshot,
                displayUrls,
                stageState?.published_version ?? 0
              )}
              <div className={styles.stageVignette} />
            </div>
          ) : (
            <div className={styles.emptyStage}>
              <i>✦</i>
              <strong>เวทียังว่างเปล่า</strong>
              <span>รอ DM เตรียมและยืนยันการแสดงผลฉากแรก</span>
            </div>
          )}

          <div
            className={`${styles.transitionCurtain} ${
              transitionCovered ? styles.transitionCovered : ""
            }`}
            style={{
              backgroundColor: transitionColor,
              transitionDuration: `${transitionDuration}ms`,
            }}
          />
        </div>
      </section>

      {studioOpen ? (
        <div className={styles.studioOverlay}>
          <section className={styles.studioModal}>
            <header className={styles.studioHeader}>
              <div>
                <p>LIVE SCENE CONTROL ROOM</p>
                <h2>DM Studio</h2>
                <span>
                  ฉากร่างจะไม่แสดงแก่ผู้เล่น จนกว่าจะกดยืนยันการแสดงผล
                </span>
              </div>
              <div className={styles.studioHeaderActions}>
                <button
                  type="button"
                  onClick={() => setPreviewMode((current) => !current)}
                >
                  {previewMode ? "กลับโหมดแก้ไข" : "ดูแบบผู้เล่น"}
                </button>
                <button
                  type="button"
                  onClick={() => requestFullscreen(studioCanvasRef.current)}
                >
                  ⛶ เวทีเต็มจอ
                </button>
                <button type="button" onClick={closeStudio}>
                  ปิด Studio
                </button>
              </div>
            </header>

            {studioMessage ? (
              <p className={styles.studioMessage}>{studioMessage}</p>
            ) : null}

            {studioLoading ? (
              <div className={styles.studioLoading}>กำลังเตรียมห้องควบคุมฉาก…</div>
            ) : (
              <div className={styles.studioLayout}>
                <aside className={styles.scenePane}>
                  <div className={styles.paneHeading}>
                    <p>SCENE QUEUE</p>
                    <h3>รายการฉาก</h3>
                  </div>

                  <div className={styles.sceneCreator}>
                    <input
                      value={sceneName}
                      onChange={(event) => setSceneName(event.target.value)}
                      placeholder="ชื่อฉากใหม่"
                    />
                    <button type="button" onClick={createScene}>
                      + สร้างฉาก
                    </button>
                  </div>

                  <div className={styles.sceneList}>
                    {scenes.map((scene) => (
                      <article
                        className={`${styles.sceneCard} ${
                          selectedSceneId === scene.id ? styles.sceneCardActive : ""
                        }`}
                        key={scene.id}
                      >
                        <button type="button" onClick={() => chooseScene(scene.id)}>
                          <strong>{scene.name}</strong>
                          <span>
                            {publishedSceneId === scene.id ? "กำลังแสดง" : "ฉากร่าง"}
                            {stageState?.next_scene_id === scene.id
                              ? " · ฉากถัดไป"
                              : ""}
                          </span>
                        </button>
                        <div>
                          <button type="button" onClick={() => setNextScene(scene.id)}>
                            ตั้งเป็นฉากถัดไป
                          </button>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            onClick={() => deleteScene(scene)}
                          >
                            ลบ
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className={styles.categoryBox}>
                    <div className={styles.paneHeading}>
                      <p>CUSTOM GROUPS</p>
                      <h3>หมวดหมู่</h3>
                    </div>
                    <div className={styles.categoryCreator}>
                      <input
                        value={categoryName}
                        onChange={(event) => setCategoryName(event.target.value)}
                        placeholder="ชื่อหมวดใหม่"
                      />
                      <button type="button" onClick={addCategory}>
                        เพิ่ม
                      </button>
                    </div>
                    <div className={styles.categoryList}>
                      {categories.map((category) => (
                        <span key={category.id}>
                          {category.name}
                          <button
                            type="button"
                            onClick={() => deleteCategory(category)}
                            aria-label={`ลบหมวด ${category.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </aside>

                <main className={styles.stageEditorPane}>
                  {selectedScene ? (
                    <>
                      <div className={styles.sceneToolbar}>
                        <div>
                          <input
                            className={styles.sceneTitleInput}
                            value={selectedScene.name}
                            onChange={(event) =>
                              setScenes((current) =>
                                current.map((scene) =>
                                  scene.id === selectedScene.id
                                    ? { ...scene, name: event.target.value }
                                    : scene
                                )
                              )
                            }
                            onBlur={(event) =>
                              updateScene({ name: event.target.value.trim() || "ฉาก" })
                            }
                          />
                          <small>
                            {previewMode
                              ? "ตัวอย่างมุมมองผู้เล่น"
                              : "ลากวัตถุเพื่อจัดตำแหน่งในฉากร่าง"}
                          </small>
                        </div>
                        <div>
                          {stageState?.next_scene_id ? (
                            <button
                              type="button"
                              onClick={() => publishScene(stageState.next_scene_id!)}
                            >
                              เปลี่ยนไปฉากถัดไป
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.publishButton}
                            onClick={() => publishScene(selectedScene.id)}
                          >
                            ✦ ยืนยันการแสดงผล
                          </button>
                        </div>
                      </div>

                      <div className={styles.transitionControls}>
                        <label>
                          สี Transition
                          <input
                            type="color"
                            value={selectedScene.transition_color}
                            onChange={(event) =>
                              updateScene({ transition_color: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          จางออก (ms)
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            value={selectedScene.transition_out_ms}
                            onChange={(event) =>
                              updateScene({
                                transition_out_ms: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          ค้าง (ms)
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            value={selectedScene.transition_hold_ms}
                            onChange={(event) =>
                              updateScene({
                                transition_hold_ms: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          จางเข้า (ms)
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            value={selectedScene.transition_in_ms}
                            onChange={(event) =>
                              updateScene({
                                transition_in_ms: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </div>

                      <div
                        className={`${styles.editorCanvas} ${
                          previewMode ? styles.editorCanvasPreview : ""
                        }`}
                        ref={studioCanvasRef}
                      >
                        {selectedScene.background_asset_id &&
                        assetById.get(selectedScene.background_asset_id)?.signed_url ? (
                          <img
                            className={styles.stageBackground}
                            src={
                              assetById.get(selectedScene.background_asset_id)!
                                .signed_url
                            }
                            alt="ฉากพื้นหลัง"
                            draggable={false}
                          />
                        ) : (
                          <div className={styles.blankBackground} />
                        )}

                        {selectedSceneObjects.map((object) => {
                          const asset = assetById.get(object.asset_id);
                          if (!asset?.signed_url || !object.visible) return null;
                          const isSelected = selectedObjectId === object.id;
                          return (
                            <button
                              type="button"
                              className={`${styles.editorObject} ${
                                isSelected ? styles.editorObjectSelected : ""
                              }`}
                              style={{
                                left: `${object.x_pct}%`,
                                top: `${object.y_pct}%`,
                                width: `${object.width_pct}%`,
                                zIndex: object.z_index,
                                opacity: object.opacity,
                                transform: `translate(-50%, -50%) rotate(${object.rotation_deg}deg) scaleX(${
                                  object.flip_x ? -1 : 1
                                })`,
                              }}
                              key={object.id}
                              onPointerDown={(event) => beginDrag(event, object)}
                              onClick={() => setSelectedObjectId(object.id)}
                            >
                              <img
                                className={
                                  previewMode ? motionClass(object.enter_motion) : ""
                                }
                                style={{
                                  animationDuration: `${object.motion_duration_ms}ms`,
                                  animationDelay: `${object.motion_delay_ms}ms`,
                                }}
                                src={asset.signed_url}
                                alt={object.name}
                                draggable={false}
                              />
                              {!previewMode ? <i>{object.name}</i> : null}
                            </button>
                          );
                        })}
                        <div className={styles.stageVignette} />
                      </div>

                      <div className={styles.draftNotice}>
                        <strong>ฉากร่างส่วนตัวของ DM</strong>
                        <span>
                          การลาก ย่อ–ขยาย หรือเพิ่มวัตถุจะไม่ส่งให้ผู้เล่น
                          จนกว่าจะกด “ยืนยันการแสดงผล”
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className={styles.noScene}>กรุณาสร้างหรือเลือกฉาก</div>
                  )}
                </main>

                <aside className={styles.controlPane}>
                  <div className={styles.controlScroll}>
                    <section className={styles.objectInspector}>
                      <div className={styles.paneHeading}>
                        <p>OBJECT INSPECTOR</p>
                        <h3>คุณสมบัติวัตถุ</h3>
                      </div>
                      {selectedObject ? (
                        <div className={styles.inspectorForm}>
                          <label>
                            ชื่อ
                            <input
                              value={selectedObject.name}
                              onChange={(event) =>
                                patchObject(selectedObject.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className={styles.inspectorGrid}>
                            <label>
                              X (%)
                              <input
                                type="number"
                                value={selectedObject.x_pct}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    x_pct: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Y (%)
                              <input
                                type="number"
                                value={selectedObject.y_pct}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    y_pct: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              ขนาด (%)
                              <input
                                type="number"
                                min="2"
                                max="150"
                                value={selectedObject.width_pct}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    width_pct: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              หมุน (°)
                              <input
                                type="number"
                                value={selectedObject.rotation_deg}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    rotation_deg: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Layer
                              <input
                                type="number"
                                value={selectedObject.z_index}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    z_index: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              โปร่งใส
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.05"
                                value={selectedObject.opacity}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    opacity: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label>
                            Motion ตอนเข้าฉาก
                            <select
                              value={selectedObject.enter_motion}
                              onChange={(event) =>
                                patchObject(selectedObject.id, {
                                  enter_motion: event.target.value as MotionName,
                                })
                              }
                            >
                              {MOTIONS.map((motion) => (
                                <option value={motion.value} key={motion.value}>
                                  {motion.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Motion ตอนออก
                            <select
                              value={selectedObject.exit_motion}
                              onChange={(event) =>
                                patchObject(selectedObject.id, {
                                  exit_motion: event.target.value as MotionName,
                                })
                              }
                            >
                              {MOTIONS.map((motion) => (
                                <option value={motion.value} key={motion.value}>
                                  {motion.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className={styles.inspectorGrid}>
                            <label>
                              ระยะเวลา (ms)
                              <input
                                type="number"
                                min="0"
                                max="10000"
                                value={selectedObject.motion_duration_ms}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    motion_duration_ms: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Delay (ms)
                              <input
                                type="number"
                                min="0"
                                max="30000"
                                value={selectedObject.motion_delay_ms}
                                onChange={(event) =>
                                  patchObject(selectedObject.id, {
                                    motion_delay_ms: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label className={styles.checkLine}>
                            <input
                              type="checkbox"
                              checked={selectedObject.flip_x}
                              onChange={(event) =>
                                patchObject(selectedObject.id, {
                                  flip_x: event.target.checked,
                                })
                              }
                            />
                            กลับด้านซ้าย–ขวา
                          </label>
                          <label className={styles.checkLine}>
                            <input
                              type="checkbox"
                              checked={selectedObject.visible}
                              onChange={(event) =>
                                patchObject(selectedObject.id, {
                                  visible: event.target.checked,
                                })
                              }
                            />
                            แสดงในฉากเมื่อเผยแพร่
                          </label>
                          <div className={styles.inspectorActions}>
                            <button
                              type="button"
                              onClick={() => saveObject(selectedObject)}
                            >
                              บันทึกวัตถุ
                            </button>
                            <button
                              type="button"
                              className={styles.dangerButton}
                              onClick={() => deleteObject(selectedObject)}
                            >
                              นำออกจากฉาก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className={styles.mutedBox}>
                          คลิกวัตถุบนเวทีเพื่อแก้ไขตำแหน่ง ขนาด และ Motion
                        </p>
                      )}
                    </section>

                    <section className={styles.assetLibrary}>
                      <div className={styles.paneHeading}>
                        <p>ASSET LIBRARY</p>
                        <h3>คลังภาพฉาก</h3>
                      </div>

                      <div className={styles.assetFilters}>
                        <input
                          value={assetSearch}
                          onChange={(event) => setAssetSearch(event.target.value)}
                          placeholder="ค้นหารูป…"
                        />
                        <select
                          value={assetTypeFilter}
                          onChange={(event) =>
                            setAssetTypeFilter(
                              event.target.value as AssetType | "all"
                            )
                          }
                        >
                          <option value="all">ทุกประเภท</option>
                          {ASSET_TYPES.map((type) => (
                            <option value={type.value} key={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={categoryFilter}
                          onChange={(event) => setCategoryFilter(event.target.value)}
                        >
                          <option value="all">ทุกหมวด</option>
                          {categories.map((category) => (
                            <option value={category.id} key={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.assetGrid}>
                        {visibleAssets.map((asset) => (
                          <article className={styles.assetCard} key={asset.id}>
                            <div>
                              {asset.signed_url ? (
                                <img src={asset.signed_url} alt={asset.name} />
                              ) : (
                                <span>ไม่มีภาพ</span>
                              )}
                            </div>
                            <strong>{asset.name}</strong>
                            <small>{asset.asset_type}</small>
                            <div className={styles.assetCardActions}>
                              <button
                                type="button"
                                onClick={() => addAssetToScene(asset)}
                                disabled={!selectedScene}
                              >
                                + วางในฉาก
                              </button>
                              {asset.asset_type === "scene" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateScene({ background_asset_id: asset.id })
                                  }
                                  disabled={!selectedScene}
                                >
                                  ใช้เป็นพื้นหลัง
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={styles.dangerButton}
                                onClick={() => deleteAsset(asset)}
                              >
                                ลบถาวร
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className={styles.uploadBox}>
                      <div className={styles.paneHeading}>
                        <p>UPLOAD</p>
                        <h3>อัปโหลดรูปใหม่</h3>
                      </div>
                      <input
                        id="live-scene-upload-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(event) =>
                          setUploadFile(event.target.files?.[0] ?? null)
                        }
                      />
                      <input
                        value={uploadName}
                        onChange={(event) => setUploadName(event.target.value)}
                        placeholder="ชื่อรูป (เว้นว่างใช้ชื่อไฟล์)"
                      />
                      <div className={styles.uploadGrid}>
                        <select
                          value={uploadType}
                          onChange={(event) =>
                            setUploadType(event.target.value as AssetType)
                          }
                        >
                          {ASSET_TYPES.map((type) => (
                            <option value={type.value} key={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={uploadCategoryId}
                          onChange={(event) => setUploadCategoryId(event.target.value)}
                        >
                          <option value="">ไม่ระบุหมวด</option>
                          {categories.map((category) => (
                            <option value={category.id} key={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="button" onClick={submitUpload} disabled={uploading}>
                        {uploading ? "กำลังอัปโหลด…" : "อัปโหลดเข้าสู่คลังฉาก"}
                      </button>
                    </section>

                    <section className={styles.importBox}>
                      <div className={styles.paneHeading}>
                        <p>CAMPAIGN SOURCES</p>
                        <h3>นำเข้าจากข้อมูลเดิม</h3>
                      </div>
                      <details>
                        <summary>ตัวละครในแคมเปญ</summary>
                        <div className={styles.importList}>
                          {campaignCharacters.map((character) => (
                            <article key={character.id}>
                              {character.portrait_url ? (
                                <img src={character.portrait_url} alt={character.name} />
                              ) : (
                                <span>♜</span>
                              )}
                              <strong>{character.name}</strong>
                              <button
                                type="button"
                                disabled={!character.portrait_url || importingId !== null}
                                onClick={() =>
                                  character.portrait_url &&
                                  importRemoteImage(
                                    `character-${character.id}`,
                                    character.portrait_url,
                                    character.name,
                                    "character",
                                    `${character.name}.png`
                                  )
                                }
                              >
                                {importingId === `character-${character.id}`
                                  ? "กำลังนำเข้า…"
                                  : "นำเข้า"}
                              </button>
                            </article>
                          ))}
                        </div>
                      </details>
                      <details>
                        <summary>คลังพระเจ้า</summary>
                        <div className={styles.importList}>
                          {vaultItems.map((item) => (
                            <article key={item.id}>
                              {item.signed_url ? (
                                <img src={item.signed_url} alt={item.name} />
                              ) : (
                                <span>✦</span>
                              )}
                              <strong>{item.name}</strong>
                              <button
                                type="button"
                                disabled={!item.signed_url || importingId !== null}
                                onClick={() =>
                                  item.signed_url &&
                                  importRemoteImage(
                                    `vault-${item.id}`,
                                    item.signed_url,
                                    item.name,
                                    "custom",
                                    item.original_filename || `${item.name}.png`
                                  )
                                }
                              >
                                {importingId === `vault-${item.id}`
                                  ? "กำลังนำเข้า…"
                                  : "นำเข้า"}
                              </button>
                            </article>
                          ))}
                        </div>
                      </details>
                    </section>
                  </div>
                </aside>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
