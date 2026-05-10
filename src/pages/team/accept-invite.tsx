import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AlertTriangle, UserPlus, Clock } from 'lucide-react';

import { HopsSpinner } from '@/components/HopsSpinner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface InviteDetails {
  email: string;
  invitedBy: string;
  expiresAt: string;
  loginUrl: string;
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const { token } = router.query;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/team/accept-invite?token=${token}`)
      .then((res) => {
        if (!res.ok) {
          return res.json().then((data) => {
            throw new Error(data.error || 'Failed to load invite');
          });
        }
        return res.json();
      })
      .then((data) => {
        setInvite(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted">
        <div className="text-center">
          <HopsSpinner size="lg" className="mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading invite...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <Card className="max-w-md w-full p-8">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Invalid Invite</h2>
            <p className="text-muted-foreground mb-6">{error}</p>
            <Link href="/">
              <Button variant="ghost">Go to homepage</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!invite) return null;

  const expiresIn = new Date(invite.expiresAt).getTime() - new Date().getTime();
  const daysLeft = Math.floor(expiresIn / (1000 * 60 * 60 * 24));

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <Card className="max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="mb-4 flex justify-center">
            <UserPlus className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">Team Invitation</h1>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited by
            </p>
            <p className="font-medium">{invite.invitedBy}</p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              To join with email
            </p>
            <p className="font-medium">{invite.email}</p>
          </div>

          {daysLeft > 0 && (
            <div className="flex items-center mt-4">
              <Clock className="h-4 w-4 text-muted-foreground mr-2" />
              <p className="text-sm text-muted-foreground">
                Expires in{' '}
                <span className="font-medium text-foreground">
                  {daysLeft} {daysLeft === 1 ? 'day' : 'days'}
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-3">
            <Checkbox
              id="terms"
              checked={termsAccepted}
              onCheckedChange={(c) => setTermsAccepted(c === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="terms"
              className="text-sm font-normal cursor-pointer"
            >
              I agree to the{' '}
              <Link
                href="/terms"
                target="_blank"
                className="text-primary hover:underline"
              >
                Terms of Service
              </Link>
              ,{' '}
              <Link
                href="/aup"
                target="_blank"
                className="text-primary hover:underline"
              >
                Acceptable Use Policy
              </Link>
              , and{' '}
              <Link
                href="/privacy"
                target="_blank"
                className="text-primary hover:underline"
              >
                Privacy Policy
              </Link>
            </Label>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="marketing"
              checked={marketingConsent}
              onCheckedChange={(c) => setMarketingConsent(c === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="marketing"
              className="text-sm font-normal cursor-pointer text-muted-foreground"
            >
              I would like to receive product updates and marketing
              communications (optional)
            </Label>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            className="w-full"
            disabled={!termsAccepted}
            onClick={() => {
              sessionStorage.setItem('terms_accepted', 'true');
              sessionStorage.setItem(
                'marketing_consent',
                marketingConsent ? 'true' : 'false',
              );
              window.location.href = invite.loginUrl;
            }}
          >
            Accept Invitation
          </Button>
          <Link href="/" className="block">
            <Button variant="ghost" className="w-full">
              Cancel
            </Button>
          </Link>
        </div>

        <div className="mt-6 p-4 bg-muted rounded-md">
          <p className="text-sm text-muted-foreground">
            By accepting this invitation, you&apos;ll join the team and your
            usage will be billed to the account owner.
          </p>
        </div>
      </Card>
    </div>
  );
}
