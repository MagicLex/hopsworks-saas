import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { UserProfile } from './UserProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useCorporate } from '@/contexts/CorporateContext';

const Navbar: React.FC = () => {
  const { user, signIn } = useAuth();
  const { isCorporate, companyName, companyLogo } = useCorporate();

  return (
    <nav className="border-b border-border bg-background">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href={user ? '/dashboard' : '/'}>
              <Image
                src="/logo_hopsworks.svg"
                alt="Hopsworks"
                width={140}
                height={32}
                className="cursor-pointer"
              />
            </Link>
            {isCorporate && companyName && (
              <div className="flex items-center gap-2 border-l border-border pl-4">
                {companyLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={companyLogo}
                    alt={companyName}
                    className="h-6 w-6 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <span className="text-sm font-medium text-muted-foreground max-w-[150px] truncate">
                  {companyName.length > 20
                    ? `${companyName.substring(0, 20)}...`
                    : companyName}
                </span>
              </div>
            )}
            {!user && (
              <Link href="/pricing">
                <Button variant="ghost" size="default">
                  Pricing
                </Button>
              </Link>
            )}
          </div>
          {user ? (
            <UserProfile />
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="default" onClick={() => signIn()}>
                Log In
              </Button>
              <Button
                size="default"
                onClick={() => signIn(undefined, undefined, 'signup')}
              >
                Sign Up
              </Button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
