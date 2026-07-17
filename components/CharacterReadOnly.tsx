import type { ReactNode } from "react";

const STAT_LABELS = ["STR", "VIT", "AGI", "INT", "DEX", "WIS", "CHA"];

export default function CharacterReadOnly({
  character,
  skills,
  items,
  conditions,
  actions,
}: {
  character: any;
  skills: any[];
  items: any[];
  conditions: any[];
  actions?: ReactNode;
}) {
  const stats = character.stats ?? {};
  return (
    <article className="characterSheet">
      <section className="portraitSide">
        <div className="portraitBackdrop">
          {character.portrait_url ? (
            <img src={character.portrait_url} alt={character.name} className="portraitImage" />
          ) : (
            <div className="portraitEmpty"><span>♜</span><p>ยังไม่มีภาพตัวละคร</p></div>
          )}
          <div className="portraitShade" />
          <div className="portraitIdentity">
            <span>{character.title || "นักผจญภัยไร้นาม"}</span>
            <h1>{character.name}</h1>
            <p>{character.class_name || "ไม่ระบุคลาส"} · ระดับ {character.level}</p>
          </div>
        </div>
        {actions ? <div className="portraitActions">{actions}</div> : null}
      </section>

      <section className="parchmentSide">
        <div className="sheetSection">
          <h2 className="ornamentTitle">ข้อมูลตัวละคร</h2>
          <div className="infoGrid">
            {[
              ["ชื่อ", character.name], ["ฉายา", character.title || "—"], ["คลาส", character.class_name || "—"],
              ["ระดับ", character.level], ["แรงค์", character.rank || "—"], ["ธาตุ", character.element || "—"],
              ["เผ่าพันธุ์", character.race || "—"], ["ดาว", character.stars || "—"], ["สถานะ", character.condition_text || "ปกติ"],
            ].map(([label, value]) => <div className="infoCell" key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}
          </div>
        </div>

        <div className="sheetSection">
          <h2 className="ornamentTitle">พลังชีวิตและมานา</h2>
          <div className="resourceGrid">
            <ResourceBar label="HP" current={character.current_hp} max={character.max_hp} />
            <ResourceBar label="MP" current={character.current_mp} max={character.max_mp} />
          </div>
          <div className="statsGrid">
            {STAT_LABELS.map((key) => {
              const value = Number(stats[key] ?? 0);
              return <div className="statLine" key={key}><strong>{key}</strong><div className="statTrack"><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div><b>{value}</b></div>;
            })}
          </div>
        </div>

        <div className="sheetSection">
          <h2 className="ornamentTitle">สกิล</h2>
          <div className="cardGrid">
            {skills.length ? skills.map((skill) => <div className="miniCard" key={skill.id}><div className="miniCardHead"><strong>{skill.name}</strong><span>{skill.skill_type || "ทั่วไป"}</span></div><p>{skill.description || "ไม่มีคำอธิบาย"}</p><small>{skill.cost || ""}</small></div>) : <p className="emptyText">ยังไม่มีสกิล</p>}
          </div>
        </div>

        <div className="sheetSection twoColumns">
          <div>
            <h2 className="ornamentTitle">คลังไอเทม</h2>
            <div className="stackList">
              {items.length ? items.map((item) => <div className="listRow" key={item.id}><span>{item.equipped ? "◆" : "◇"}</span><div><strong>{item.name}</strong><small>{item.item_type || "ไอเทม"} · จำนวน {item.quantity}</small></div></div>) : <p className="emptyText">ยังไม่มีไอเทม</p>}
            </div>
          </div>
          <div>
            <h2 className="ornamentTitle">สถานะผิดปกติ</h2>
            <div className="stackList">
              {conditions.length ? conditions.map((condition) => <div className="listRow warning" key={condition.id}><span>✧</span><div><strong>{condition.name}</strong><small>{condition.description || "ไม่มีรายละเอียด"}</small></div></div>) : <p className="emptyText">ไม่มีสถานะผิดปกติ</p>}
            </div>
          </div>
        </div>

        <div className="sheetSection memorySection">
          <h2 className="ornamentTitle">จิ๊กซอว์ความทรงจำ</h2>
          <p>{character.memory || "ความทรงจำส่วนนี้ยังคงถูกผนึกไว้…"}</p>
        </div>
      </section>
    </article>
  );
}

function ResourceBar({ label, current, max }: { label: string; current: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  return <div className={`resourceBar ${label.toLowerCase()}`}><div className="resourceLabel"><strong>{label}</strong><span>{current} / {max}</span></div><div className="resourceTrack"><span style={{ width: `${percent}%` }} /></div></div>;
}
