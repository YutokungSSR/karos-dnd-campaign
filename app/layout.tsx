import type { Metadata } from "next";
import "./globals.css";
import Embers from "@/components/Embers";
import GodGiftSystem from "@/components/GodGiftSystem";
import UiSoundSystem from "@/components/UiSoundSystem";

export const metadata: Metadata = {
  title: "มหาคัมภีร์แห่งออดมา | D&D Campaign",
  description: "ระบบแคมเปญและหน้าต่างสเตตัสสำหรับจักรวาล D&D",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>
        <Embers />
        <div className="pageGlow" aria-hidden="true" />
        {children}
        <GodGiftSystem />
        <UiSoundSystem />
      </body>
    </html>
  );
}
