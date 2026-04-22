import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface BillingInfo {
  billingMode: 'prepaid' | 'postpaid' | 'free' | 'team' | null;
  hasPaymentMethod: boolean;
  isSuspended?: boolean;
  isTeamMember?: boolean;
  termsAcceptedAt?: string | null;
  marketingConsent?: boolean;
  accountOwner?: {
    email: string;
    name?: string;
  };
  paymentMethodDetails?: {
    type: string;
    card?: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
    last4?: string;
    brand?: string;
  };
  subscriptionStatus?: string;
  prepaidEnabled: boolean;
  spendingCap?: number | null;
  downgradeDeadline?: string | null;
  downgradeInfo?: {
    deadline: string | null;
    projectCount: number;
  } | null;
  currentUsage: {
    cpuHours: string;
    gpuHours: string;
    ramGbHours: string;
    onlineStorageGB: string;
    offlineStorageGB: string;
    currentMonth: {
      computeCost: number;
      storageCost: number;
      total: number;
    };
  };
  creditBalance?: {
    total: number;
    purchased: number;
    free: number;
  };
  creditsBalance?: number;
  currentMonthCost?: number;
  stripeCustomerId?: string;
  invoices: Array<{
    id: string;
    invoice_number: string;
    amount: number;
    status: string;
    created_at: string;
    invoice_url?: string;
    pdf_url?: string;
    total?: number;
    currency?: string;
    period_start?: number;
    period_end?: number;
  }>;
  historicalUsage?: Array<{
    date: string;
    cpu_hours: number;
    gpu_hours: number;
    storage_gb: number;
    total_cost: number;
  }>;
}

interface BillingContextType {
  billing: BillingInfo | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const BillingContext = createContext<BillingContextType | undefined>(undefined);

export const BillingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, synced } = useAuth();
  const hasFetched = useRef(false);

  const fetchBilling = async () => {
    if (!user) {
      setBilling(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/billing');
      if (response.status === 403) {
        // Account soft-deleted server-side while session still valid — force logout.
        window.location.href = '/api/auth/logout';
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch billing data');
      }
      const data = await response.json();
      setBilling(data);
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch billing data');
      setBilling(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch billing AFTER user is synced to DB
    if (!user) {
      setBilling(null);
      setLoading(false);
      hasFetched.current = false;
      return;
    }

    // Wait for sync to complete before fetching billing
    if (!synced) {
      setLoading(true);
      return;
    }

    // Prevent duplicate fetches
    if (hasFetched.current) return;
    hasFetched.current = true;

    fetchBilling();
  }, [user?.sub, synced]);

  return (
    <BillingContext.Provider value={{ billing, loading, error, refetch: fetchBilling }}>
      {children}
    </BillingContext.Provider>
  );
};

export const useBilling = () => {
  const context = useContext(BillingContext);
  if (context === undefined) {
    throw new Error('useBilling must be used within a BillingProvider');
  }
  return context;
};
