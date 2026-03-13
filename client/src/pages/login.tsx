import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Phone, Mail, ArrowRight, Building2, AlertTriangle } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { formatPhone } from "@/lib/format-utils";

type LoginMode = "phone" | "email";
type Step = "identifier" | "otp";

interface TenantInfo {
  _id: string;
  nameHe: string;
  nameEn: string;
  logo?: string;
}

export default function LoginPage({ slug, noSlugError }: { slug?: string; noSlugError?: boolean }) {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const [mode, setMode] = useState<LoginMode>("phone");
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpContainerRef = useRef<HTMLDivElement>(null);

  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [tenantLoading, setTenantLoading] = useState(!!slug);
  const [tenantError, setTenantError] = useState(false);

  useEffect(() => {
    if (!slug) {
      setTenantLoading(false);
      return;
    }

    let cancelled = false;
    setTenantLoading(true);
    setTenantError(false);

    fetch(`/api/public/tenant/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setTenantInfo(data);
          setTenantLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTenantError(true);
          setTenantLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [slug]);

  const tenantId = tenantInfo?._id;

  const companyName = tenantInfo
    ? (["he", "ar"].includes(i18n.language) ? tenantInfo.nameHe : tenantInfo.nameEn) || tenantInfo.nameHe || tenantInfo.nameEn
    : undefined;

  useEffect(() => {
    if (step !== "otp") return;
    const timer = setTimeout(() => {
      const firstInput = otpContainerRef.current?.querySelector("input");
      if (firstInput) {
        firstInput.focus();
        firstInput.click();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [step]);

  function startCountdown() {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function switchMode(newMode: LoginMode) {
    setMode(newMode);
    setStep("identifier");
    setIdentifier("");
    setOtp("");
    setError("");
  }

  function resetToIdentifier() {
    setStep("identifier");
    setOtp("");
    setError("");
  }

  async function handleRequestLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          mode,
          language: i18n.language,
          ...(tenantId ? { tenantId } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.message === "USER_NOT_FOUND") {
          setError(t("auth.userNotFound"));
        } else if (data.message === "ACCOUNT_LOCKED") {
          setError(t("auth.accountLocked"));
        } else if (data.message === "TOO_MANY_REQUESTS") {
          setError(t("auth.tooManyRequests"));
        } else if (data.message === "DELIVERY_FAILED") {
          setError(t("auth.deliveryFailed"));
        } else {
          setError(t("auth.loginFailed"));
        }
        return;
      }

      if (!data.requiresOtp) {
        localStorage.setItem("login_path", window.location.pathname);
        login(data.token, data.user);
        setLocation("/");
        return;
      }

      setStep("otp");
      startCountdown();
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          mode,
          otp,
          ...(tenantId ? { tenantId } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.message === "INVALID_OTP") {
          setError(t("auth.invalidOtp"));
        } else if (data.message === "TOO_MANY_REQUESTS") {
          setError(t("auth.tooManyRequests"));
        } else {
          setError(t("auth.verificationFailed"));
        }
        setOtp("");
        return;
      }

      localStorage.setItem("login_path", window.location.pathname);
      login(data.token, data.user);
      setLocation("/");
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  if (noSlugError) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <header className="flex items-center justify-end gap-1 p-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold" data-testid="text-no-slug-error">{t("auth.noSlug")}</h2>
              <p className="text-sm text-muted-foreground">{t("auth.noSlugDesc")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-muted-foreground">{t("auth.loadingCompany")}</p>
        </div>
      </div>
    );
  }

  if (tenantError) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <header className="flex items-center justify-end gap-1 p-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold" data-testid="text-company-not-found">{t("auth.companyNotFound")}</h2>
              <p className="text-sm text-muted-foreground">{t("auth.checkUrlOrContact")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (slug && !tenantInfo) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <header className="flex items-center justify-end gap-1 p-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold">{t("auth.invalidCompany")}</h2>
              <p className="text-sm text-muted-foreground">{t("auth.checkUrlOrContact")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background" data-testid="mobile-view">
      <header className="hidden md:flex items-center justify-end gap-1 p-3">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-6 md:p-4">
        <Card className="w-full max-w-none md:max-w-md border-0 shadow-none md:border md:shadow-sm rounded-none md:rounded-xl bg-transparent md:bg-card">
          <CardHeader className="text-center space-y-4 md:space-y-3 px-2 md:px-6 pt-8 md:pt-6">
            {tenantInfo?.logo ? (
              <img
                src={tenantInfo.logo}
                alt={companyName || ""}
                className="mx-auto max-h-24 max-w-[200px] object-contain"
                data-testid="img-company-logo"
              />
            ) : (
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                {companyName ? (
                  <Building2 className="h-6 w-6 text-primary" />
                ) : (
                  <Shield className="h-6 w-6 text-primary" />
                )}
              </div>
            )}
            <CardTitle className="text-xl" data-testid="text-login-title">
              {companyName || t("auth.loginTitle")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("auth.loginSubtitle")}</p>
          </CardHeader>

          <CardContent className="space-y-6 md:space-y-5 px-2 md:px-6">
            {step === "identifier" && (
              <div className="flex gap-1 p-1 rounded-md bg-muted" data-testid="mode-toggle">
                <Button
                  type="button"
                  variant={mode === "phone" ? "default" : "ghost"}
                  className="flex-1 gap-2 h-10 md:h-9"
                  size="sm"
                  onClick={() => switchMode("phone")}
                  data-testid="button-mode-phone"
                >
                  <Phone className="h-4 w-4" />
                  {t("auth.mobileLogin")}
                </Button>
                <Button
                  type="button"
                  variant={mode === "email" ? "default" : "ghost"}
                  className="flex-1 gap-2 h-10 md:h-9"
                  size="sm"
                  onClick={() => switchMode("email")}
                  data-testid="button-mode-email"
                >
                  <Mail className="h-4 w-4" />
                  {t("auth.emailLogin")}
                </Button>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription data-testid="text-login-error">{error}</AlertDescription>
              </Alert>
            )}

            {step === "identifier" ? (
              <form onSubmit={handleRequestLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="identifier" className="text-sm md:text-sm">
                    {mode === "phone" ? t("auth.phone") : t("auth.email")}
                  </Label>
                  <Input
                    id="identifier"
                    data-testid="input-identifier"
                    type={mode === "phone" ? "tel" : "email"}
                    dir="ltr"
                    className="text-end h-12 text-base md:h-10 md:text-sm"
                    value={mode === "phone" ? formatPhone(identifier) : identifier}
                    onChange={(e) => {
                      if (mode === "phone") {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setIdentifier(digits);
                      } else {
                        setIdentifier(e.target.value);
                      }
                    }}
                    placeholder={mode === "phone" ? "050-1234567" : "user@example.com"}
                    required
                    disabled={isLoading}
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full gap-2 h-12 text-base md:h-10 md:text-sm" disabled={isLoading || !identifier.trim()} data-testid="button-request-login">
                  {isLoading ? t("auth.sending") : t("auth.continue")}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-3 text-center">
                  <Label>{t("auth.enterOtp")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {mode === "phone"
                      ? t("auth.otpSentToPhone")
                      : t("auth.otpSentToEmail")}{" "}
                    <span dir="ltr" className="font-medium text-foreground">
                      {mode === "phone" ? formatPhone(identifier) : identifier}
                    </span>
                  </p>

                  <div className="flex justify-center py-3" ref={otpContainerRef}>
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      autoFocus
                      data-testid="input-otp"
                    >
                      <InputOTPGroup dir="ltr">
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {countdown > 0 && (
                    <p className="text-sm text-muted-foreground" data-testid="text-countdown">
                      {t("auth.resendIn")} {countdown} {t("auth.seconds")}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 text-base md:h-10 md:text-sm"
                  disabled={isLoading || otp.length < 6}
                  data-testid="button-verify-otp"
                >
                  {isLoading ? t("auth.verifying") : t("auth.verifyAndLogin")}
                </Button>

                <div className="flex justify-between gap-2 text-sm flex-wrap">
                  <Button
                    type="button"
                    variant="ghost"
                    className="p-0 h-auto"
                    onClick={resetToIdentifier}
                    data-testid="button-change-identifier"
                  >
                    {mode === "phone" ? t("auth.changePhone") : t("auth.changeEmail")}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="p-0 h-auto"
                    disabled={countdown > 0}
                    onClick={() => handleRequestLogin({ preventDefault: () => {} } as React.FormEvent)}
                    data-testid="button-resend-otp"
                  >
                    {t("auth.resendOtp")}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <footer className="text-center p-4 text-xs text-muted-foreground">
        {t("app.version")}
      </footer>
    </div>
  );
}
