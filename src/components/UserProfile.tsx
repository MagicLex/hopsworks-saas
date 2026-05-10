import React from 'react';
import { useRouter } from 'next/router';
import {
  User,
  LogOut,
  Settings,
  CreditCard,
  Activity,
  Shield,
  ChevronDown,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useAdmin } from '@/hooks/useAdmin';
import { ADMIN_ROUTE } from '@/config/admin';

export const UserProfile: React.FC = () => {
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const router = useRouter();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="default"
          className="flex items-center gap-2 max-w-[220px]"
        >
          <User className="size-4 shrink-0" />
          <span className="truncate">{user.email}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <div className="px-1.5 pb-1.5 font-mono text-xs truncate text-foreground">
          {user.email}
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push('/dashboard')}>
          <Activity className="size-4" />
          Dashboard
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push('/dashboard?tab=billing')}
        >
          <CreditCard className="size-4" />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push('/dashboard?tab=settings')}
        >
          <Settings className="size-4" />
          Account Settings
        </DropdownMenuItem>

        {isAdmin && (
          <DropdownMenuItem onClick={() => router.push(ADMIN_ROUTE)}>
            <Shield className="size-4" />
            Admin Dashboard
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => signOut()}>
          <LogOut className="size-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
