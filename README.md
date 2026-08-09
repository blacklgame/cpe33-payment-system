# CPE33 Payment System

A web-based payment tracking system for **CPE33 students at Naresuan University**.

---

## What this site does

### For Students
Students log in using their **Nu ID** (student ID number). Once logged in, they can:
- **Upload a payment slip** — take a photo or select an image of their payment receipt and submit it through the site.
- **Check their payment status** — see whether their slip has been approved, is still pending review, or has been rejected.

### For Admins
Admins sign in with a whitelisted **@nu.ac.th Google account**. Through the admin dashboard, they can:
- **View all 91 students** in the class roster with their current payment status at a glance.
- **Review uploaded slips** — view the slip image a student submitted.
- **Approve a slip** — the only action that marks a student as officially paid.
- **Reject / delete a slip** — removes the slip and resets the student back to unpaid.
- **Set a student's status** manually:
  - 🟢 **ปกติ / Normal** — active student, paid
  - 🔴 **ยังไม่จ่าย / Unpaid** — has not paid yet
  - 🟠 **พ้นสภาพ / Terminated** — no longer an active student; blocked from uploading

---

## Key rules

- A student is **never automatically marked as paid** just by uploading a slip. An admin must review and approve it.
- Terminated students **cannot submit new slips**.
- All payment write operations are **admin-only and verified server-side** — they cannot be bypassed from the browser.
