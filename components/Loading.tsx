export default function Loading({ text = "กำลังเปิดคัมภีร์…" }: { text?: string }) {
  return (
    <div className="loadingState">
      <div className="runeSpinner">✦</div>
      <p>{text}</p>
    </div>
  );
}
