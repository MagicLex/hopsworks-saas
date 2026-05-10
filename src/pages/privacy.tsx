import React from 'react';
import Head from 'next/head';

import Layout from '@/components/Layout';

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - Hopsworks Managed</title>
        <meta name="description" content="Privacy Policy for Hopsworks Managed platform" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      
      <Layout className="py-10 px-5">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mb-8">Last updated: September 2025</p>
          
          <div className="prose prose-gray max-w-none space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
              <p className="text-foreground leading-relaxed">
                Hopsworks AB (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) respects your privacy and is committed to protecting 
                your personal data. This Privacy Policy explains how we collect, use, and protect your 
                information when you use the Hopsworks Managed platform (&ldquo;Service&rdquo;).
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
              <div className="space-y-4">
                <div>
                  <p className="font-medium text-foreground mb-2">Account Information:</p>
                  <p className="text-foreground leading-relaxed">
                    Name, email address, company information, and authentication data provided during registration.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Usage Data:</p>
                  <p className="text-foreground leading-relaxed">
                    Information about how you use our Service, including cluster resources, feature usage, 
                    API calls, and performance metrics.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Technical Data:</p>
                  <p className="text-foreground leading-relaxed">
                    IP addresses, browser type, device information, log files, and cookies for service operation.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Customer Data:</p>
                  <p className="text-foreground leading-relaxed">
                    Data you upload, process, or store using our Service. We process this data solely to provide 
                    the Service and do not access it for any other purposes.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
              <p className="text-foreground leading-relaxed mb-4">We use your information to:</p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Provide and maintain our Service</p>
                <p className="text-foreground leading-relaxed">• Process billing and payments</p>
                <p className="text-foreground leading-relaxed">• Communicate with you about your account and service updates</p>
                <p className="text-foreground leading-relaxed">• Provide customer support</p>
                <p className="text-foreground leading-relaxed">• Improve our Service and develop new features</p>
                <p className="text-foreground leading-relaxed">• Comply with legal obligations</p>
                <p className="text-foreground leading-relaxed">• Ensure security and prevent fraud</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">4. Information Sharing</h2>
              <p className="text-foreground leading-relaxed mb-4">
                We do not sell your personal information. We may share information in these limited circumstances:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• With service providers who assist in operating our Service (Stripe, Auth0, AWS)</p>
                <p className="text-foreground leading-relaxed">• When required by law or to protect our rights</p>
                <p className="text-foreground leading-relaxed">• In connection with a merger, sale, or transfer of assets</p>
                <p className="text-foreground leading-relaxed">• With your explicit consent</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">5. Data Security</h2>
              <p className="text-foreground leading-relaxed">
                We implement industry-standard security measures to protect your data, including encryption 
                in transit and at rest, access controls, regular security assessments, and compliance with 
                relevant security frameworks. However, no internet transmission is completely secure.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">6. Data Retention</h2>
              <p className="text-foreground leading-relaxed">
                We retain your personal information for as long as necessary to provide the Service and comply 
                with legal obligations. Customer data is retained according to your account settings and service 
                usage. You can delete your data through the Service or by contacting us.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">7. International Data Transfers</h2>
              <p className="text-foreground leading-relaxed">
                Your data may be transferred to and processed in countries outside the European Economic Area. 
                We ensure appropriate safeguards are in place, including Standard Contractual Clauses where 
                applicable. See our Data Processing Agreement for details.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">8. Your Rights</h2>
              <p className="text-foreground leading-relaxed mb-4">
                Under applicable data protection laws, you have the right to:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Access your personal information</p>
                <p className="text-foreground leading-relaxed">• Correct inaccurate data</p>
                <p className="text-foreground leading-relaxed">• Delete your personal information</p>
                <p className="text-foreground leading-relaxed">• Restrict processing of your data</p>
                <p className="text-foreground leading-relaxed">• Data portability</p>
                <p className="text-foreground leading-relaxed">• Object to processing</p>
                <p className="text-foreground leading-relaxed">• Withdraw consent where applicable</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">9. Cookies and Tracking</h2>
              <p className="text-foreground leading-relaxed mb-4">
                We use cookies and similar technologies to provide and improve our Service:
              </p>
              <div className="ml-6 space-y-2 mb-4">
                <p className="text-foreground leading-relaxed">
                  • <span className="font-medium">Essential cookies:</span> Required for authentication and core service functionality.
                </p>
                <p className="text-foreground leading-relaxed">
                  • <span className="font-medium">Analytics cookies:</span> Used to understand usage patterns and improve our service
                  (Google Analytics, PostHog). We process this data under <span className="font-medium">legitimate interest</span> (<a href="https://gdpr-info.eu/art-6-gdpr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GDPR Article 6(1)(f)</a>)
                  as it is necessary for improving our B2B service without overriding your rights.
                </p>
              </div>
              <p className="text-foreground leading-relaxed">
                You can control cookie preferences through your browser settings. Blocking analytics cookies
                will not affect your ability to use the Service.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">10. Children&apos;s Privacy</h2>
              <p className="text-foreground leading-relaxed">
                Our Service is not intended for children under 16 years of age. We do not knowingly collect 
                personal information from children under 16. If we become aware of such data, we will delete 
                it promptly.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">11. Changes to This Policy</h2>
              <p className="text-foreground leading-relaxed">
                We may update this Privacy Policy periodically. We will notify you of material changes via 
                email or through the Service. Your continued use of the Service after changes become effective 
                constitutes acceptance of the updated policy.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">12. Contact Us</h2>
              <p className="text-foreground leading-relaxed mb-4">
                For privacy-related questions or to exercise your rights, contact us at:
              </p>
              <div className="ml-6">
                <p className="text-foreground">Hopsworks AB</p>
                <p className="text-foreground">Data Protection Officer</p>
                <p className="text-foreground">Åsögatan 119</p>
                <p className="text-foreground">116 24 Stockholm, Sweden</p>
                <p className="text-foreground">Email: info@hopsworks.ai</p>
                <p className="text-foreground">Subject: Privacy Policy Inquiry</p>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground">
                This Privacy Policy is governed by Swedish data protection law and the General Data Protection 
                Regulation (GDPR) where applicable.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}