import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle, XCircle } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { HopsSpinner } from '@/components/HopsSpinner';

export default function JoiningTeamPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { token } = router.query;
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>(
    'processing',
  );
  const [message, setMessage] = useState('Joining team...');

  useEffect(() => {
    if (!user || !token) return;

    const termsAccepted =
      sessionStorage.getItem('terms_accepted') === 'true';
    const marketingConsent =
      sessionStorage.getItem('marketing_consent') === 'true';

    fetch('/api/team/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, termsAccepted, marketingConsent }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
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
  }, [user, token, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <HopsSpinner size="lg" className="mx-auto" />
            <p className="mt-4 text-muted-foreground">{message}</p>
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
