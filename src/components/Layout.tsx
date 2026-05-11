import React from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import { EnvironmentBanner } from './EnvironmentBanner';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  className?: string;
}

const Layout: React.FC<LayoutProps> = ({ children, className }) => {
  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <EnvironmentBanner />
      <Navbar />
      <main className={cn('flex-1', className)}>{children}</main>
      <Footer />
    </div>
  );
};

export default Layout;
