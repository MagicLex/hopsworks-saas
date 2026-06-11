import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { HopsSpinner } from '@/components/HopsSpinner';
import { Button } from '@/components/ui/button';

export default function JoiningTeamPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { token } = router.query;
  const [status, setStatus] = useState<
    'processing' | 'consent' | 'success' | 'error'
  >('processing');
  const [message, setMessage] = useState('Joining team...');

  const attemptJoin = useCallback(
    (billingConsent: boolean) => {
      setStatus('processing');
      setMessage('Joining team...');

      const termsAccepted =
        sessionStorage.getItem('terms_accepted') === 'true';
      const marketingConsent =
        sessionStorage.getItem('marketing_consent') === 'true';

      fetch('/api/team/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          termsAccepted,
          marketingConsent,
          billingConsent,
        }),
      })
        .then(async (res) => ({ ok: res.ok, data: await res.json() }))
        .then(({ data }) => {
          if (data.billingConsentRequired) {
            setStatus('consent');
            setMessage(data.error);
          } else if (data.error) {
            setStatus('error');
            setMessage(data.error);
            sessionStorage.removeItem('user_synced_session');
          } else {
            sessionStorage.removeItem('terms_accepted');
            sessionStorage.removeItem('marketing_consent');

            setStatus('success');
            setMessage('Successfully joined the team!');
            setTimeout(() => {
              router.push('/dashboard?joined=true');
            }, 2000);
          }
        })
        .catch(() => {
          setStatus('error');
          setMessage('Failed to join team. Please try again.');
          sessionStorage.removeItem('user_synced_session');
        });
    },
    [token, router],
  );

  useEffect(() => {
    if (!user || !token) return;
    attemptJoin(false);
  }, [user, token, attemptJoin]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted">
      <div className="text-center max-w-md px-6">
        {status === 'processing' && (
          <>
            <HopsSpinner size="lg" className="mx-auto" />
            <p className="mt-4 text-muted-foreground">{message}</p>
          </>
        )}

        {status === 'consent' && (
          <>
            <AlertTriangle className="h-12 w-12 text-quartz-label-orange mx-auto" />
            <p className="mt-4 text-foreground font-medium">{message}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your projects and data stay in place.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button variant="outline" onClick={() => router.push('/dashboard')}>
                Keep my account as is
              </Button>
              <Button onClick={() => attemptJoin(true)}>
                Accept and join team
              </Button>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-quartz-label-green mx-auto" />
            <p className="mt-4 text-foreground font-medium">{message}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Redirecting to dashboard...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <p className="mt-4 text-foreground font-medium">{message}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the team owner to send you a new invite, or{' '}
              <button
                type="button"
                onClick={() => signOut()}
                className="text-primary hover:underline"
              >
                sign out and try again
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
