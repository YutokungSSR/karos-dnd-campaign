# คู่มือนำระบบขึ้นออนไลน์

## ส่วนที่ต้องใช้บัญชีของเจ้าของเว็บ

โค้ดและฐานข้อมูลเตรียมไว้ครบแล้ว แต่การสร้างโปรเจกต์ Supabase, GitHub และ Vercel ต้องทำในบัญชีของคุณเอง เพราะต้องยืนยันอีเมลและยอมรับสิทธิ์การเข้าถึงบัญชี

## 1. สร้างฐานข้อมูล Supabase

1. เข้า Supabase แล้วสร้าง New project
2. ตั้งชื่อ เช่น `karos-dnd-campaign`
3. ตั้ง Database password และเก็บไว้
4. รอโปรเจกต์สร้างเสร็จ
5. เปิด **SQL Editor → New query**
6. เปิดไฟล์ `supabase/schema.sql` ในโฟลเดอร์นี้ คัดลอกทั้งหมด แล้วกด Run
7. ไปที่ **Project Settings → API** แล้วคัดลอก:
   - Project URL
   - anon public key / publishable key

## 2. ตั้งค่าระบบยืนยันอีเมล

ใน Supabase ไปที่ **Authentication → URL Configuration**

ระหว่างทดสอบให้ตั้ง:

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**`

หลังมีลิงก์ Vercel ให้เพิ่ม:

- Site URL: `https://ชื่อเว็บของคุณ.vercel.app`
- Redirect URLs: `https://ชื่อเว็บของคุณ.vercel.app/**`

## 3. ทดสอบในคอมพิวเตอร์

สร้างไฟล์ `.env.local` จาก `.env.example` แล้วใส่ค่า:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

จากนั้นเปิด Command Prompt ในโฟลเดอร์โปรเจกต์:

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000` แล้วทดสอบสร้างบัญชี แคมเปญ และตัวละคร

## 4. นำโค้ดขึ้น GitHub

1. สร้าง Repository ใหม่ใน GitHub
2. เปิด Command Prompt ในโฟลเดอร์โปรเจกต์
3. ใช้คำสั่งที่ GitHub แสดง หรือใช้ชุดนี้โดยเปลี่ยน URL:

```bash
git init
git add .
git commit -m "Initial D&D campaign system"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

ไฟล์ `.env.local` ถูกกันไว้ใน `.gitignore` และจะไม่ถูกอัปโหลด

## 5. เปิดเว็บบน Vercel

1. เข้าสู่ระบบ Vercel ด้วย GitHub
2. กด **Add New → Project**
3. เลือก Repository ของเว็บนี้
4. ใน Environment Variables เพิ่ม:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` โดยใส่ URL เว็บ Vercel
5. กด Deploy
6. คัดลอกลิงก์ที่ได้กลับไปเพิ่มใน Supabase Authentication URL Configuration ตามข้อ 2
7. ใน Vercel กด Redeploy อีกครั้งหลังแก้ Environment Variables หากจำเป็น

## 6. ทดสอบก่อนส่งให้ผู้เล่น

ใช้เบราว์เซอร์สองตัวหรือโหมดไม่ระบุตัวตน:

1. บัญชีแรกสร้างแคมเปญ เป็น DM
2. คัดลอกรหัสเชิญ
3. บัญชีที่สองเข้าร่วมด้วยรหัส
4. ผู้เล่นสร้างตัวละครในแคมเปญ
5. DM ปรับ HP จากหน้าแคมเปญ
6. ทั้งสองบัญชีทอยลูกเต๋าและตรวจสอบประวัติ
7. เปิดแชร์สาธารณะในหน้าตัวละคร บันทึก และทดสอบลิงก์ในโหมดไม่ระบุตัวตน

## 7. อัปเดตระบบคลังไอเทมสำหรับเว็บที่เปิดใช้งานแล้ว

ก่อนนำ Pull Request ระบบคลังไอเทมเข้าเว็บจริง:

1. สำรองฐานข้อมูล Supabase
2. เปิด **Supabase → SQL Editor → New query**
3. เปิดไฟล์ `supabase/migrations/20260718055940_mmorpg_inventory.sql`
4. คัดลอก SQL ทั้งหมด วางใน SQL Editor แล้วกด **Run** เพียงครั้งเดียว
5. ตรวจว่าเกิดตาราง `character_inventories` และ Storage bucket `inventory-item-images`
6. ทดสอบด้วยบัญชี DM และผู้เล่นก่อน Merge Pull Request

หลัง migration สำเร็จ:

- ผู้เล่นต้องเพิ่มไอเทมพร้อมภาพและจำนวนลงคลังของตัวเอง รวมถึงสวมและถอดอุปกรณ์ได้
- ผู้เล่นต้องแก้ไขหรือลบไอเทมเดิมและเปลี่ยนลิมิตช่องไม่ได้ โดยให้ DM เป็นผู้จัดการส่วนนี้
- DM ต้องเพิ่ม ลบ แก้จำนวน สวมใส่ อัปโหลดภาพ และเปลี่ยนลิมิตช่องได้
- รองเท้าต้องใส่ได้เฉพาะช่องรองเท้า อุปกรณ์อื่นต้องตรงกับตำแหน่งที่ DM กำหนด และอาวุธเลือกมือซ้ายหรือมือขวาได้
- การลดลิมิตต้องจัดไอเทมไปยังช่องเลขต้น ๆ ให้อัตโนมัติเมื่อจำนวนไอเทมยังไม่เกินลิมิตใหม่
- เจ้าของตัวละครต้องเห็นคลังของตัวเอง มีปุ่มเพิ่มไอเทมและสวมใส่ แต่ไม่มีปุ่มแก้ไขหรือลบไอเทมเดิม
- สมาชิกคนอื่นและลิงก์สาธารณะต้องไม่เห็นคลังไอเทม
- ห้ามรัน `supabase/schema.sql` ทั้งไฟล์ซ้ำบนฐานข้อมูล Production เพื่ออัปเดตฟังก์ชันนี้

## ค่าใช้จ่าย

เริ่มต้นสามารถใช้แผนฟรีของ Supabase และ Vercel สำหรับกลุ่มผู้เล่นขนาดเล็กได้ เมื่อมีผู้ใช้หรือไฟล์ภาพจำนวนมากจึงค่อยตรวจสอบโควตาและอัปเกรด

## ความปลอดภัย

- ใช้เฉพาะ anon / publishable key ในเว็บ ห้ามใส่ service role key
- ฐานข้อมูลเปิด RLS ทุกตารางแล้ว
- ภาพจำกัดขนาดสูงสุด 5 MB และรับเฉพาะ JPEG, PNG, WebP, GIF
- สำรองฐานข้อมูลและตรวจสอบ Supabase Security Advisor ก่อนเปิดให้คนจำนวนมากใช้งาน
