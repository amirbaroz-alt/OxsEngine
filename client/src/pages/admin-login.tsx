import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Phone, Mail, ArrowRight } from "lucide-react";
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

export default function AdminLoginPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const [mode, setMode] = useState<LoginMode>("email");
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

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

      login(data.token, data.user);
      setLocation("/");
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-end gap-1 p-3">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl" data-testid="text-admin-login-title">
              {t("auth.adminLogin")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("auth.adminLoginSubtitle")}</p>
          </CardHeader>

          <CardContent className="space-y-5">
            {step === "identifier" && (
              <div className="flex gap-1 p-1 rounded-md bg-muted" data-testid="mode-toggle">
                <Button
                  type="button"
                  variant={mode === "phone" ? "default" : "ghost"}
                  className="flex-1 gap-2"
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
                  className="flex-1 gap-2"
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
                  <Label htmlFor="identifier">
                    {mode === "phone" ? t("auth.phone") : t("auth.email")}
                  </Label>
                  <Input
                    id="identifier"
                    data-testid="input-identifier"
                    type={mode === "phone" ? "tel" : "email"}
                    dir="ltr"
                    className="text-end"
                    value={mode === "phone" ? formatPhone(identifier) : identifier}
                    onChange={(e) => {
                      if (mode === "phone") {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setIdentifier(digits);
                      } else {
                        setIdentifier(e.target.value);
                      }
                    }}
                    placeholder={mode === "phone" ? "050-1234567" : "admin@example.com"}
                    required
                    disabled={isLoading}
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full gap-2" disabled={isLoading || !identifier.trim()} data-testid="button-request-login">
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

                  <div className="flex justify-center py-3">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
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
                  className="w-full"
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
