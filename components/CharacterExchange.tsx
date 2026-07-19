"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { InventoryItem } from "@/components/CharacterInventory";
import styles from "./CharacterExchange.module.css";

type ExchangeCharacter = {
  id: string;
  name: string;
  portrait_url: string | null;
  campaign_id: string | null;
};

type CharacterOption = {
  id: string;
  name: string;
  portrait_url: string | null;
};

type TradeRow = {
  id: string;
  campaign_id: string;
  initiator_character_id: string;
  recipient_character_id: string;
  status: "pending" | "active" | "completed" | "cancelled" | "rejected";
  initiator_ready: boolean;
  recipient_ready: boolean;
  initiator_temma: number;
  recipient_temma: number;
  revision: number;
  updated_at: string;
};

type TradeItemRow = {
  id: string;
  trade_id: string;
  character_id: string;
  inventory_item_id: string | null;
  quantity: number;
  item_name: string;
  item_type: string;
  category: string;
  description: string;
  image_path: string | null;
  allowed_equipment_slot: string | null;
};

type ExchangeNotification = {
  id: string;
  campaign_id: string;
  recipient_character_id: string;
  sender_character_id: string | null;
  trade_id: string | null;
  kind:
    | "trade_invite"
    | "trade_accepted"
    | "trade_rejected"
    | "trade_cancelled"
    | "trade_completed"
    | "forced_item"
    | "money_transfer";
  tone: "gold" | "red" | "green" | "blue" | "rainbow";
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type OverlayMode = "closed" | "direct" | "trade";
type DirectMode = "item" | "money";

type MotionEffect = {
  kind: "item" | "money" | "trade";
  label: string;
  from: string;
  to: string;
};

const TEMMA = new Intl.NumberFormat("th-TH");

export default function CharacterExchange({
  character,
  items,
  temmaBalance,
  canExchange,
  onChanged,
  onMessage,
}: {
  character: ExchangeCharacter;
  items: InventoryItem[];
  temmaBalance: number;
  canExchange: boolean;
  onChanged: () => Promise<void> | void;
  onMessage: (message: string) => void;
}) {
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [activeTrade, setActiveTrade] = useState<TradeRow | null>(null);
  const [tradeItems, setTradeItems] = useState<TradeItemRow[]>([]);
  const [notifications, setNotifications] = useState<ExchangeNotification[]>([]);
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});

  const [overlay, setOverlay] = useState<OverlayMode>("closed");
  const [directMode, setDirectMode] = useState<DirectMode>("item");
  const [recipientId, setRecipientId] = useState("");
  const [directItemId, setDirectItemId] = useState("");
  const [directQuantity, setDirectQuantity] = useState(1);
  const [directTemma, setDirectTemma] = useState(1);

  const [tradeRecipientId, setTradeRecipientId] = useState("");
  const [offerDraft, setOfferDraft] = useState<Record<string, number>>({});
  const [offerTemma, setOfferTemma] = useState(0);
  const [offerDirty, setOfferDirty] = useState(false);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ExchangeNotification | null>(null);
  const [effect, setEffect] = useState<MotionEffect | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const effectTimerRef = useRef<number | null>(null);
  const shownNotificationRef = useRef<string | null>(null);

  const transferableItems = useMemo(
    () =>
      items.filter(
        (item) => !item.equipped && item.equipment_slot === null && item.quantity > 0
      ),
    [items]
  );

  const selectedDirectItem = useMemo(
    () => transferableItems.find((item) => item.id === directItemId) ?? null,
    [directItemId, transferableItems]
  );

  const characterById = useMemo(
    () => new Map(characters.map((entry) => [entry.id, entry])),
    [characters]
  );

  const partnerId = useMemo(() => {
    if (!activeTrade) return "";
    return activeTrade.initiator_character_id === character.id
      ? activeTrade.recipient_character_id
      : activeTrade.initiator_character_id;
  }, [activeTrade, character.id]);

  const partner = characterById.get(partnerId) ?? null;
  const isInitiator = activeTrade?.initiator_character_id === character.id;
  const isRecipient = activeTrade?.recipient_character_id === character.id;

  const ownReady = activeTrade
    ? isInitiator
      ? activeTrade.initiator_ready
      : activeTrade.recipient_ready
    : false;

  const partnerReady = activeTrade
    ? isInitiator
      ? activeTrade.recipient_ready
      : activeTrade.initiator_ready
    : false;

  const ownSavedTemma = activeTrade
    ? Number(isInitiator ? activeTrade.initiator_temma : activeTrade.recipient_temma)
    : 0;

  const partnerTemma = activeTrade
    ? Number(isInitiator ? activeTrade.recipient_temma : activeTrade.initiator_temma)
    : 0;

  const ownTradeItems = useMemo(
    () => tradeItems.filter((item) => item.character_id === character.id),
    [character.id, tradeItems]
  );

  const partnerTradeItems = useMemo(
    () => tradeItems.filter((item) => item.character_id === partnerId),
    [partnerId, tradeItems]
  );

  const loadExchange = useCallback(async () => {
    if (!character.campaign_id) return;
    const supabase = getSupabase();

    const [characterResult, tradeResult, notificationResult] = await Promise.all([
      supabase
        .from("characters")
        .select("id,name,portrait_url")
        .eq("campaign_id", character.campaign_id)
        .neq("id", character.id)
        .order("name"),
      supabase
        .from("character_trades")
        .select("*")
        .or(
          `initiator_character_id.eq.${character.id},recipient_character_id.eq.${character.id}`
        )
        .in("status", ["pending", "active"])
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("character_exchange_notifications")
        .select("*")
        .eq("recipient_character_id", character.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    const firstError =
      characterResult.error || tradeResult.error || notificationResult.error;
    if (firstError) {
      onMessage(firstError.message);
      return;
    }

    const nextCharacters = (characterResult.data ?? []) as CharacterOption[];
    const nextTrade = ((tradeResult.data ?? [])[0] ?? null) as TradeRow | null;
    let nextTradeItems: TradeItemRow[] = [];

    if (nextTrade) {
      const { data, error } = await supabase
        .from("character_trade_items")
        .select("*")
        .eq("trade_id", nextTrade.id)
        .order("created_at");

      if (error) {
        onMessage(error.message);
        return;
      }
      nextTradeItems = (data ?? []) as TradeItemRow[];
    }

    setCharacters(nextCharacters);
    setActiveTrade(nextTrade);
    setTradeItems(nextTradeItems);
    setNotifications((notificationResult.data ?? []) as ExchangeNotification[]);

    setRecipientId((current) =>
      current && nextCharacters.some((entry) => entry.id === current)
        ? current
        : nextCharacters[0]?.id ?? ""
    );
    setTradeRecipientId((current) =>
      current && nextCharacters.some((entry) => entry.id === current)
        ? current
        : nextCharacters[0]?.id ?? ""
    );

    if (nextTrade?.status === "active") {
      const currentOffers = nextTradeItems.filter(
        (item) => item.character_id === character.id
      );
      setOfferDraft(
        Object.fromEntries(
          currentOffers
            .filter((item) => item.inventory_item_id)
            .map((item) => [item.inventory_item_id as string, item.quantity])
        )
      );
      setOfferTemma(
        Number(
          nextTrade.initiator_character_id === character.id
            ? nextTrade.initiator_temma
            : nextTrade.recipient_temma
        )
      );
      setOfferDirty(false);
    } else if (!nextTrade) {
      setOfferDraft({});
      setOfferTemma(0);
      setOfferDirty(false);
    }

    const unread = ((notificationResult.data ?? []) as ExchangeNotification[]).find(
      (entry) => !entry.read_at
    );
    if (unread && shownNotificationRef.current !== unread.id) {
      showNotification(unread);
    }
  }, [character.campaign_id, character.id, onMessage]);

  const loadSignedImages = useCallback(async () => {
    const paths = [
      ...new Set(
        [...items, ...tradeItems]
          .map((item) => item.image_path)
          .filter((path): path is string => Boolean(path))
      ),
    ];

    if (!paths.length) {
      setSignedImages({});
      return;
    }

    const supabase = getSupabase();
    const results = await Promise.all(
      paths.map(async (path) => {
        const { data } = await supabase.storage
          .from("inventory-item-images")
          .createSignedUrl(path, 3600);
        return [path, data?.signedUrl ?? ""] as const;
      })
    );

    setSignedImages(
      Object.fromEntries(results.filter(([, url]) => Boolean(url)))
    );
  }, [items, tradeItems]);

  useEffect(() => {
    if (!canExchange || !character.campaign_id) return;
    loadExchange();
  }, [canExchange, character.campaign_id, loadExchange]);

  useEffect(() => {
    loadSignedImages();
  }, [loadSignedImages]);

  useEffect(() => {
    if (!canExchange || !character.campaign_id) return;
    const supabase = getSupabase();

    const channel = supabase
      .channel(`character-exchange-${character.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "character_trades" },
        () => loadExchange()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "character_trade_items" },
        () => loadExchange()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "character_exchange_notifications",
          filter: `recipient_character_id=eq.${character.id}`,
        },
        (payload) => {
          const notification = payload.new as ExchangeNotification;
          showNotification(notification);
          loadExchange();
          if (
            notification.kind === "forced_item" ||
            notification.kind === "money_transfer" ||
            notification.kind === "trade_completed"
          ) {
            onChanged();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    canExchange,
    character.campaign_id,
    character.id,
    loadExchange,
    onChanged,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
    };
  }, []);

  async function markNotificationRead(id: string) {
    await getSupabase()
      .from("character_exchange_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  function showNotification(notification: ExchangeNotification) {
    shownNotificationRef.current = notification.id;
    setToast(notification);
    markNotificationRead(notification.id);

    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(
      () => setToast(null),
      notification.tone === "red" ? 7600 : 6000
    );
  }

  function playEffect(next: MotionEffect) {
    setEffect(next);
    if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current);
    effectTimerRef.current = window.setTimeout(() => setEffect(null), 2600);
  }

  function openDirect() {
    setOverlay("direct");
    setDirectMode("item");
    setDirectItemId(transferableItems[0]?.id ?? "");
    setDirectQuantity(1);
    setDirectTemma(1);
  }

  function openTrade() {
    setOverlay("trade");
    loadExchange();
  }

  function closeOverlay() {
    if (busy) return;
    setOverlay("closed");
  }

  async function sendDirect() {
    const recipient = characterById.get(recipientId);
    if (!recipient) {
      onMessage("กรุณาเลือกตัวละครผู้รับ");
      return;
    }

    setBusy(true);
    try {
      if (directMode === "item") {
        if (!selectedDirectItem) throw new Error("กรุณาเลือกไอเทม");
        if (
          !Number.isInteger(directQuantity) ||
          directQuantity < 1 ||
          directQuantity > selectedDirectItem.quantity
        ) {
          throw new Error("จำนวนไอเทมที่ส่งไม่ถูกต้อง");
        }

        const { error } = await getSupabase().rpc(
          "force_transfer_character_item",
          {
            source_character: character.id,
            target_character: recipient.id,
            target_item: selectedDirectItem.id,
            transfer_quantity: directQuantity,
          }
        );
        if (error) throw error;

        playEffect({
          kind: "item",
          label: `${selectedDirectItem.name} ×${directQuantity}`,
          from: character.name,
          to: recipient.name,
        });
        onMessage(
          `${character.name} ยัด ${selectedDirectItem.name} ×${directQuantity} ให้ ${recipient.name} แล้ว`
        );
      } else {
        if (
          !Number.isSafeInteger(directTemma) ||
          directTemma < 1 ||
          directTemma > temmaBalance
        ) {
          throw new Error("จำนวนเงินที่โอนไม่ถูกต้องหรือเงินไม่เพียงพอ");
        }

        const { error } = await getSupabase().rpc("transfer_character_temma", {
          source_character: character.id,
          target_character: recipient.id,
          transfer_amount: directTemma,
        });
        if (error) throw error;

        playEffect({
          kind: "money",
          label: `${TEMMA.format(directTemma)} เทมมา`,
          from: character.name,
          to: recipient.name,
        });
        onMessage(
          `${character.name} โอน ${TEMMA.format(directTemma)} เทมมาให้ ${recipient.name} แล้ว`
        );
      }

      setOverlay("closed");
      await onChanged();
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function createTrade() {
    const recipient = characterById.get(tradeRecipientId);
    if (!recipient) {
      onMessage("กรุณาเลือกตัวละครที่จะเทรดด้วย");
      return;
    }

    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("create_character_trade", {
        source_character: character.id,
        target_character: recipient.id,
      });
      if (error) throw error;

      onMessage(`${character.name} ส่งคำเชิญเทรดให้ ${recipient.name} แล้ว`);
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function respondTrade(accept: boolean) {
    if (!activeTrade) return;
    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("respond_character_trade", {
        target_trade: activeTrade.id,
        acting_character: character.id,
        accept_trade: accept,
      });
      if (error) throw error;

      onMessage(
        accept
          ? `${character.name} ยอมรับคำเชิญเทรดแล้ว`
          : `${character.name} ปฏิเสธคำเชิญเทรด`
      );
      if (!accept) setOverlay("closed");
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrade() {
    if (!activeTrade) return;
    if (!window.confirm("ยกเลิกการแลกเปลี่ยนนี้ใช่หรือไม่?")) return;

    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("cancel_character_trade", {
        target_trade: activeTrade.id,
        acting_character: character.id,
      });
      if (error) throw error;

      onMessage("ยกเลิกการแลกเปลี่ยนแล้ว");
      setOverlay("closed");
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleOffer(item: InventoryItem) {
    if (ownReady || busy) return;
    setOfferDraft((current) => {
      const next = { ...current };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = 1;
      return next;
    });
    setOfferDirty(true);
  }

  function changeOfferQuantity(item: InventoryItem, quantity: number) {
    if (ownReady || busy) return;
    setOfferDraft((current) => ({
      ...current,
      [item.id]: Math.min(item.quantity, Math.max(1, quantity || 1)),
    }));
    setOfferDirty(true);
  }

  async function saveOffer() {
    if (!activeTrade || activeTrade.status !== "active") return;

    const offered = Object.entries(offerDraft).map(([itemId, quantity]) => ({
      item_id: itemId,
      quantity,
    }));

    if (!Number.isSafeInteger(offerTemma) || offerTemma < 0) {
      onMessage("จำนวนเงินในข้อเสนอไม่ถูกต้อง");
      return;
    }
    if (offerTemma > temmaBalance) {
      onMessage("เงินเทมมาไม่เพียงพอ");
      return;
    }

    setBusy(true);
    try {
      const { error } = await getSupabase().rpc("set_character_trade_offer", {
        target_trade: activeTrade.id,
        acting_character: character.id,
        offered_items: offered,
        offered_temma: offerTemma,
      });
      if (error) throw error;

      setOfferDirty(false);
      onMessage("บันทึกข้อเสนอแล้ว ทั้งสองฝ่ายต้องยืนยันใหม่");
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function setReady(ready: boolean) {
    if (!activeTrade || activeTrade.status !== "active") return;
    if (offerDirty && ready) {
      onMessage("กรุณาบันทึกข้อเสนอก่อนกดยืนยัน");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await getSupabase().rpc(
        "set_character_trade_ready",
        {
          target_trade: activeTrade.id,
          acting_character: character.id,
          ready_state: ready,
        }
      );
      if (error) throw error;

      if (data === "completed") {
        playEffect({
          kind: "trade",
          label: "แลกเปลี่ยนสำเร็จ",
          from: character.name,
          to: partner?.name ?? "อีกฝ่าย",
        });
        onMessage("การแลกเปลี่ยนเสร็จสมบูรณ์");
        setOverlay("closed");
        await onChanged();
      } else {
        onMessage(ready ? "ยืนยันข้อเสนอแล้ว กำลังรออีกฝ่าย" : "ยกเลิกสถานะพร้อมแล้ว");
      }
      await loadExchange();
    } catch (error) {
      onMessage(errorText(error));
      await loadExchange();
    } finally {
      setBusy(false);
    }
  }

  if (!canExchange || !character.campaign_id) return null;

  return (
    <>
      <section className={styles.exchangeDock} aria-label="ระบบแลกเปลี่ยน">
        <div className={styles.exchangeIntro}>
          <span className={styles.exchangeSigil}>⇄</span>
          <div>
            <p className="eyebrow">Character Exchange</p>
            <h3>ส่งของ โอนเงิน และแลกเปลี่ยน</h3>
            <p>
              ทุกชื่อในระบบเป็นชื่อตัวละคร ไม่ใช่ชื่อบัญชีผู้เล่น
            </p>
          </div>
        </div>

        <div className={styles.exchangeActions}>
          <button className="button ghost" type="button" onClick={openDirect}>
            <span>➤</span> ส่งของ / โอนเงิน
          </button>
          <button className="button" type="button" onClick={openTrade}>
            <span>⚖</span>{" "}
            {activeTrade ? "เปิดหน้าต่างเทรด" : "เริ่มแลกเปลี่ยน"}
          </button>
        </div>

        {activeTrade ? (
          <button
            type="button"
            className={`${styles.tradePulse} ${
              activeTrade.status === "pending" ? styles.pending : styles.active
            }`}
            onClick={openTrade}
          >
            <i />
            <span>
              {activeTrade.status === "pending"
                ? isRecipient
                  ? "มีคำเชิญเทรดรอคุณ"
                  : "กำลังรออีกฝ่ายตอบรับ"
                : `กำลังเทรดกับ ${partner?.name ?? "ตัวละครอื่น"}`}
            </span>
          </button>
        ) : null}
      </section>

      {overlay !== "closed" ? (
        <div
          className={styles.overlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <section
            className={`${styles.modal} ${
              overlay === "trade" ? styles.tradeModal : styles.directModal
            }`}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.modalGlow} />
            <header className={styles.modalHeader}>
              <div>
                <p className="eyebrow">
                  {overlay === "trade" ? "Exchange Contract" : "Direct Transfer"}
                </p>
                <h2>
                  {overlay === "trade"
                    ? "หน้าต่างการแลกเปลี่ยน"
                    : "ส่งของและโอนเงินทันที"}
                </h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={closeOverlay}
                disabled={busy}
                aria-label="ปิด"
              >
                ×
              </button>
            </header>

            {overlay === "direct" ? (
              <div className={styles.directBody}>
                <div className={styles.characterRoute}>
                  <CharacterMedallion character={character} />
                  <div className={styles.routeBeam}>
                    <i />
                    <span>➤</span>
                  </div>
                  <CharacterMedallion
                    character={characterById.get(recipientId) ?? null}
                    emptyLabel="เลือกผู้รับ"
                  />
                </div>

                <label className={styles.field}>
                  <span>ตัวละครผู้รับ</span>
                  <select
                    value={recipientId}
                    onChange={(event) => setRecipientId(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">— เลือกตัวละคร —</option>
                    {characters.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className={styles.modeTabs}>
                  <button
                    type="button"
                    className={directMode === "item" ? styles.selectedMode : ""}
                    onClick={() => setDirectMode("item")}
                  >
                    🎒 ยัดของทันที
                  </button>
                  <button
                    type="button"
                    className={directMode === "money" ? styles.selectedMode : ""}
                    onClick={() => setDirectMode("money")}
                  >
                    ◈ โอนเงินเทมมา
                  </button>
                </div>

                {directMode === "item" ? (
                  <>
                    <div className={styles.redWarning}>
                      <strong>ยัดของแบบทันที</strong>
                      <span>
                        ผู้รับไม่ต้องกดยืนยัน และจะเห็นการแจ้งเตือนสีแดงว่า
                        “ถูกยัดของเข้าคลัง”
                      </span>
                    </div>

                    <label className={styles.field}>
                      <span>เลือกไอเทม</span>
                      <select
                        value={directItemId}
                        onChange={(event) => {
                          setDirectItemId(event.target.value);
                          setDirectQuantity(1);
                        }}
                        disabled={busy}
                      >
                        <option value="">— เลือกไอเทม —</option>
                        {transferableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ×{item.quantity}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>จำนวน</span>
                      <input
                        type="number"
                        min="1"
                        max={selectedDirectItem?.quantity ?? 1}
                        value={directQuantity}
                        onChange={(event) =>
                          setDirectQuantity(Number(event.target.value))
                        }
                        disabled={busy}
                      />
                    </label>

                    {selectedDirectItem ? (
                      <ItemPreview
                        name={selectedDirectItem.name}
                        imagePath={selectedDirectItem.image_path}
                        signedImages={signedImages}
                        detail={`จำนวนในคลัง ${selectedDirectItem.quantity}`}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className={styles.moneyPanel}>
                      <span className={styles.coin}>◈</span>
                      <div>
                        <small>ยอดเงินของ {character.name}</small>
                        <strong>{TEMMA.format(temmaBalance)} เทมมา</strong>
                      </div>
                    </div>

                    <label className={styles.field}>
                      <span>จำนวนเงินที่โอน</span>
                      <input
                        type="number"
                        min="1"
                        max={temmaBalance}
                        step="1"
                        value={directTemma}
                        onChange={(event) =>
                          setDirectTemma(Number(event.target.value))
                        }
                        disabled={busy}
                      />
                    </label>
                  </>
                )}

                <div className={styles.modalActions}>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={closeOverlay}
                    disabled={busy}
                  >
                    ยกเลิก
                  </button>
                  <button
                    className={`button ${
                      directMode === "item" ? "danger" : ""
                    }`}
                    type="button"
                    onClick={sendDirect}
                    disabled={
                      busy ||
                      !recipientId ||
                      (directMode === "item" && !directItemId)
                    }
                  >
                    {busy
                      ? "กำลังดำเนินการ…"
                      : directMode === "item"
                      ? "ยัดของให้ผู้รับ"
                      : "ยืนยันการโอนเงิน"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.tradeBody}>
                {!activeTrade ? (
                  <section className={styles.createTrade}>
                    <div className={styles.tradePortal}>
                      <span>⚖</span>
                      <i />
                    </div>
                    <h3>เลือกคู่แลกเปลี่ยน</h3>
                    <p>
                      อีกฝ่ายต้องตอบรับก่อน หน้าต่างเสนอของและเงินจึงจะเปิด
                    </p>
                    <label className={styles.field}>
                      <span>ตัวละครที่ต้องการเทรดด้วย</span>
                      <select
                        value={tradeRecipientId}
                        onChange={(event) =>
                          setTradeRecipientId(event.target.value)
                        }
                        disabled={busy}
                      >
                        <option value="">— เลือกตัวละคร —</option>
                        {characters.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button"
                      type="button"
                      onClick={createTrade}
                      disabled={busy || !tradeRecipientId}
                    >
                      {busy ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญแลกเปลี่ยน"}
                    </button>
                  </section>
                ) : activeTrade.status === "pending" ? (
                  <section className={styles.pendingTrade}>
                    <div className={styles.characterRoute}>
                      <CharacterMedallion character={character} />
                      <div className={styles.pendingBeam}>
                        <i />
                        <span>✦</span>
                      </div>
                      <CharacterMedallion character={partner} />
                    </div>

                    <h3>
                      {isRecipient
                        ? `${partner?.name ?? "อีกฝ่าย"} เชิญคุณแลกเปลี่ยน`
                        : `กำลังรอ ${partner?.name ?? "อีกฝ่าย"} ตอบรับ`}
                    </h3>
                    <p>
                      {isRecipient
                        ? "ตอบรับเพื่อเปิดหน้าต่างเสนอของและเงิน หรือปฏิเสธคำเชิญนี้"
                        : "คำเชิญถูกส่งแล้ว หน้าต่างจะเปิดทันทีเมื่ออีกฝ่ายตอบรับ"}
                    </p>

                    <div className={styles.modalActions}>
                      <button
                        className="button danger"
                        type="button"
                        onClick={() =>
                          isRecipient ? respondTrade(false) : cancelTrade()
                        }
                        disabled={busy}
                      >
                        {isRecipient ? "ปฏิเสธ" : "ยกเลิกคำเชิญ"}
                      </button>
                      {isRecipient ? (
                        <button
                          className="button"
                          type="button"
                          onClick={() => respondTrade(true)}
                          disabled={busy}
                        >
                          ยอมรับและเปิดหน้าต่างเทรด
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : (
                  <section className={styles.activeTrade}>
                    <div className={styles.tradeStatusBar}>
                      <ReadyBadge name={character.name} ready={ownReady} own />
                      <div className={styles.contractSeal}>
                        <span>⚖</span>
                        <i className={partnerReady && ownReady ? styles.synced : ""} />
                      </div>
                      <ReadyBadge
                        name={partner?.name ?? "อีกฝ่าย"}
                        ready={partnerReady}
                      />
                    </div>

                    <div className={styles.tradeColumns}>
                      <section className={styles.offerColumn}>
                        <div className={styles.offerHeader}>
                          <div>
                            <small>ข้อเสนอของคุณ</small>
                            <h3>{character.name}</h3>
                          </div>
                          <strong>
                            {ownReady
                              ? "ยืนยันแล้ว"
                              : offerDirty
                              ? "ยังไม่บันทึก"
                              : "แก้ไขได้"}
                          </strong>
                        </div>

                        <div className={styles.offerInventory}>
                          {transferableItems.length ? (
                            transferableItems.map((item) => {
                              const checked = Boolean(offerDraft[item.id]);
                              return (
                                <article
                                  key={item.id}
                                  className={checked ? styles.offered : ""}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleOffer(item)}
                                    disabled={ownReady || busy}
                                  >
                                    <ItemArtwork
                                      name={item.name}
                                      imagePath={item.image_path}
                                      signedImages={signedImages}
                                    />
                                    <span>
                                      <strong>{item.name}</strong>
                                      <small>
                                        มี {item.quantity} · {item.item_type}
                                      </small>
                                    </span>
                                    <b>{checked ? "✓" : "＋"}</b>
                                  </button>
                                  {checked ? (
                                    <label>
                                      จำนวน
                                      <input
                                        type="number"
                                        min="1"
                                        max={item.quantity}
                                        value={offerDraft[item.id]}
                                        onChange={(event) =>
                                          changeOfferQuantity(
                                            item,
                                            Number(event.target.value)
                                          )
                                        }
                                        disabled={ownReady || busy}
                                      />
                                    </label>
                                  ) : null}
                                </article>
                              );
                            })
                          ) : (
                            <p className="emptyText">
                              ไม่มีไอเทมที่พร้อมนำมาแลกเปลี่ยน
                            </p>
                          )}
                        </div>

                        <label className={styles.temmaOffer}>
                          <span>เงินเทมมาที่เสนอ</span>
                          <div>
                            <b>◈</b>
                            <input
                              type="number"
                              min="0"
                              max={temmaBalance}
                              step="1"
                              value={offerTemma}
                              onChange={(event) => {
                                setOfferTemma(
                                  Math.max(0, Number(event.target.value) || 0)
                                );
                                setOfferDirty(true);
                              }}
                              disabled={ownReady || busy}
                            />
                          </div>
                          <small>
                            คุณมี {TEMMA.format(temmaBalance)} เทมมา
                          </small>
                        </label>

                        <button
                          className="button ghost"
                          type="button"
                          onClick={saveOffer}
                          disabled={busy || ownReady || !offerDirty}
                        >
                          บันทึกข้อเสนอ
                        </button>
                      </section>

                      <div className={styles.exchangeCore}>
                        <i />
                        <span>⇄</span>
                        <small>TRADE</small>
                      </div>

                      <section className={styles.offerColumn}>
                        <div className={styles.offerHeader}>
                          <div>
                            <small>ข้อเสนอของอีกฝ่าย</small>
                            <h3>{partner?.name ?? "อีกฝ่าย"}</h3>
                          </div>
                          <strong>
                            {partnerReady ? "ยืนยันแล้ว" : "กำลังพิจารณา"}
                          </strong>
                        </div>

                        <div className={styles.partnerOfferList}>
                          {partnerTradeItems.length ? (
                            partnerTradeItems.map((item) => (
                              <ItemPreview
                                key={item.id}
                                name={item.item_name}
                                imagePath={item.image_path}
                                signedImages={signedImages}
                                detail={`จำนวน ${item.quantity} · ${item.item_type}`}
                              />
                            ))
                          ) : (
                            <div className={styles.emptyOffer}>
                              <span>◇</span>
                              <p>อีกฝ่ายยังไม่ได้เสนอไอเทม</p>
                            </div>
                          )}
                        </div>

                        <div className={styles.partnerMoney}>
                          <span>◈</span>
                          <div>
                            <small>เงินที่อีกฝ่ายเสนอ</small>
                            <strong>{TEMMA.format(partnerTemma)} เทมมา</strong>
                          </div>
                        </div>

                        <div className={styles.savedSummary}>
                          <small>ข้อเสนอที่บันทึกไว้ของคุณ</small>
                          <strong>
                            {ownTradeItems.length} รายการ ·{" "}
                            {TEMMA.format(ownSavedTemma)} เทมมา
                          </strong>
                        </div>
                      </section>
                    </div>

                    <div className={styles.tradeActions}>
                      <button
                        className="button danger"
                        type="button"
                        onClick={cancelTrade}
                        disabled={busy}
                      >
                        ยกเลิกการเทรด
                      </button>
                      <div>
                        {ownReady ? (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => setReady(false)}
                            disabled={busy}
                          >
                            ยกเลิกสถานะพร้อม
                          </button>
                        ) : (
                          <button
                            className="button"
                            type="button"
                            onClick={() => setReady(true)}
                            disabled={busy || offerDirty}
                          >
                            ยืนยันข้อเสนอของฉัน
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {toast ? (
        <aside
          className={`${styles.toast} ${styles[`tone_${toast.tone}`]}`}
          role="status"
          aria-live="assertive"
        >
          <div className={styles.toastIcon}>
            {toast.kind === "forced_item"
              ? "!"
              : toast.kind === "money_transfer"
              ? "◈"
              : toast.kind === "trade_completed"
              ? "⚖"
              : "✦"}
          </div>
          <div>
            <small>
              {toast.kind === "forced_item"
                ? "FORCED DELIVERY"
                : "CHARACTER EXCHANGE"}
            </small>
            <strong>{toast.title}</strong>
            <p>{toast.body}</p>
          </div>
          <button type="button" onClick={() => setToast(null)}>
            ×
          </button>
        </aside>
      ) : null}

      {effect ? (
        <div
          className={`${styles.motionScene} ${styles[`effect_${effect.kind}`]}`}
          aria-hidden="true"
        >
          <div className={styles.motionBackdrop} />
          <div className={styles.motionPath}>
            <span className={styles.motionFrom}>{effect.from}</span>
            <div className={styles.flyingToken}>
              <i>{effect.kind === "money" ? "◈" : effect.kind === "trade" ? "⚖" : "◆"}</i>
              <strong>{effect.label}</strong>
            </div>
            <span className={styles.motionTo}>{effect.to}</span>
          </div>
          <div className={styles.motionParticles}>
            {Array.from({ length: 14 }, (_, index) => (
              <i key={index} style={{ "--particle": index } as React.CSSProperties} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function CharacterMedallion({
  character,
  emptyLabel = "ไม่พบตัวละคร",
}: {
  character: { name: string; portrait_url: string | null } | null;
  emptyLabel?: string;
}) {
  return (
    <div className={styles.medallion}>
      <div>
        {character?.portrait_url ? (
          <img src={character.portrait_url} alt={character.name} />
        ) : (
          <span>{character?.name?.slice(0, 1) || "?"}</span>
        )}
      </div>
      <strong>{character?.name || emptyLabel}</strong>
    </div>
  );
}

function ItemArtwork({
  name,
  imagePath,
  signedImages,
}: {
  name: string;
  imagePath: string | null;
  signedImages: Record<string, string>;
}) {
  const url = imagePath ? signedImages[imagePath] : "";
  return (
    <span className={styles.itemArtwork}>
      {url ? <img src={url} alt={name} /> : <span>◆</span>}
    </span>
  );
}

function ItemPreview({
  name,
  imagePath,
  signedImages,
  detail,
}: {
  name: string;
  imagePath: string | null;
  signedImages: Record<string, string>;
  detail: string;
}) {
  return (
    <article className={styles.itemPreview}>
      <ItemArtwork
        name={name}
        imagePath={imagePath}
        signedImages={signedImages}
      />
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function ReadyBadge({
  name,
  ready,
  own = false,
}: {
  name: string;
  ready: boolean;
  own?: boolean;
}) {
  return (
    <div
      className={`${styles.readyBadge} ${ready ? styles.isReady : ""}`}
      data-own={own ? "true" : "false"}
    >
      <i>{ready ? "✓" : "…"}</i>
      <span>
        <small>{own ? "คุณ" : "อีกฝ่าย"}</small>
        <strong>{name}</strong>
      </span>
      <b>{ready ? "พร้อม" : "ยังไม่พร้อม"}</b>
    </div>
  );
}

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
  return "ดำเนินการแลกเปลี่ยนไม่สำเร็จ";
}
