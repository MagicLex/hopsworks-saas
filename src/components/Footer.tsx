import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Slack, Linkedin, Twitter } from 'lucide-react';
import { StatusIndicator } from './StatusIndicator';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [isNonUS, setIsNonUS] = useState(false);

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then((res) => res.json())
      .then((data) => {
        if (data.country_code && data.country_code !== 'US') {
          setIsNonUS(true);
        }
      })
      .catch(() => {
        setIsNonUS(false);
      });
  }, []);

  return (
    <footer className="border-t border-border mt-auto bg-background">
      <div className="max-w-6xl mx-auto px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              © {currentYear} Hopsworks AB
            </span>
            {isNonUS && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">• Crafted in</span>
                <span className="text-base" title="European Union">
                  🇪🇺
                </span>
                <span className="text-base" title="Sweden">
                  🇸🇪
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://join.slack.com/t/public-hopsworks/shared_invite/zt-24fc3hhyq-VBEiN8UZlKsDrrLvtU4NaA"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-[#4A154B] transition-colors"
              title="Join our Slack community"
            >
              <Slack size={18} />
            </a>
            <a
              href="https://www.linkedin.com/company/hopsworks/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-[#0A66C2] transition-colors"
              title="Follow us on LinkedIn"
            >
              <Linkedin size={18} />
            </a>
            <a
              href="https://twitter.com/hopsworks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Follow us on X"
            >
              <Twitter size={18} />
            </a>
          </div>
          <div className="flex gap-4 text-xs">
            <Link
              href="/terms"
              className="text-muted-foreground hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground"
            >
              Privacy
            </Link>
            <a
              href="https://docs.hopsworks.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              Docs
            </a>
            <a
              href="https://www.hopsworks.ai/contact/main"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              Support
            </a>
            <StatusIndicator />
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
