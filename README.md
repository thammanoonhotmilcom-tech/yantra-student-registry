# Yantra Student Registry — Supabase

ระบบสมุดรายชื่อลูกศิษสำนักอาจารย์คม

## Render Environment Variables
ตั้งค่า 4 ตัวนี้ใน Render:
- `SUPABASE_URL` = Project URL ของ Supabase
- `SUPABASE_SECRET_KEY` = Secret key ของ Supabase (ห้ามใส่ใน GitHub)
- `ADMIN_KEY` = รหัสที่เจ้าของใช้เปิดโหมดแก้ไข
- `SESSION_SECRET` = ข้อความสุ่มยาว ๆ

Start Command:
`npm start`

## Supabase table
ใช้ตาราง `public.students` ที่สร้างไว้แล้ว โดยมี:
`id`, `group_key`, `name`, `created_at`, `updated_at`.
