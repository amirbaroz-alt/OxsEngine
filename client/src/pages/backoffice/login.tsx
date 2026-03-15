import { useState, useRef, useEffect } from "react";
import { useBackofficeAuth } from "@/lib/backoffice-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, Phone, Mail, ArrowRight } from "lucide-react";

type LoginMode = "phone" | "email";
type Step = "identifier" | "otp";

// SSO provider definition — wire real implementation here in the future
const SSO_PROVIDERS = [
  {
    id: "microsoft",
    label: "Microsoft / 365",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <rect x="1" y="1" width="10" height="10" fill="#F25022" />
        <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
        <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
        <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
      </svg>
    ),
  },
  {
    id: "google",
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
  },
] as const;

export default function BackofficeLoginPage() {
  const { login, isAuthenticated } = useBackofficeAuth();

  const [mode, setMode] = useState<LoginMode>("phone");
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const otpRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isAuthenticated) window.location.href = "/backoffice";
  }, [isAuthenticated]);

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  useEffect(() => {
    if (step !== "otp") return;
    const focusTimer = setTimeout(() => {
      otpRef.current?.querySelector("input")?.focus();
    }, 100);
    return () => clearTimeout(focusTimer);
  }, [step]);

  function startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) { clearInterval(countdownRef.current!); countdownRef.current = null; return 0; }
        return p - 1;
      });
    }, 1000);
  }

  function switchMode(m: LoginMode) {
    setMode(m); setStep("identifier"); setIdentifier(""); setOtp(""); setError("");
  }

  async function handleRequestLogin(e?: React.FormEvent) {
    e?.preventDefault();
    setError(""); setIsLoading(true);
    try {
      const res = await fetch("/api/v1/auth/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // no tenantId — superadmin is not scoped to a tenant
        body: JSON.stringify({ identifier: identifier.trim(), mode, language: "he" }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error === "USER_NOT_FOUND" ? "משתמש לא נמצא" :
                 data.error === "ACCOUNT_LOCKED" ? "החשבון נעול" :
                 data.error === "TOO_MANY_REQUESTS" ? "יותר מדי ניסיונות, נסה שוב מאוחר יותר" :
                 "כניסה נכשלה");
        return;
      }
      // test mode: superadmin bypasses OTP
      if (!data.requiresOtp && data.token) {
        const u = data.user;
        login(data.token, {
          userId: u._id ?? u.userId ?? u.sub,
          tenantId: u.tenantId,
          role: u.role,
          name: u.name ?? "",
        });
        return;
      }
      setStep("otp"); startCountdown();
    } catch { setError("שגיאת רשת"); }
    finally { setIsLoading(false); }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setIsLoading(true);
    try {
      const res = await fetch("/api/v1/auth/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // no tenantId — superadmin is not scoped to a tenant
        body: JSON.stringify({ identifier: identifier.trim(), mode, otp }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error === "INVALID_OTP" ? "קוד שגוי" : "אימות נכשל");
        setOtp(""); return;
      }
      const u = data.user;
      login(data.token, {
        userId: u._id ?? u.userId ?? u.sub,
        tenantId: u.tenantId,
        role: u.role,
        name: u.name ?? "",
      });
    } catch { setError("שגיאת רשת"); }
    finally { setIsLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4" dir="rtl">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center space-y-3 pb-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">OxsEngine Backoffice</CardTitle>
          <p className="text-sm text-muted-foreground">גישה למנהל מערכת בלבד</p>
        </CardHeader>

        <CardContent className="space-y-5">
          {step === "identifier" && (
            <div className="flex gap-1 p-1 rounded-md bg-muted">
              <Button type="button" variant={mode === "phone" ? "default" : "ghost"} size="sm"
                className="flex-1 gap-2" onClick={() => switchMode("phone")}>
                <Phone className="h-4 w-4" /> טלפון
              </Button>
              <Button type="button" variant={mode === "email" ? "default" : "ghost"} size="sm"
                className="flex-1 gap-2" onClick={() => switchMode("email")}>
                <Mail className="h-4 w-4" /> אימייל
              </Button>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "identifier" ? (
            <form onSubmit={handleRequestLogin} className="space-y-4">
              <div className="space-y-2">
                <Label>{mode === "phone" ? "מספר טלפון" : "כתובת אימייל"}</Label>
                <Input
                  type={mode === "phone" ? "tel" : "email"}
                  dir="ltr"
                  className="text-end"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={mode === "phone" ? "050-1234567" : "admin@example.com"}
                  required disabled={isLoading} autoFocus
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={isLoading || !identifier.trim()}>
                {isLoading ? "שולח..." : "המשך"} {!isLoading && <ArrowRight className="h-4 w-4 rotate-180" />}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-3 text-center">
                <Label>קוד אימות</Label>
                <p className="text-sm text-muted-foreground">
                  קוד נשלח אל <span dir="ltr" className="font-medium text-foreground">{identifier}</span>
                </p>
                <div className="flex justify-center py-2" ref={otpRef}>
                  <InputOTP value={otp} onChange={setOtp} maxLength={6} disabled={isLoading} autoFocus>
                    <InputOTPGroup dir="ltr">
                      {[0,1,2,3,4,5].map((i) => <InputOTPSlot key={i} index={i} />)}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {countdown > 0 && (
                  <p className="text-xs text-muted-foreground">שלח שוב בעוד {countdown} שניות</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isLoading || otp.length < 6}>
                {isLoading ? "מאמת..." : "אמת והיכנס"}
              </Button>
              <div className="flex justify-between text-sm">
                <Button type="button" variant="ghost" className="p-0 h-auto text-xs"
                  onClick={() => { setStep("identifier"); setOtp(""); setError(""); }}>
                  שנה {mode === "phone" ? "טלפון" : "אימייל"}
                </Button>
                <Button type="button" variant="ghost" className="p-0 h-auto text-xs"
                  disabled={countdown > 0}
                  onClick={() => handleRequestLogin()}>
                  שלח שוב
                </Button>
              </div>
            </form>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">או</span>
            </div>
          </div>

          <div className="space-y-2">
            {SSO_PROVIDERS.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                className="w-full gap-3 opacity-50 cursor-not-allowed"
                disabled
                title="בקרוב"
                // TODO: implement SSO — call GET /api/v1/auth/sso/:provider
                // onClick={() => window.location.href = `/api/v1/auth/sso/${provider.id}`}
              >
                {provider.icon}
                <span className="flex-1 text-start">כניסה עם {provider.label}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">בקרוב</Badge>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
