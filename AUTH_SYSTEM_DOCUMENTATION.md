# מערכת אימות משתמשים (Authentication System) - תיעוד מלא

---

## 📁 רשימת קבצים רלוונטיים

### צד שרת (Server)
| קובץ | תפקיד |
|---|---|
| `server/models/user.model.ts` | מודל User — סכמת MongoDB |
| `server/models/session.model.ts` | מודל Session — טוקנים פעילים |
| `server/services/auth.service.ts` | לוגיקת אימות: OTP, יצירת session, אימות |
| `server/services/sms.service.ts` | שליחת SMS דרך 019SMS API |
| `server/services/email.service.ts` | שליחת מייל דרך SendGrid API |
| `server/routes/auth.ts` | API endpoints לאימות |
| `server/middleware/auth.middleware.ts` | Middleware: requireAuth, requireTenant, requireTenantDb |

### צד לקוח (Client)
| קובץ | תפקיד |
|---|---|
| `client/src/pages/login.tsx` | מסך Login ראשי (לעובדים — עם slug של טנאנט) |
| `client/src/pages/admin-login.tsx` | מסך Login למנהלים (ללא slug) |
| `client/src/lib/auth-context.tsx` | React Context: ניהול מצב אימות, token, user |
| `client/src/components/ui/input-otp.tsx` | קומפוננטת OTP Input (shadcn) |
| `client/src/App.tsx` | ראוטינג — קובע מתי להציג Login |

---

## 🗄️ מבנה טבלאות (MongoDB Collections)

### Users Collection

```typescript
interface IUser {
  name: string;                    // שם מלא
  phone: string;                   // טלפון (ייחודי לטנאנט)
  email: string;                   // מייל (ייחודי לטנאנט)
  role: "superadmin" | "businessadmin" | "teamleader" | "employee";
  tenantId: ObjectId;              // שיוך לטנאנט
  active: boolean;                 // האם פעיל (default: true)
  groupId?: string;                // קבוצה (אופציונלי)
  teamIds?: string[];              // צוותים
  isOnline?: boolean;              // סטטוס חיבור (default: false)
  presenceStatus?: "active" | "busy" | "away"; // נוכחות (default: "active")
  lastSeenAt?: Date;               // פעילות אחרונה
  lastRoutedAt?: Date;             // ניתוב שיחה אחרון
  passwordHash?: string;           // סיסמה מוצפנת (לא בשימוש פעיל)
  otpCode?: string;                // קוד OTP נוכחי
  otpExpiresAt?: Date;             // תפוגת OTP
  otpAttempts?: number;            // ניסיונות OTP כושלים (default: 0)
  lastLoginAt?: Date;              // כניסה אחרונה
  isLocked?: boolean;              // חשבון נעול (default: false)
  lockedUntil?: Date;              // נעילה עד
}
```

**Indexes:**
- `{ phone: 1, tenantId: 1 }` — unique
- `{ email: 1, tenantId: 1 }` — unique, sparse

### Sessions Collection

```typescript
interface ISession {
  userId: ObjectId;     // מזהה משתמש
  token: string;        // טוקן (hex 64 תווים)
  userAgent?: string;   // דפדפן
  ipAddress?: string;   // כתובת IP
  expiresAt: Date;      // תפוגה
  createdAt: Date;      // נוצר אוטומטית
}
```

**Indexes:**
- `{ token: 1 }` — חיפוש מהיר
- `{ userId: 1 }` — מחיקת sessions למשתמש
- `{ expiresAt: 1 }` — TTL index (MongoDB מוחק אוטומטית)

---

## 🔄 זרימת Login (Auth Flow)

### תרחיש 1: Login עובד (עם slug של טנאנט)

```
URL: /login/barozservice
```

1. **לקוח** → `GET /api/public/tenant/barozservice` → מקבל tenantId, לוגו, שם
2. **לקוח** → בוחר מצב: טלפון או מייל
3. **לקוח** → `POST /api/auth/request-login` עם `{ identifier, mode, tenantId, language }`
4. **שרת** → מחפש User עם phone/email + tenantId
5. **שרת** → יוצר OTP בן 6 ספרות, שומר ב-DB, שולח SMS/Email
6. **לקוח** → מציג מסך OTP
7. **לקוח** → `POST /api/auth/verify-login` עם `{ identifier, mode, otp, tenantId }`
8. **שרת** → בודק OTP, יוצר session, מחזיר token + user
9. **לקוח** → שומר token ב-localStorage, מנווט ל-/

### תרחיש 2: Login מנהל (ללא slug)

```
URL: /admin או /login/admin
```

1. **אין קריאת tenant** — מצב ברירת מחדל: מייל
2. **לקוח** → `POST /api/auth/request-login` עם `{ identifier, mode }` (ללא tenantId)
3. **שרת** → מחפש User ללא סינון tenant
4. **שאר הזרימה זהה**

### תרחיש 3: Super Admin ב-Test Mode

```
APP_MODE=test
```

- אם ה-identifier תואם ל-`ADMIN_EMAIL` או `ADMIN_MOBILE_NUMBER`
- **מדלג על OTP** — נכנס ישירות עם token
- שימושי לפיתוח

---

## 📱 שליחת SMS (019SMS API)

### קובץ: `server/services/sms.service.ts`

**ספק:** 019SMS (ישראל) — `https://019sms.co.il/api`

**זרימת credentials:**
1. ניסיון ראשון: Config מוצפן מטבלת Tenant (`smsConfig.userName/accessToken/source`)
2. ניסיון שני: Environment variables (`SMS019_USER_NAME`, `SMS019_ACCESS_TOKEN`, `SMS019_SOURCE`)
3. ניסיון שלישי: Fallback — חיפוש טנאנט פעיל כלשהו עם config תקין

**Payload:**
```json
{
  "sms": {
    "user": { "username": "..." },
    "source": "...",
    "destinations": { "phone": ["523852526"] },
    "message": "קוד האימות שלך: 123456"
  }
}
```

**Retry אוטומטי:** עד 3 פעמים עם השהיות: 0s, 30s, 5min

**תבניות OTP (5 שפות):**
- עברית: `קוד האימות שלך: 123456`
- English: `Your verification code: 123456`
- عربي: `رمز التحقق الخاص بك: 123456`
- Русский: `Ваш код подтверждения: 123456`
- Türkçe: `Doğrulama kodunuz: 123456`

---

## 📧 שליחת Email (SendGrid API)

### קובץ: `server/services/email.service.ts`

**ספק:** SendGrid

**זרימת credentials:**
1. ניסיון ראשון: Config מוצפן מטבלת Tenant (`mailConfig.sendGridKey/fromEmail/fromName`)
2. ניסיון שני: Environment variables (`SENDGRID_API_KEY`, `DEFAULT_FROM_EMAIL`, `DEFAULT_FROM_NAME`)
3. ניסיון שלישי: Fallback — חיפוש טנאנט פעיל כלשהו עם config תקין

**Proxy:** תומך ב-QuotaGuard Static proxy לטנאנטים שצריכים (דרך `getTenantQuotaGuardAgent`)

**תבנית HTML של OTP:**
```html
<div dir="rtl" style="font-family: Arial; padding: 20px; text-align: center;">
  <h2>קוד האימות שלך</h2>
  <p style="font-size: 32px; font-weight: bold; color: #2563eb;">123456</p>
  <p style="color: #6b7280;">הקוד תקף ל-5 דקות</p>
</div>
```

---

## 🛡️ אבטחה

### Rate Limiting (בזיכרון)
| פעולה | מפתח | מקסימום | חלון זמן |
|---|---|---|---|
| בקשת Login | `login-req:{identifier}` | 5 | 10 דקות |
| Login per IP | `login-ip:{ip}` | 15 | 10 דקות |
| אימות OTP | `login-verify:{key}:{ip}` | 10 | 15 דקות |
| בקשת OTP (ישן) | `otp:{phone}:{tenantId}` | 3 | 10 דקות |
| OTP per IP (ישן) | `otp-ip:{ip}` | 10 | 10 דקות |
| אימות OTP (ישן) | `verify-otp:{phone}:{ip}` | 10 | 15 דקות |

### נעילת חשבון
- אחרי **5 ניסיונות OTP כושלים** → נעילה ל-**15 דקות**
- נעילה מתבטלת אוטומטית בבקשת login הבאה אחרי שהזמן עבר

### Session Management
- Admin session: **8 שעות**
- User session: **24 שעות**
- Token: `crypto.randomBytes(32).toString("hex")` — 64 תווים hex
- TTL Index על `expiresAt` — MongoDB מוחק אוטומטית sessions שפגו
- Login חדש מוחק sessions ישנים של אותו user (חוץ מ-session פעיל)

---

## 🖥️ מסכי Login (Frontend)

### login.tsx — מסך ראשי
- **Route:** `/login/:slug` (עם slug) או `/login` (ללא slug → שגיאה)
- **מצבים:** טלפון / מייל (toggle)
- **שלבים:** identifier → OTP
- **טעינת טנאנט:** `GET /api/public/tenant/:slug` → מציג לוגו + שם חברה
- **Responsive:** Mobile-first עם שינויים ל-desktop
- **שפות:** תמיכה ב-he/en/ar/ru/tr דרך i18next
- **OTP Input:** 6 תאים, autofocus, countdown 60 שניות
- **שגיאות:** USER_NOT_FOUND, ACCOUNT_LOCKED, TOO_MANY_REQUESTS, DELIVERY_FAILED

### admin-login.tsx — מסך מנהלים
- **Route:** `/admin` או `/login/admin`
- **דומה ל-login.tsx** אבל:
  - ללא slug/tenant — לא שולח tenantId
  - ברירת מחדל: מייל (לא טלפון)
  - עיצוב פשוט יותר (ללא לוגו חברה)

### auth-context.tsx — ניהול State
- **AuthProvider** עוטף את כל האפליקציה
- **useState** לניהול user, token, isLoading
- **validateToken** — בטעינה, בודק `GET /api/auth/me`
- **login()** — שומר token+user ב-localStorage
- **logout()** — מוחק localStorage, קורא `POST /api/auth/logout`, מנווט לדף login
- **תמיכה ב-URL token:** `?_t=TOKEN&_u=USER` — לקישורים ישירים

---

## 🔌 API Endpoints

### Public
| Method | Route | תיאור |
|---|---|---|
| GET | `/api/public/tenant/:slug` | פרטי טנאנט ציבוריים (שם, לוגו, צבע) |

### Auth (ללא אימות)
| Method | Route | תיאור |
|---|---|---|
| POST | `/api/auth/request-login` | בקשת login (שולח OTP) |
| POST | `/api/auth/verify-login` | אימות OTP ← מקבל token |
| POST | `/api/auth/request-otp` | בקשת OTP (legacy — טלפון + tenantId) |
| POST | `/api/auth/verify-otp` | אימות OTP (legacy — טלפון + tenantId) |

### Auth (עם אימות)
| Method | Route | תיאור |
|---|---|---|
| GET | `/api/auth/me` | פרטי המשתמש המחובר |
| PATCH | `/api/auth/presence` | עדכון סטטוס נוכחות |
| POST | `/api/auth/logout` | יציאה (מחיקת session) |

---

## ⚙️ Environment Variables הנדרשים

### אימות
- `APP_MODE` — `test` למצב פיתוח (מדלג OTP ל-superadmin)
- `ADMIN_EMAIL` — מייל super admin
- `ADMIN_MOBILE_NUMBER` — טלפון super admin

### SMS (019SMS)
- `SMS019_USER_NAME` — שם משתמש
- `SMS019_ACCESS_TOKEN` — טוקן גישה
- `SMS019_SOURCE` — מזהה שולח

### Email (SendGrid)
- `SENDGRID_API_KEY` — מפתח API
- `DEFAULT_FROM_EMAIL` — כתובת שולח
- `DEFAULT_FROM_NAME` — שם שולח

**הערה:** כל ה-credentials יכולים להיות מוגדרים ברמת טנאנט (מוצפנים ב-DB) או ברמת מערכת (env vars).

---

## 📊 תרשים זרימה מקוצר

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Login Page │────▶│ request-login│────▶│  Find User  │
│  (React)    │     │  (API)       │     │  in MongoDB │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                    ┌──────▼───────┐      ┌──────▼──────┐
                    │  Generate    │      │  Check Lock │
                    │  6-digit OTP │      │  & Attempts │
                    └──────┬───────┘      └─────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──┐  ┌──────▼──┐  ┌─────▼────┐
       │ SMS 019 │  │SendGrid │  │ Skip OTP │
       │ (phone) │  │ (email) │  │(test mode)│
       └─────────┘  └─────────┘  └──────┬───┘
                                        │
┌─────────────┐     ┌──────────────┐    │
│  OTP Input  │────▶│ verify-login │────┘
│  (React)    │     │  (API)       │
└─────────────┘     └──────┬───────┘
                           │
                    ┌──────▼───────┐     ┌─────────────┐
                    │Create Session│────▶│ Return Token │
                    │ (MongoDB)    │     │ + User Data  │
                    └──────────────┘     └─────────────┘
```
