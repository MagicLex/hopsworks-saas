import React, { useState } from 'react';
import Head from 'next/head';
import { Cpu, HardDrive, Database, Server, Activity } from 'lucide-react';

import Layout from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePricing } from '@/contexts/PricingContext';
import { useAuth } from '@/contexts/AuthContext';

export default function Pricing() {
  const { pricing } = usePricing();
  const { signIn } = useAuth();

  const [cpuHours, setCpuHours] = useState(176);
  const [ramGbHours, setRamGbHours] = useState(2816);
  const [storageOnlineGb, setStorageOnlineGb] = useState(100);
  const [storageOfflineGb, setStorageOfflineGb] = useState(1000);

  const calculateMonthlyCost = () => {
    const cpu = cpuHours * pricing.cpu_hour;
    const ram = ramGbHours * pricing.ram_gb_hour;
    const onlineStorage = storageOnlineGb * pricing.storage_online_gb;
    const offlineStorage = storageOfflineGb * pricing.storage_offline_gb;
    return cpu + ram + onlineStorage + offlineStorage;
  };

  const monthlyCost = calculateMonthlyCost();
  const computeCreditsUsed = monthlyCost / pricing.compute_credits;

  return (
    <>
      <Head>
        <title>Pricing - Hopsworks Managed | Pay-As-You-Go ML Platform</title>
        <meta
          name="description"
          content="Simple, transparent pricing for Hopsworks. Pay only for what you use. No upfront costs, no hidden fees. Start free and scale as you grow."
        />
        <link rel="canonical" href="https://run.hopsworks.ai/pricing" />

        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://run.hopsworks.ai/pricing" />
        <meta
          property="og:title"
          content="Pricing - Hopsworks Managed | Pay-As-You-Go ML Platform"
        />
        <meta
          property="og:description"
          content="Simple, transparent pricing for Hopsworks. Pay only for what you use. No upfront costs, no hidden fees."
        />
        <meta
          property="og:image"
          content="https://cdn.prod.website-files.com/5f6353590bb01cacbcecfbac/60917a423cdde50b5a00feeb_og-hopsworks.png"
        />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://run.hopsworks.ai/pricing" />
        <meta
          name="twitter:title"
          content="Pricing - Hopsworks Managed | Pay-As-You-Go ML Platform"
        />
        <meta
          name="twitter:description"
          content="Simple, transparent pricing for Hopsworks. Pay only for what you use. No upfront costs, no hidden fees."
        />
        <meta
          name="twitter:image"
          content="https://cdn.prod.website-files.com/5f6353590bb01cacbcecfbac/60917a423cdde50b5a00feeb_og-hopsworks.png"
        />
      </Head>
      <Layout className="py-16 px-5">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <h1 className="text-2xl font-semibold mb-2">Pricing</h1>
            <p className="text-sm text-muted-foreground">
              Pay only for what you use. No hidden fees.
            </p>
          </div>

          <div className="flex flex-col gap-5 mb-12">
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-4">Base Rates</h3>
              <div className="flex flex-col gap-3">
                <RateRow
                  icon={<Activity size={16} className="text-muted-foreground" />}
                  label="Compute Credits"
                  price={`$${pricing.compute_credits.toFixed(2)}/credit`}
                />
                <RateRow
                  icon={<Database size={16} className="text-muted-foreground" />}
                  label="Online Storage"
                  price={`$${pricing.storage_online_gb.toFixed(2)}/GB/month`}
                />
                <RateRow
                  icon={<HardDrive size={16} className="text-muted-foreground" />}
                  label="Offline Storage"
                  price={`$${pricing.storage_offline_gb.toFixed(2)}/GB/month`}
                />
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold mb-4">Compute Resources</h3>
              <div className="flex flex-col gap-3">
                <RateRow
                  icon={<Cpu size={16} className="text-muted-foreground" />}
                  label="CPU Hour"
                  price={`$${pricing.cpu_hour.toFixed(4)}/hour`}
                />
                <RateRow
                  icon={<Server size={16} className="text-muted-foreground" />}
                  label="RAM GB Hour"
                  price={`$${pricing.ram_gb_hour.toFixed(4)}/GB-hour`}
                />
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-6">Cost Calculator</h3>

            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-3">
                Quick presets:
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCpuHours(176);
                    setRamGbHours(2816);
                    setStorageOnlineGb(100);
                    setStorageOfflineGb(1000);
                  }}
                  className="text-xs"
                >
                  Small Team (1-2 people)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCpuHours(880);
                    setRamGbHours(14080);
                    setStorageOnlineGb(500);
                    setStorageOfflineGb(5000);
                  }}
                  className="text-xs"
                >
                  Medium Team (5-10 people)
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <CalcInput
                label="CPU Hours/month"
                value={cpuHours}
                onChange={setCpuHours}
                cost={cpuHours * pricing.cpu_hour}
              />
              <CalcInput
                label="RAM GB-Hours/month"
                value={ramGbHours}
                onChange={setRamGbHours}
                cost={ramGbHours * pricing.ram_gb_hour}
              />
              <CalcInput
                label="Online Storage (GB)"
                value={storageOnlineGb}
                onChange={setStorageOnlineGb}
                cost={storageOnlineGb * pricing.storage_online_gb}
              />
              <CalcInput
                label="Offline Storage (GB)"
                value={storageOfflineGb}
                onChange={setStorageOfflineGb}
                cost={storageOfflineGb * pricing.storage_offline_gb}
              />
            </div>

            <div className="bg-muted p-6 rounded-lg border border-border">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-muted-foreground">
                  Estimated Monthly Cost
                </span>
                <span className="text-2xl font-mono font-bold">
                  ${monthlyCost.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Compute Credits Used
                </span>
                <span className="text-sm font-mono font-semibold">
                  {computeCreditsUsed.toFixed(2)} credits
                </span>
              </div>
            </div>
          </Card>

          <div className="flex justify-center gap-4 mt-12">
            <Button onClick={() => signIn(undefined, 'signup')}>
              Get Started
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                window.open('https://www.hopsworks.ai/contact/main', '_blank')
              }
            >
              Contact Sales
            </Button>
          </div>
        </div>
      </Layout>
    </>
  );
}

function RateRow({
  icon,
  label,
  price,
}: {
  icon: React.ReactNode;
  label: string;
  price: string;
}) {
  return (
    <div className="flex justify-between items-center pb-3 border-b border-border">
      <span className="inline-flex items-center gap-2">
        {icon}
        <span className="text-sm">{label}</span>
      </span>
      <span className="text-sm font-mono font-semibold">{price}</span>
    </div>
  );
}

function CalcInput({
  label,
  value,
  onChange,
  cost,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  cost: number;
}) {
  return (
    <div>
      <Input
        label={label}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono"
      />
      <p className="text-xs text-muted-foreground mt-1 font-mono">
        ${cost.toFixed(2)}/month
      </p>
    </div>
  );
}
