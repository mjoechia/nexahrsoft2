import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Lock, KeyRound, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];
    if (password.length < 8) {
      errors.push("Password must be at least 8 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number");
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      setError(passwordErrors.join(". "));
      setIsSubmitting(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      setIsSubmitting(false);
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from current password");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });

      const data = await response.json();

      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully",
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      window.location.href = "/dashboard";
    } catch (error: any) {
      console.error("Change password error:", error);
      if (error.message.includes("401")) {
        setError("Current password is incorrect");
      } else if (error.message.includes("400")) {
        setError("Invalid password format. Please check the requirements.");
      } else {
        setError("Failed to change password. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <KeyRound className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center" data-testid="text-page-title">
            Change Your Password
          </CardTitle>
          <CardDescription className="text-center">
            For security reasons, you must change your password before continuing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              This is your first login. Please create a new secure password.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertDescription data-testid="text-error-message">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <PasswordInput
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your temporary password"
                required
                data-testid="input-current-password"
              />
              <p className="text-xs text-muted-foreground">
                Enter the password from your welcome email
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Create a new password"
                required
                minLength={8}
                data-testid="input-new-password"
              />
              <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                <li className={newPassword.length >= 8 ? "text-green-600 dark:text-green-400" : ""}>
                  <Lock className="inline h-3 w-3 mr-1" />
                  At least 8 characters
                </li>
                <li className={/[A-Z]/.test(newPassword) ? "text-green-600 dark:text-green-400" : ""}>
                  <Lock className="inline h-3 w-3 mr-1" />
                  One uppercase letter
                </li>
                <li className={/[a-z]/.test(newPassword) ? "text-green-600 dark:text-green-400" : ""}>
                  <Lock className="inline h-3 w-3 mr-1" />
                  One lowercase letter
                </li>
                <li className={/[0-9]/.test(newPassword) ? "text-green-600 dark:text-green-400" : ""}>
                  <Lock className="inline h-3 w-3 mr-1" />
                  One number
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                required
                data-testid="input-confirm-password"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords don't match</p>
              )}
              {confirmPassword && newPassword === confirmPassword && (
                <p className="text-xs text-green-600 dark:text-green-400">Passwords match</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
              data-testid="button-change-password"
            >
              {isSubmitting ? "Changing Password..." : "Change Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
