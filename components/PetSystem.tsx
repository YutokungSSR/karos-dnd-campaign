"use client";

import {
  ChangeEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import PetPhase2 from "./PetPhase2";
import styles from "./PetSystem.module.css";

type PetStatus =
  | "pending"
  | "revision"
  | "approved"
  | "rejected"
  | "suspended";
  | "released";

type CharacterSummary = {
  id: string;
  name: string;
  owner_id: string;
  campaign_id: string | null;
};

type Pet = {
  id: string;
  character_id: string;
  campaign_id: string | null;
  created_by: string;
  name: string;
  title: string;
  pet_type: string;
  species: string;
  description: string;
  level: number;
  rank: string;
  element: string;
  status: PetStatus;
  approval_note: string;
  is_active: boolean;
  current_form_id: string | null;
  current_hp: number;
  max_hp: number;
  current_mp: number;
  max_mp: number;
  stats: Record<string, number>;
  relationship_points: number;
  relationship_max: number;
  tap_enabled: boolean;
  tap_limit: number;
  tap_window_seconds: number;
  tap_min_points: number;
  tap_max_points: number;
  tap_daily_cap: number;
  inventory_capacity: number;
  created_at: string;
};

type PetForm = {
  id: string;
  pet_id: string;
  parent_form_id: string | null;
  name: string;
  description: string;
  image_path: string;
  relationship_required: number;
  element: string;
  pet_type: string;
  is_starting: boolean;
  is_hidden: boolean;
  sort_order: number;
};

type PetSkill = {
  id: string;
  pet_id: string;
  form_id: string | null;
  name: string;
  skill_type: string;
  description: string;
  cost: string;
  sort_order: number;
  created_by: string;
};

type PetSettings = {
  character_id: string;
  max_pets: number;
};

type TapStatus = {
  enabled: boolean;
  used: number;
  limit: number;
  reset_at: string;
  relationship_points: number;
  relationship_max: number;
};

type CreateDraft = {
  name: string;
  title: string;
  petType: string;
  customType: string;
  species: string;
  description: string;
  formName: string;
};

type DmDraft = {
  name: string;
  title: string;
  petType: string;
  species: string;
  description: string;
  level: number;
  rank: string;
  element: string;
  currentHp: number;
  maxHp: number;
  currentMp: number;
  maxMp: number;
  relationshipMax: number;
  tapEnabled: boolean;
  tapLimit: number;
  tapWindowSeconds: number;
  tapMinPoints: number;
  tapMaxPoints: number;
  tapDailyCap: number;
  stats: Record<string, number>;
};

type HeartParticle = {
  id: string;
  x: number;
  y: number;
  offset: number;
  value: number;
};

type HeartOrigin = {
  x: number;
  y: number;
};

const STAT_KEYS = ["STR", "VIT", "AGI", "INT", "DEX", "WIS", "CHA"];

const PET_TYPES = [
  "สัตว์บก",
  "สัตว์ปีก",
  "สัตว์น้ำ",
  "สัตว์เลื้อยคลาน",
  "แมลง",
  "อสูร",
  "มังกร",
  "วิญญาณ",
  "อันเดด",
  "สิ่งมีชีวิตเวทมนตร์",
  "จักรกล",
  "ประเภทพิเศษ",
  "กำหนดเอง",
];

const EMPTY_CREATE: CreateDraft = {
  name: "",
  title: "",
  petType: "สัตว์บก",
  customType: "",
  species: "",
  description: "",
  formName: "",
};

const STATUS_LABELS: Record<PetStatus, string> = {
  pending: "รอ DM ตรวจสอบ",
  revision: "ต้องแก้ไขคำขอ",
  approved: "อนุมัติแล้ว",
  rejected: "ถูกปฏิเสธ",
  suspended: "ถูกระงับ",
  released: "ถูกปล่อยแล้ว",
};

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "เกิดข้อผิดพลาด");
  }
  return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

function emitSound(kind: "success" | "warning" | "open" | "click") {
  window.dispatchEvent(
    new CustomEvent("karos-ui-sound", {
      detail: { kind },
    })
  );
}

function petTypeValue(draft: CreateDraft) {
  return draft.petType === "กำหนดเอง"
    ? draft.customType.trim()
    : draft.petType;
}

function formatRemaining(milliseconds: number) {
  if (milliseconds <= 0) return "พร้อมแล้ว";
  const seconds = Math.ceil(milliseconds / 1000);
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}

function buildDmDraft(pet: Pet): DmDraft {
  return {
    name: pet.name,
    title: pet.title ?? "",
    petType: pet.pet_type ?? "สัตว์บก",
    species: pet.species ?? "",
    description: pet.description ?? "",
    level: numberValue(pet.level, 1),
    rank: pet.rank ?? "F",
    element: pet.element ?? "",
    currentHp: numberValue(pet.current_hp, 20),
    maxHp: numberValue(pet.max_hp, 20),
    currentMp: numberValue(pet.current_mp, 10),
    maxMp: numberValue(pet.max_mp, 10),
    relationshipMax: numberValue(pet.relationship_max, 1000),
    tapEnabled: Boolean(pet.tap_enabled),
    tapLimit: numberValue(pet.tap_limit, 10),
    tapWindowSeconds: numberValue(pet.tap_window_seconds, 300),
    tapMinPoints: numberValue(pet.tap_min_points, 1),
    tapMaxPoints: numberValue(pet.tap_max_points, 5),
    tapDailyCap: numberValue(pet.tap_daily_cap, 0),
    stats: Object.fromEntries(
      STAT_KEYS.map((key) => [key, numberValue(pet.stats?.[key], 0)])
    ),
  };
}

export default function PetSystem({
  character,
  viewerId,
  isDm,
  onMessage,
}: {
  character: CharacterSummary;
  viewerId: string;
  isDm: boolean;
  onMessage: (message: string) => void;
}) {
  const isOwner = character.owner_id === viewerId;
  const [settings, setSettings] = useState<PetSettings>({
    character_id: character.id,
    max_pets: 0,
  });
  const [pets, setPets] = useState<Pet[]>([]);
  const [forms, setForms] = useState<PetForm[]>([]);
  const [skills, setSkills] = useState<PetSkill[]>([]);
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});
  const [selectedPetId, setSelectedPetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [createImage, setCreateImage] = useState<File | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [requestDraft, setRequestDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [dmDraft, setDmDraft] = useState<DmDraft | null>(null);
  const [petLimitDraft, setPetLimitDraft] = useState(1);
  const [relationshipAmount, setRelationshipAmount] = useState(10);
  const [relationshipReason, setRelationshipReason] = useState("");
  const [tapStatus, setTapStatus] = useState<TapStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const [skillDrafts, setSkillDrafts] = useState<Record<string, PetSkill>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const requestDraftDirtyRef = useRef(false);
  const dmDraftDirtyRef = useRef(false);
  const reviewNoteDirtyRef = useRef(false);
  const petLimitDirtyRef = useRef(false);
  const dirtySkillIdsRef = useRef<Set<string>>(new Set());
  const draftPetIdRef = useRef("");

  const load = useCallback(async () => {
    if (!character.id) return;
    const supabase = getSupabase();

    const [settingsResult, petsResult] = await Promise.all([
      supabase
        .from("character_pet_settings")
        .select("character_id,max_pets")
        .eq("character_id", character.id)
        .maybeSingle(),
      supabase
        .from("pets")
        .select("*")
        .eq("character_id", character.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);

    if (settingsResult.error) {
      onMessage(settingsResult.error.message);
    }
    if (petsResult.error) {
      onMessage(petsResult.error.message);
      setLoading(false);
      return;
    }

    const nextSettings: PetSettings = settingsResult.data ?? {
      character_id: character.id,
      max_pets: 0,
    };
    const nextPets = (petsResult.data ?? []) as Pet[];
    const petIds = nextPets.map((pet) => pet.id);

    let nextForms: PetForm[] = [];
    let nextSkills: PetSkill[] = [];

    if (petIds.length) {
      const [formsResult, skillsResult] = await Promise.all([
        supabase
          .from("pet_forms")
          .select("*")
          .in("pet_id", petIds)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("pet_skills")
          .select("*")
          .in("pet_id", petIds)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);

      if (formsResult.error) onMessage(formsResult.error.message);
      if (skillsResult.error) onMessage(skillsResult.error.message);
      nextForms = (formsResult.data ?? []) as PetForm[];
      nextSkills = (skillsResult.data ?? []) as PetSkill[];
    }

    const imagePaths = [
      ...new Set(nextForms.map((form) => form.image_path).filter(Boolean)),
    ];
    const imageEntries = await Promise.all(
      imagePaths.map(async (path) => {
        const { data } = await supabase.storage
          .from("pet-images")
          .createSignedUrl(path, 3600);
        return [path, data?.signedUrl ?? ""] as const;
      })
    );

    setSettings(nextSettings);
    if (!petLimitDirtyRef.current) {
      setPetLimitDraft(nextSettings.max_pets);
    }
    setPets(nextPets);
    setForms(nextForms);
    setSkills(nextSkills);
    dirtySkillIdsRef.current = new Set(
      [...dirtySkillIdsRef.current].filter((skillId) =>
        nextSkills.some((skill) => skill.id === skillId)
      )
    );
    setSkillDrafts((current) =>
      Object.fromEntries(
        nextSkills.map((skill) => [
          skill.id,
          dirtySkillIdsRef.current.has(skill.id)
            ? current[skill.id] ?? skill
            : skill,
        ])
      )
    );
    setSignedImages(
      Object.fromEntries(imageEntries.filter(([, url]) => Boolean(url)))
    );
    setSelectedPetId((current) => {
      if (current && nextPets.some((pet) => pet.id === current)) return current;
      return nextPets.find((pet) => pet.is_active)?.id ?? nextPets[0]?.id ?? "";
    });
    setLoading(false);
  }, [character.id, onMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!character.id) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`pets-${character.id}-${viewerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pets",
          filter: `character_id=eq.${character.id}`,
        },
        () => void load()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "character_pet_settings",
          filter: `character_id=eq.${character.id}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [character.id, load, viewerId]);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? null,
    [pets, selectedPetId]
  );

  const selectedForm = useMemo(() => {
    if (!selectedPet) return null;
    return (
      forms.find((form) => form.id === selectedPet.current_form_id) ??
      forms.find((form) => form.pet_id === selectedPet.id && form.is_starting) ??
      null
    );
  }, [forms, selectedPet]);

  const selectedSkills = useMemo(
    () => skills.filter((skill) => skill.pet_id === selectedPetId),
    [selectedPetId, skills]
  );

  const occupiedPetSlots = useMemo(
    () =>
    pets.filter(
      (pet) => pet.status !== "rejected" && pet.status !== "released"
    ).length,
  [pets]
);

  const canCreate = isOwner && occupiedPetSlots < settings.max_pets;
  const canTap =
    isOwner && selectedPet?.status === "approved" && Boolean(selectedPet.tap_enabled);

  useEffect(() => {
    if (!selectedPet) {
      draftPetIdRef.current = "";
      requestDraftDirtyRef.current = false;
      dmDraftDirtyRef.current = false;
      reviewNoteDirtyRef.current = false;
      dirtySkillIdsRef.current.clear();
      setDmDraft(null);
      setTapStatus(null);
      return;
    }

    const petChanged = draftPetIdRef.current !== selectedPet.id;
    if (petChanged) {
      draftPetIdRef.current = selectedPet.id;
      requestDraftDirtyRef.current = false;
      dmDraftDirtyRef.current = false;
      reviewNoteDirtyRef.current = false;
      dirtySkillIdsRef.current.clear();
    }

    if (petChanged || !dmDraftDirtyRef.current) {
      setDmDraft(buildDmDraft(selectedPet));
    }

    if (petChanged || !requestDraftDirtyRef.current) {
      setRequestDraft({
        name: selectedPet.name,
        title: selectedPet.title ?? "",
        petType: PET_TYPES.includes(selectedPet.pet_type)
          ? selectedPet.pet_type
          : "กำหนดเอง",
        customType: PET_TYPES.includes(selectedPet.pet_type)
          ? ""
          : selectedPet.pet_type,
        species: selectedPet.species ?? "",
        description: selectedPet.description ?? "",
        formName:
          forms.find(
            (form) => form.pet_id === selectedPet.id && form.is_starting
          )?.name ?? "",
      });
    }

    if (petChanged || !reviewNoteDirtyRef.current) {
      setReviewNote(selectedPet.approval_note ?? "");
    }
  }, [forms, selectedPet]);

  const loadTapStatus = useCallback(async () => {
    if (!selectedPetId) return;
    const { data, error } = await getSupabase().rpc("get_pet_tap_status", {
      target_pet: selectedPetId,
    });
    if (error) {
      onMessage(error.message);
      return;
    }
    setTapStatus(data as TapStatus);
  }, [onMessage, selectedPetId]);

  useEffect(() => {
    void loadTapStatus();
  }, [loadTapStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const resetMilliseconds = tapStatus?.reset_at
    ? new Date(tapStatus.reset_at).getTime() - now
    : 0;
  const tapsRemaining = Math.max(
    0,
    (tapStatus?.limit ?? selectedPet?.tap_limit ?? 0) - (tapStatus?.used ?? 0)
  );

  function selectPet(petId: string) {
    setSelectedPetId(petId);
    emitSound("open");
  }

  function patchRequestDraft(patch: Partial<CreateDraft>) {
    requestDraftDirtyRef.current = true;
    setRequestDraft((current) => ({ ...current, ...patch }));
  }

  function patchDmDraft(patch: Partial<DmDraft>) {
    dmDraftDirtyRef.current = true;
    setDmDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function changeReviewNote(value: string) {
    reviewNoteDirtyRef.current = true;
    setReviewNote(value);
  }

  function changePetLimitDraft(value: number) {
    petLimitDirtyRef.current = true;
    setPetLimitDraft(value);
  }

  function validateImage(file: File) {
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      return "รองรับเฉพาะภาพ JPEG, PNG, WebP และ GIF";
    }
    if (file.size > 10 * 1024 * 1024) {
      return "รูปสัตว์เลี้ยงต้องมีขนาดไม่เกิน 10 MB";
    }
    return "";
  }

  function chooseCreateImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setCreateImage(null);
      return;
    }
    const validation = validateImage(file);
    if (validation) {
      onMessage(validation);
      event.target.value = "";
      return;
    }
    setCreateImage(file);
  }

  async function submitPetRequest() {
    if (!canCreate || !createImage || busy) return;
    const name = createDraft.name.trim();
    const type = petTypeValue(createDraft);
    if (!name) return onMessage("กรุณาตั้งชื่อสัตว์เลี้ยง");
    if (!type) return onMessage("กรุณาระบุประเภทสัตว์เลี้ยง");

    const petId = crypto.randomUUID();
    const formId = crypto.randomUUID();
    const extension =
      createImage.type === "image/jpeg"
        ? "jpg"
        : createImage.type.split("/")[1] || "png";
    const imagePath = `${viewerId}/${petId}/${formId}.${extension}`;
    const supabase = getSupabase();

    setBusy(true);
    onMessage("");
    try {
      const { error: uploadError } = await supabase.storage
        .from("pet-images")
        .upload(imagePath, createImage, {
          cacheControl: "3600",
          contentType: createImage.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc("create_pet_request", {
        requested_pet_id: petId,
        requested_form_id: formId,
        target_character: character.id,
        pet_name: name,
        pet_title: createDraft.title.trim(),
        requested_pet_type: type,
        requested_species: createDraft.species.trim(),
        pet_description: createDraft.description.trim(),
        starting_form_name: createDraft.formName.trim(),
        starting_image_path: imagePath,
      });

      if (error) {
        await supabase.storage.from("pet-images").remove([imagePath]);
        throw error;
      }

      emitSound("success");
      onMessage("ส่งคำขอสัตว์เลี้ยงให้ DM ตรวจสอบแล้ว");
      setCreateOpen(false);
      setCreateDraft(EMPTY_CREATE);
      setCreateImage(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      await load();
      setSelectedPetId(petId);
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function savePetRequestRevision() {
    if (!selectedPet || !isOwner || !["pending", "revision"].includes(selectedPet.status) || busy) return;
    const type = petTypeValue(requestDraft);
    if (!requestDraft.name.trim()) return onMessage("กรุณาตั้งชื่อสัตว์เลี้ยง");
    if (!type) return onMessage("กรุณาระบุประเภทสัตว์เลี้ยง");

    setBusy(true);
    onMessage("");
    try {
      const { error } = await getSupabase().rpc("update_pet_request", {
        target_pet: selectedPet.id,
        pet_name: requestDraft.name.trim(),
        pet_title: requestDraft.title.trim(),
        requested_pet_type: type,
        requested_species: requestDraft.species.trim(),
        pet_description: requestDraft.description.trim(),
        starting_form_name: requestDraft.formName.trim(),
      });
      if (error) throw error;
      emitSound("success");
      onMessage("บันทึกและส่งคำขอให้ DM ตรวจสอบอีกครั้งแล้ว");
      requestDraftDirtyRef.current = false;
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolveRequest(nextStatus: "approved" | "revision" | "rejected" | "suspended") {
    if (!selectedPet || !isDm || busy) return;
    setBusy(true);
    onMessage("");
    try {
      const { error } = await getSupabase().rpc("resolve_pet_request", {
        target_pet: selectedPet.id,
        next_status: nextStatus,
        review_note: reviewNote.trim(),
      });
      if (error) throw error;
      emitSound(nextStatus === "approved" ? "success" : "warning");
      onMessage(`อัปเดตคำขอเป็น “${STATUS_LABELS[nextStatus]}” แล้ว`);
      reviewNoteDirtyRef.current = false;
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function activatePet() {
    if (!selectedPet || selectedPet.status !== "approved" || busy) return;
    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("set_active_pet", {
        target_pet: selectedPet.id,
      });
      if (error) throw error;
      emitSound("success");
      onMessage(`เรียกใช้งาน ${selectedPet.name} แล้ว`);
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function spawnHearts(origin: HeartOrigin, gained: number) {
    const next = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      x: origin.x,
      y: origin.y,
      offset: (index - 2) * 24 + Math.round(Math.random() * 12 - 6),
      value: index === 2 ? gained : 0,
    }));

    setHearts((current) => [...current, ...next]);

    window.setTimeout(() => {
      setHearts((current) =>
        current.filter(
          (heart) => !next.some((item) => item.id === heart.id)
        )
      );
    }, 1250);
  }

  async function tapPet(event: MouseEvent<HTMLButtonElement>) {
    if (!selectedPet || !canTap || busy) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const clientX =
      event.clientX > 0 ? event.clientX : rect.left + rect.width / 2;
    const clientY =
      event.clientY > 0 ? event.clientY : rect.top + rect.height / 2;

    const heartOrigin: HeartOrigin = {
      x: clamp(clientX - rect.left, 30, Math.max(30, rect.width - 30)),
      y: clamp(clientY - rect.top, 40, Math.max(40, rect.height - 30)),
    };

    const resetRemaining = tapStatus?.reset_at
      ? new Date(tapStatus.reset_at).getTime() - Date.now()
      : 0;
    const used = tapStatus?.used ?? 0;
    const limit = tapStatus?.limit ?? selectedPet.tap_limit;

    if (
      selectedPet.relationship_points >= selectedPet.relationship_max
    ) {
      onMessage("ค่าความสัมพันธ์เต็มแล้ว");
      return;
    }

    if (used >= limit && resetRemaining > 0) {
      onMessage(
        `สัตว์เลี้ยงต้องการพักผ่อน กรุณารออีก ${formatRemaining(
          resetRemaining
        )}`
      );
      return;
    }

    setBusy(true);
    onMessage("");

    try {
      const { data, error } = await getSupabase().rpc(
        "tap_pet_relationship",
        {
          target_pet: selectedPet.id,
        }
      );

      if (error) throw error;

      const result = data as TapStatus & { gained: number };
      spawnHearts(heartOrigin, result.gained);
      emitSound("success");
      setTapStatus(result);
      setPets((current) =>
        current.map((pet) =>
          pet.id === selectedPet.id
            ? {
                ...pet,
                relationship_points: result.relationship_points,
              }
            : pet
        )
      );
      onMessage(`ความสัมพันธ์ +${result.gained}`);
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
      await loadTapStatus();
    } finally {
      setBusy(false);
    }
  }

  async function savePetLimit() {
    if (!isDm || busy) return;
    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("set_character_pet_limit", {
        target_character: character.id,
        maximum_pets: Math.trunc(petLimitDraft),
      });
      if (error) throw error;
      emitSound("success");
      onMessage("บันทึกจำนวนสัตว์เลี้ยงสูงสุดแล้ว");
      petLimitDirtyRef.current = false;
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveDmProfile() {
    if (!isDm || !selectedPet || !dmDraft || busy) return;
    setBusy(true);
    onMessage("");
    try {
      const supabase = getSupabase();
      const { error: profileError } = await supabase.rpc("update_pet_profile_dm", {
        target_pet: selectedPet.id,
        profile_patch: {
          name: dmDraft.name.trim(),
          title: dmDraft.title.trim(),
          pet_type: dmDraft.petType.trim(),
          species: dmDraft.species.trim(),
          description: dmDraft.description.trim(),
          level: Math.trunc(dmDraft.level),
          rank: dmDraft.rank.trim(),
          element: dmDraft.element.trim(),
          current_hp: Math.trunc(dmDraft.currentHp),
          max_hp: Math.trunc(dmDraft.maxHp),
          current_mp: Math.trunc(dmDraft.currentMp),
          max_mp: Math.trunc(dmDraft.maxMp),
          relationship_max: Math.trunc(dmDraft.relationshipMax),
          stats: Object.fromEntries(
            STAT_KEYS.map((key) => [key, Math.max(0, Math.trunc(dmDraft.stats[key] ?? 0))])
          ),
        },
      });
      if (profileError) throw profileError;

      const { error: relationshipError } = await supabase.rpc(
        "configure_pet_relationship",
        {
          target_pet: selectedPet.id,
          enabled: dmDraft.tapEnabled,
          maximum_taps: Math.trunc(dmDraft.tapLimit),
          window_seconds: Math.trunc(dmDraft.tapWindowSeconds),
          minimum_points: Math.trunc(dmDraft.tapMinPoints),
          maximum_points: Math.trunc(dmDraft.tapMaxPoints),
          daily_cap: Math.trunc(dmDraft.tapDailyCap),
        }
      );
      if (relationshipError) throw relationshipError;

      emitSound("success");
      onMessage("บันทึกข้อมูลและกติกาสัตว์เลี้ยงแล้ว");
      dmDraftDirtyRef.current = false;
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function adjustRelationship() {
    if (!isDm || !selectedPet || busy) return;
    const amount = Math.trunc(relationshipAmount);
    if (!amount) return onMessage("กรุณาใส่จำนวนแต้มที่ต้องการเพิ่มหรือลด");
    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("adjust_pet_relationship", {
        target_pet: selectedPet.id,
        delta_amount: amount,
        reason: relationshipReason.trim(),
      });
      if (error) throw error;
      emitSound("success");
      onMessage(`ปรับค่าความสัมพันธ์ ${amount > 0 ? "+" : ""}${amount} แล้ว`);
      setRelationshipReason("");
      await load();
      await loadTapStatus();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addSkill() {
    if (!isDm || !selectedPet || busy) return;
    setBusy(true);
    try {
      const newSkill: PetSkill = {
        id: crypto.randomUUID(),
        pet_id: selectedPet.id,
        form_id: null,
        name: "สกิลใหม่",
        skill_type: "ทั่วไป",
        description: "",
        cost: "",
        sort_order: selectedSkills.length,
        created_by: viewerId,
      };
      const { error } = await getSupabase().from("pet_skills").insert(newSkill);
      if (error) throw error;
      emitSound("success");
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function patchSkill(skillId: string, patch: Partial<PetSkill>) {
    dirtySkillIdsRef.current.add(skillId);
    setSkillDrafts((current) => ({
      ...current,
      [skillId]: { ...current[skillId], ...patch },
    }));
  }

  async function saveSkill(skillId: string) {
    if (!isDm || busy) return;
    const skill = skillDrafts[skillId];
    if (!skill?.name.trim()) return onMessage("กรุณาใส่ชื่อสกิล");
    setBusy(true);
    try {
      const { error } = await getSupabase()
        .from("pet_skills")
        .update({
          name: skill.name.trim(),
          skill_type: skill.skill_type.trim() || "ทั่วไป",
          description: skill.description.trim(),
          cost: skill.cost.trim(),
          sort_order: Math.trunc(skill.sort_order),
        })
        .eq("id", skillId);
      if (error) throw error;
      emitSound("success");
      onMessage("บันทึกสกิลสัตว์เลี้ยงแล้ว");
      dirtySkillIdsRef.current.delete(skillId);
      await load();
    } catch (error) {
      emitSound("warning");
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSkill(skillId: string) {
    if (!isDm || busy) return;
    if (!window.confirm("ลบสกิลสัตว์เลี้ยงนี้ถาวรหรือไม่?")) return;
    setBusy(true);
    try {
      const { error } = await getSupabase().from("pet_skills").delete().eq("id", skillId);
      if (error) throw error;
      emitSound("warning");
      dirtySkillIdsRef.current.delete(skillId);
      await load();
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className={styles.petPanel}>
        <div className={styles.loadingRune}>✦</div>
        <p>กำลังเรียกทะเบียนสัตว์เลี้ยง…</p>
      </section>
    );
  }

  const relationshipPoints = selectedPet?.relationship_points ?? 0;
  const relationshipMax = Math.max(1, selectedPet?.relationship_max ?? 1);
  const relationshipPercent = clamp(
    (relationshipPoints / relationshipMax) * 100,
    0,
    100
  );
  const relationshipFull = relationshipPoints >= relationshipMax;
  const tapWindowReady = resetMilliseconds <= 0;
  const canTapNow =
    canTap &&
    !relationshipFull &&
    (tapsRemaining > 0 || tapWindowReady);
  const imageUrl = selectedForm?.image_path
    ? signedImages[selectedForm.image_path]
    : "";

  return (
    <section className={styles.petPanel}>
      <header className={styles.petHeader}>
        <div>
          <p className={styles.eyebrow}>FAMILIAR ARCHIVE</p>
          <h2>ระบบสัตว์เลี้ยง</h2>
          <p>
            ส่งคำขอ รับการอนุมัติ สร้างความสัมพันธ์ และเลือกคู่หูที่ออกเดินทางพร้อมตัวละคร
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.capacitySeal}>
            {occupiedPetSlots}/{settings.max_pets} ตัว
          </span>
          {isOwner ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!canCreate || busy}
              onClick={() => setCreateOpen(true)}
            >
              ＋ ส่งคำขอสัตว์เลี้ยง
            </button>
          ) : null}
        </div>
      </header>

      {isDm ? (
        <section className={styles.limitBar}>
          <div>
            <strong>DM · จำนวนสัตว์เลี้ยงสูงสุด</strong>
            <span>กำหนดแยกสำหรับตัวละคร {character.name}</span>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            value={petLimitDraft}
            onChange={(event) => changePetLimitDraft(Number(event.target.value))}
          />
          <button type="button" disabled={busy} onClick={savePetLimit}>
            บันทึกจำนวน
          </button>
        </section>
      ) : null}

      <div className={styles.petShell}>
        <aside className={styles.petListPane}>
          <div className={styles.paneTitle}>
            <div>
              <small>COMPANIONS</small>
              <strong>รายชื่อสัตว์เลี้ยง</strong>
            </div>
            <span>{pets.length}</span>
          </div>

          <div className={styles.petList}>
            {pets.length ? (
              pets.map((pet) => {
                const form =
                  forms.find((item) => item.id === pet.current_form_id) ??
                  forms.find((item) => item.pet_id === pet.id && item.is_starting);
                const url = form?.image_path ? signedImages[form.image_path] : "";
                return (
                  <button
                    type="button"
                    key={pet.id}
                    className={`${styles.petListCard} ${
                      selectedPetId === pet.id ? styles.selected : ""
                    }`}
                    onClick={() => selectPet(pet.id)}
                  >
                    <span className={styles.petThumb}>
                      {url ? <img src={url} alt="" /> : "♞"}
                    </span>
                    <span className={styles.petListText}>
                      <small>{pet.is_active ? "ACTIVE PET" : STATUS_LABELS[pet.status]}</small>
                      <strong>{pet.name}</strong>
                      <em>{form?.name || pet.pet_type}</em>
                    </span>
                    {pet.is_active ? <b>ใช้งาน</b> : null}
                  </button>
                );
              })
            ) : (
              <div className={styles.emptyPets}>
                <span>♞</span>
                <strong>ยังไม่มีสัตว์เลี้ยง</strong>
                <p>เจ้าของตัวละครสามารถสร้างคำขอแรกได้เมื่อ DM กำหนดจำนวนให้แล้ว</p>
              </div>
            )}
          </div>
        </aside>

        <div className={styles.petDetailPane}>
          {selectedPet ? (
            <>
              <div className={styles.petHeroGrid}>
                <button
                  type="button"
                  className={`${styles.petPortrait} ${
                    canTapNow ? styles.tappable : ""
                  }`}
                  onClick={tapPet}
                  disabled={!canTapNow || busy}
                  aria-label={
                    canTapNow
                      ? `แตะ ${selectedPet.name} เพื่อเพิ่มค่าความสัมพันธ์`
                      : `รูปสัตว์เลี้ยง ${selectedPet.name}`
                  }
                >
                  {imageUrl ? (
                    <img src={imageUrl} alt={selectedPet.name} />
                  ) : (
                    <span className={styles.petPortraitEmpty}>♞</span>
                  )}
                  <i className={styles.portraitShade} />
                  <div className={styles.petIdentity}>
                    <small>{selectedForm?.name || "ร่างเริ่มต้น"}</small>
                    <h3>{selectedPet.name}</h3>
                    <p>{selectedPet.title || selectedPet.species || selectedPet.pet_type}</p>
                  </div>
                  {canTapNow ? (
                    <span className={styles.tapHint}>แตะรูปเพื่อสร้างความสัมพันธ์</span>
                  ) : null}
                  {hearts.map((heart) => (
                    <span
                      className={styles.heartParticle}
                      key={heart.id}
                      style={
                        {
                          left: heart.x,
                          top: heart.y,
                          "--heart-offset": `${heart.offset}px`,
                        } as React.CSSProperties
                      }
                    >
                      ♥{heart.value ? <b>+{heart.value}</b> : null}
                    </span>
                  ))}
                </button>

                <div className={styles.petSummary}>
                  <div className={styles.summaryTopline}>
                    <span className={`${styles.statusBadge} ${styles[`status_${selectedPet.status}`]}`}>
                      {STATUS_LABELS[selectedPet.status]}
                    </span>
                    {selectedPet.is_active ? <b>คู่หูที่กำลังใช้งาน</b> : null}
                  </div>

                  <div className={styles.infoGrid}>
                    <Info label="ประเภท" value={selectedPet.pet_type} />
                    <Info label="สายพันธุ์" value={selectedPet.species || "—"} />
                    <Info label="ระดับ" value={`LV.${selectedPet.level}`} />
                    <Info label="แรงค์" value={selectedPet.rank} />
                    <Info label="ธาตุ" value={selectedPet.element || "—"} />
                    <Info label="ร่างปัจจุบัน" value={selectedForm?.name || "ร่างเริ่มต้น"} />
                  </div>

                  <div className={styles.relationshipCard}>
                    <div className={styles.relationshipHeading}>
                      <div>
                        <small>RELATIONSHIP</small>
                        <strong>ค่าความสัมพันธ์</strong>
                      </div>
                      <b>{relationshipPoints.toLocaleString("th-TH")} / {relationshipMax.toLocaleString("th-TH")}</b>
                    </div>
                    <div className={styles.relationshipTrack}>
                      <i style={{ width: `${relationshipPercent}%` }} />
                    </div>
                    <div className={styles.tapStatusLine}>
                      {relationshipFull ? (
                        <>
                          <span>ค่าความสัมพันธ์เต็มแล้ว</span>
                          <span>รอเส้นทางวิวัฒนาการ</span>
                        </>
                      ) : tapsRemaining > 0 ? (
                        <>
                          <span>แตะได้อีก {tapsRemaining} ครั้ง</span>
                          <span>
                            สุ่ม +{selectedPet.tap_min_points} ถึง +
                            {selectedPet.tap_max_points}
                          </span>
                        </>
                      ) : resetMilliseconds > 0 ? (
                        <>
                          <span>สัตว์เลี้ยงกำลังพักผ่อน</span>
                          <span>พร้อมอีกครั้งใน {formatRemaining(resetMilliseconds)}</span>
                        </>
                      ) : (
                        <>
                          <span>พร้อมสร้างความสัมพันธ์อีกครั้ง</span>
                          <span>แตะรูปเพื่อเริ่มรอบใหม่</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={styles.petActions}>
                    {selectedPet.status === "approved" && !selectedPet.is_active ? (
                      <button type="button" disabled={busy} onClick={activatePet}>
                        เรียกใช้งานสัตว์เลี้ยงตัวนี้
                      </button>
                    ) : null}
                    {selectedPet.status === "approved" && selectedPet.is_active ? (
                      <span className={styles.activeNotice}>สัตว์เลี้ยงตัวนี้กำลังเดินทางไปกับผู้เล่น</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {selectedPet.approval_note ? (
                <p className={styles.reviewMessage}>
                  <strong>ข้อความจาก DM:</strong> {selectedPet.approval_note}
                </p>
              ) : null}

              {isOwner && (selectedPet.status === "pending" || selectedPet.status === "revision") ? (
                <section className={styles.requestEditor}>
                  <div className={styles.sectionTitle}>
                    <div>
                      <small>PLAYER REQUEST</small>
                      <h3>แก้ไขคำขอก่อน DM อนุมัติ</h3>
                    </div>
                  </div>
                  <div className={styles.dmGrid}>
                    <Field label="ชื่อสัตว์เลี้ยง">
                      <input value={requestDraft.name} onChange={(event) => patchRequestDraft({ name: event.target.value })} />
                    </Field>
                    <Field label="ฉายา">
                      <input value={requestDraft.title} onChange={(event) => patchRequestDraft({ title: event.target.value })} />
                    </Field>
                    <Field label="ประเภท">
                      <select value={requestDraft.petType} onChange={(event) => patchRequestDraft({ petType: event.target.value })}>
                        {PET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </Field>
                    {requestDraft.petType === "กำหนดเอง" ? (
                      <Field label="ประเภทที่กำหนดเอง">
                        <input value={requestDraft.customType} onChange={(event) => patchRequestDraft({ customType: event.target.value })} />
                      </Field>
                    ) : null}
                    <Field label="สายพันธุ์">
                      <input value={requestDraft.species} onChange={(event) => patchRequestDraft({ species: event.target.value })} />
                    </Field>
                    <Field label="ชื่อร่างเริ่มต้น">
                      <input value={requestDraft.formName} onChange={(event) => patchRequestDraft({ formName: event.target.value })} />
                    </Field>
                  </div>
                  <Field label="คำอธิบาย บุคลิก หรือประวัติ">
                    <textarea value={requestDraft.description} onChange={(event) => patchRequestDraft({ description: event.target.value })} />
                  </Field>
                  <p className={styles.requestImageNote}>รูปเริ่มต้นยังคงเป็นรูปเดิม ผู้เล่นอัปโหลดได้หนึ่งรูปต่อคำขอ</p>
                  <button type="button" className={styles.primaryButton} disabled={busy} onClick={savePetRequestRevision}>
                    บันทึกและส่งให้ DM ตรวจอีกครั้ง
                  </button>
                </section>
              ) : null}

              <section className={styles.profileSection}>
                <div className={styles.sectionTitle}>
                  <div>
                    <small>PROFILE & STATUS</small>
                    <h3>ข้อมูลและค่าสถานะ</h3>
                  </div>
                </div>

                <p className={styles.petDescription}>
                  {selectedPet.description || "ยังไม่มีคำอธิบายสัตว์เลี้ยง"}
                </p>

                <div className={styles.resourceGrid}>
                  <Resource
                    label="HP"
                    current={selectedPet.current_hp}
                    maximum={selectedPet.max_hp}
                    kind="hp"
                  />
                  <Resource
                    label="MP"
                    current={selectedPet.current_mp}
                    maximum={selectedPet.max_mp}
                    kind="mp"
                  />
                </div>

                <div className={styles.statsGrid}>
                  {STAT_KEYS.map((key) => {
                    const value = numberValue(selectedPet.stats?.[key], 0);
                    return (
                      <div className={styles.statLine} key={key}>
                        <strong>{key}</strong>
                        <span><i style={{ width: `${clamp(value, 0, 100)}%` }} /></span>
                        <b>{value}</b>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.skillsSection}>
                <div className={styles.sectionTitle}>
                  <div>
                    <small>ABILITIES</small>
                    <h3>สกิลและความสามารถ</h3>
                  </div>
                  {isDm ? (
                    <button type="button" disabled={busy} onClick={addSkill}>
                      ＋ เพิ่มสกิล
                    </button>
                  ) : null}
                </div>

                <div className={styles.skillGrid}>
                  {selectedSkills.length ? (
                    selectedSkills.map((skill) => {
                      const draft = skillDrafts[skill.id] ?? skill;
                      return isDm ? (
                        <article className={styles.skillEditor} key={skill.id}>
                          <input
                            value={draft.name}
                            onChange={(event) => patchSkill(skill.id, { name: event.target.value })}
                          />
                          <input
                            value={draft.skill_type}
                            onChange={(event) => patchSkill(skill.id, { skill_type: event.target.value })}
                            placeholder="ประเภทสกิล"
                          />
                          <textarea
                            value={draft.description}
                            onChange={(event) => patchSkill(skill.id, { description: event.target.value })}
                            placeholder="คำอธิบาย"
                          />
                          <input
                            value={draft.cost}
                            onChange={(event) => patchSkill(skill.id, { cost: event.target.value })}
                            placeholder="MP / คูลดาวน์ / เงื่อนไข"
                          />
                          <div>
                            <button type="button" disabled={busy} onClick={() => saveSkill(skill.id)}>
                              บันทึก
                            </button>
                            <button
                              type="button"
                              className={styles.dangerButton}
                              disabled={busy}
                              onClick={() => deleteSkill(skill.id)}
                            >
                              ลบ
                            </button>
                          </div>
                        </article>
                      ) : (
                        <article className={styles.skillCard} key={skill.id}>
                          <div>
                            <strong>{skill.name}</strong>
                            <span>{skill.skill_type}</span>
                          </div>
                          <p>{skill.description || "ไม่มีคำอธิบาย"}</p>
                          {skill.cost ? <small>{skill.cost}</small> : null}
                        </article>
                      );
                    })
                  ) : (
                    <p className={styles.emptySection}>ยังไม่มีสกิลหรือความสามารถ</p>
                  )}
                </div>
              </section>

              {isDm ? (
                <section className={styles.dmSection}>
                  <div className={styles.sectionTitle}>
                    <div>
                      <small>DM CONTROL</small>
                      <h3>ตรวจคำขอและกำหนดกติกา</h3>
                    </div>
                  </div>

                  {(selectedPet.status === "pending" || selectedPet.status === "revision") ? (
                    <div className={styles.reviewPanel}>
                      <label>
                        <span>ข้อความถึงผู้เล่น</span>
                        <textarea
                          value={reviewNote}
                          onChange={(event) => changeReviewNote(event.target.value)}
                          placeholder="เหตุผลอนุมัติ ขอให้แก้ไข หรือปฏิเสธ"
                        />
                      </label>
                      <div>
                        <button type="button" disabled={busy} onClick={() => resolveRequest("approved")}>
                          อนุมัติสัตว์เลี้ยง
                        </button>
                        <button type="button" disabled={busy} onClick={() => resolveRequest("revision")}>
                          ขอให้แก้ไข
                        </button>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          disabled={busy}
                          onClick={() => resolveRequest("rejected")}
                        >
                          ปฏิเสธ
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedPet.status === "approved" ||
                  selectedPet.status === "suspended" ? (
                    <div className={styles.reviewPanel}>
                      <label>
                        <span>เหตุผลการระงับหรือเปิดใช้งานอีกครั้ง</span>
                        <textarea
                          value={reviewNote}
                          onChange={(event) =>
                            changeReviewNote(event.target.value)
                          }
                          placeholder="ระบุเหตุผลเพื่อให้ผู้เล่นทราบ"
                        />
                      </label>
                      <div>
                        {selectedPet.status === "approved" ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={busy}
                            onClick={() => resolveRequest("suspended")}
                          >
                            ระงับสัตว์เลี้ยง
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => resolveRequest("approved")}
                          >
                            ยกเลิกการระงับและอนุมัติอีกครั้ง
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {dmDraft ? (
                    <div className={styles.dmEditor}>
                      <h4>ข้อมูลหลัก</h4>
                      <div className={styles.dmGrid}>
                        <Field label="ชื่อ">
                          <input value={dmDraft.name} onChange={(event) => patchDmDraft({ name: event.target.value })} />
                        </Field>
                        <Field label="ฉายา">
                          <input value={dmDraft.title} onChange={(event) => patchDmDraft({ title: event.target.value })} />
                        </Field>
                        <Field label="ประเภท">
                          <input value={dmDraft.petType} onChange={(event) => patchDmDraft({ petType: event.target.value })} />
                        </Field>
                        <Field label="สายพันธุ์">
                          <input value={dmDraft.species} onChange={(event) => patchDmDraft({ species: event.target.value })} />
                        </Field>
                        <Field label="เลเวล">
                          <input type="number" min={1} value={dmDraft.level} onChange={(event) => patchDmDraft({ level: Number(event.target.value) })} />
                        </Field>
                        <Field label="แรงค์">
                          <input value={dmDraft.rank} onChange={(event) => patchDmDraft({ rank: event.target.value })} />
                        </Field>
                        <Field label="ธาตุ">
                          <input value={dmDraft.element} onChange={(event) => patchDmDraft({ element: event.target.value })} />
                        </Field>
                      </div>

                      <Field label="คำอธิบาย">
                        <textarea value={dmDraft.description} onChange={(event) => patchDmDraft({ description: event.target.value })} />
                      </Field>

                      <h4>พลังชีวิตและค่าสถานะ</h4>
                      <div className={styles.dmGrid}>
                        <NumberField label="HP ปัจจุบัน" value={dmDraft.currentHp} onChange={(value) => patchDmDraft({ currentHp: value })} />
                        <NumberField label="HP สูงสุด" value={dmDraft.maxHp} minimum={1} onChange={(value) => patchDmDraft({ maxHp: value })} />
                        <NumberField label="MP ปัจจุบัน" value={dmDraft.currentMp} onChange={(value) => patchDmDraft({ currentMp: value })} />
                        <NumberField label="MP สูงสุด" value={dmDraft.maxMp} onChange={(value) => patchDmDraft({ maxMp: value })} />
                        {STAT_KEYS.map((key) => (
                          <NumberField
                            label={key}
                            value={dmDraft.stats[key] ?? 0}
                            key={key}
                            onChange={(value) => patchDmDraft({ stats: { ...dmDraft.stats, [key]: value } })}
                          />
                        ))}
                      </div>

                      <h4>กติกาความสัมพันธ์</h4>
                      <label className={styles.checkLine}>
                        <input
                          type="checkbox"
                          checked={dmDraft.tapEnabled}
                          onChange={(event) => patchDmDraft({ tapEnabled: event.target.checked })}
                        />
                        <span>เปิดกิจกรรมแตะรูปเพื่อรับค่าความสัมพันธ์</span>
                      </label>
                      <div className={styles.dmGrid}>
                        <NumberField label="ค่าความสัมพันธ์สูงสุด" value={dmDraft.relationshipMax} minimum={1} onChange={(value) => patchDmDraft({ relationshipMax: value })} />
                        <NumberField label="จำนวนครั้งต่อรอบ" value={dmDraft.tapLimit} onChange={(value) => patchDmDraft({ tapLimit: value })} />
                        <NumberField label="ระยะเวลารอบ (วินาที)" value={dmDraft.tapWindowSeconds} minimum={10} onChange={(value) => patchDmDraft({ tapWindowSeconds: value })} />
                        <NumberField label="แต้มสุ่มต่ำสุด" value={dmDraft.tapMinPoints} onChange={(value) => patchDmDraft({ tapMinPoints: value })} />
                        <NumberField label="แต้มสุ่มสูงสุด" value={dmDraft.tapMaxPoints} onChange={(value) => patchDmDraft({ tapMaxPoints: value })} />
                        <NumberField label="เพดานแต้มต่อวัน (0 = ไม่จำกัด)" value={dmDraft.tapDailyCap} onChange={(value) => patchDmDraft({ tapDailyCap: value })} />
                      </div>

                      <button type="button" className={styles.saveDmButton} disabled={busy} onClick={saveDmProfile}>
                        บันทึกข้อมูลและกติกาทั้งหมด
                      </button>
                    </div>
                  ) : null}

                  <div className={styles.relationshipAdjuster}>
                    <div>
                      <strong>เพิ่มหรือลดค่าความสัมพันธ์โดย DM</strong>
                      <span>ระบบจะเก็บประวัติผู้แก้ จำนวนแต้ม และเหตุผล</span>
                    </div>
                    <input
                      type="number"
                      value={relationshipAmount}
                      onChange={(event) => setRelationshipAmount(Number(event.target.value))}
                    />
                    <input
                      value={relationshipReason}
                      onChange={(event) => setRelationshipReason(event.target.value)}
                      placeholder="เหตุผล เช่น ช่วยเหลือหมู่บ้าน"
                    />
                    <button type="button" disabled={busy} onClick={adjustRelationship}>
                      ปรับแต้ม
                    </button>
                  </div>
                </section>
              ) : null}

           <PetPhase2
  petId={selectedPet.id}
  petName={selectedPet.name}
  petStatus={selectedPet.status}
  characterId={character.id}
  characterName={character.name}
  isOwner={isOwner}
  isDm={isDm}
  onMessage={onMessage}
  onChanged={load}
/>

<section className={styles.nextPhase}>
  <span>PHASE 3</span>
  <div>
    <strong>เส้นทางวิวัฒนาการ · การย้อนร่าง · คัทซีน</strong>
    <p>
      Phase ถัดไปจะเพิ่มแผนผังวิวัฒนาการหลายเส้นทาง การย้อนร่างโดย DM
      และคัทซีนพร้อมเสียงเอฟเฟกต์
    </p>
  </div>
</section>
            </>
          ) : (
            <div className={styles.noSelection}>
              <span>♞</span>
              <h3>เลือกสัตว์เลี้ยงจากรายการ</h3>
              <p>ข้อมูล ร่าง สกิล และค่าความสัมพันธ์จะแสดงที่นี่</p>
            </div>
          )}
        </div>
      </div>

      {createOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="สร้างคำขอสัตว์เลี้ยง"
          onPointerDown={(event) => {
            if (!busy && event.target === event.currentTarget) setCreateOpen(false);
          }}
        >
          <section className={styles.createModal}>
            <header>
              <div>
                <small>NEW PET REQUEST</small>
                <h3>ส่งคำขอสัตว์เลี้ยง</h3>
                <p>ผู้เล่นอัปโหลดได้หนึ่งรูปสำหรับร่างเริ่มต้น จากนั้น DM จะเป็นผู้ตรวจสอบ</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setCreateOpen(false)} aria-label="ปิด">
                ×
              </button>
            </header>

            <div className={styles.createGrid}>
              <Field label="ชื่อสัตว์เลี้ยง">
                <input value={createDraft.name} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} />
              </Field>
              <Field label="ฉายา">
                <input value={createDraft.title} onChange={(event) => setCreateDraft({ ...createDraft, title: event.target.value })} />
              </Field>
              <Field label="ประเภทสัตว์เลี้ยง">
                <select value={createDraft.petType} onChange={(event) => setCreateDraft({ ...createDraft, petType: event.target.value })}>
                  {PET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              {createDraft.petType === "กำหนดเอง" ? (
                <Field label="ประเภทที่กำหนดเอง">
                  <input value={createDraft.customType} onChange={(event) => setCreateDraft({ ...createDraft, customType: event.target.value })} />
                </Field>
              ) : null}
              <Field label="สายพันธุ์">
                <input value={createDraft.species} onChange={(event) => setCreateDraft({ ...createDraft, species: event.target.value })} />
              </Field>
              <Field label="ชื่อร่างเริ่มต้น">
                <input value={createDraft.formName} onChange={(event) => setCreateDraft({ ...createDraft, formName: event.target.value })} placeholder="เว้นว่างเพื่อใช้ชื่อสัตว์เลี้ยง" />
              </Field>
            </div>

            <Field label="คำอธิบาย บุคลิก หรือประวัติ">
              <textarea rows={5} value={createDraft.description} onChange={(event) => setCreateDraft({ ...createDraft, description: event.target.value })} />
            </Field>

            <label className={styles.imageUploadBox}>
              <span>{createImage ? createImage.name : "เลือกรูปร่างเริ่มต้น 1 รูป"}</span>
              <small>JPEG, PNG, WebP หรือ GIF · สูงสุด 10 MB</small>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={chooseCreateImage} />
            </label>

            <footer>
              <button type="button" disabled={busy} onClick={() => setCreateOpen(false)}>ยกเลิก</button>
              <button type="button" className={styles.primaryButton} disabled={busy || !createImage} onClick={submitPetRequest}>
                {busy ? "กำลังส่งคำขอ…" : "ส่งให้ DM ตรวจสอบ"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Resource({
  label,
  current,
  maximum,
  kind,
}: {
  label: string;
  current: number;
  maximum: number;
  kind: "hp" | "mp";
}) {
  const safeMaximum = Math.max(kind === "hp" ? 1 : 0, maximum);
  const percent = safeMaximum > 0 ? clamp((current / safeMaximum) * 100, 0, 100) : 0;
  return (
    <div className={`${styles.resource} ${styles[kind]}`}>
      <div><strong>{label}</strong><span>{current}/{safeMaximum}</span></div>
      <i><b style={{ width: `${percent}%` }} /></i>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  minimum = 0,
  onChange,
}: {
  label: string;
  value: number;
  minimum?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={minimum}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}
