import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Building2 } from "lucide-react";
import type { CompanySettings } from "@shared/schema";

export default function UserLoginPage() {
  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ["/api/company/settings"],
  });
  const [activeTab, setActiveTab] = useState("login");
  
  // Registration form state
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  // Login form state
  const [loginUsernameOrEmail, setLoginUsernameOrEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);

    try {
      const response = await apiRequest("POST", "/api/auth/register", {
        name,
        username,
        email,
        password,
        confirmPassword,
        mobileNumber,
      });
      const data = await response.json();

      if (data.user.isApproved) {
        // Only invalidate session if user is approved (has a session)
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
        toast({
          title: "Registration Successful!",
          description: "Welcome to NexaHR!",
        });
        setLocation("/dashboard");
      } else {
        // Unapproved users don't get a session, so just show the pending message
        toast({
          title: "Registration Submitted",
          description: "Your account is pending admin approval",
        });
        setLocation("/pending-approval");
      }
    } catch (error: any) {
      const errorMessage = error.message.includes("400") 
        ? "User already exists or invalid data" 
        : "Failed to register. Please try again.";
      
      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);

    console.log('Login attempt started');
    
    try {
      const response = await apiRequest("POST", "/api/auth/login", {
        usernameOrEmail: loginUsernameOrEmail,
        password: loginPassword,
      });
      
      console.log('Login response received:', response.status);
      
      const data = await response.json();

      toast({
        title: "Login Successful",
        description: "Welcome back!",
      });

      console.log('About to redirect, mustChangePassword:', data.user?.mustChangePassword);
      
      // Check if user must change password on first login
      if (data.user?.mustChangePassword) {
        window.location.href = "/change-password";
        return;
      }
      
      // Use window.location for full page reload to ensure session is recognized
      // This avoids race conditions with React Query cache updates
      window.location.href = "/dashboard";
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.statusCode === 401) {
        toast({
          title: "Login Failed",
          description: "Invalid email or password.",
          variant: "destructive",
        });
      } else if (error.statusCode === 403) {
        if (error.message?.includes("deactivated")) {
          toast({
            title: "Account Deactivated",
            description: error.message,
            variant: "destructive",
          });
        } else if (error.message?.toLowerCase().includes("admin login")) {
          toast({
            title: "Wrong Login Page",
            description: "Please use the Admin Login page to sign in.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Account Pending",
            description: "Your account is awaiting admin approval.",
            variant: "destructive",
          });
          setLocation("/pending-approval");
        }
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to login. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            {companySettings?.logoUrl ? (
              <img
                src={companySettings.logoUrl}
                alt={companySettings.companyName}
                className="h-20 w-20 object-contain rounded-full"
                data-testid="img-company-logo"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl text-center">{companySettings?.companyName || "NexaHR"} HRMS</CardTitle>
          <CardDescription className="text-center">
            Access your HR portal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
              <TabsTrigger value="login" data-testid="tab-login">Login</TabsTrigger>
            </TabsList>

            <TabsContent value="register" className="space-y-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                    data-testid="input-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="johndoe"
                    required
                    minLength={3}
                    data-testid="input-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    required
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mobile">Mobile Number</Label>
                  <Input
                    id="mobile"
                    type="tel"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="+1234567890"
                    required
                    data-testid="input-mobile"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    required
                    minLength={8}
                    data-testid="input-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    data-testid="input-confirm-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isRegistering}
                  data-testid="button-register"
                >
                  {isRegistering ? "Registering..." : "Register"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="login" className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="loginUsernameOrEmail">Username or Email</Label>
                  <Input
                    id="loginUsernameOrEmail"
                    type="text"
                    value={loginUsernameOrEmail}
                    onChange={(e) => setLoginUsernameOrEmail(e.target.value)}
                    placeholder="Enter username or email"
                    required
                    data-testid="input-login-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loginPassword">Password</Label>
                  <Input
                    id="loginPassword"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoggingIn}
                  data-testid="button-login"
                >
                  {isLoggingIn ? "Logging in..." : "Login"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleLogin}
            data-testid="button-google-login"
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            <a href="/admin/login" className="underline underline-offset-4 hover:text-primary" data-testid="link-admin-login">
              Admin Login
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
