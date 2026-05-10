import React from 'react';
import Head from 'next/head';

import Layout from '@/components/Layout';

export default function AcceptableUsePolicy() {
  return (
    <>
      <Head>
        <title>Acceptable Use Policy - Hopsworks Managed</title>
        <meta name="description" content="Acceptable Use Policy for Hopsworks Managed platform" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      
      <Layout className="py-10 px-5">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Acceptable Use Policy</h1>
          <p className="text-sm text-muted-foreground mb-8">Last updated: September 2025</p>
          
          <div className="prose prose-gray max-w-none space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">1. Purpose</h2>
              <p className="text-foreground leading-relaxed">
                This Acceptable Use Policy (&ldquo;AUP&rdquo;) governs your use of the Hopsworks Managed platform 
                and services provided by Hopsworks AB. This policy is designed to ensure the security, 
                availability, and integrity of our services for all users.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">2. Prohibited Activities</h2>
              <p className="text-foreground leading-relaxed mb-4">
                You may not use our Service to:
              </p>

              <div className="space-y-4">
                <div>
                  <p className="font-medium text-foreground mb-2">Illegal Activities:</p>
                  <div className="ml-4">
                    <p className="text-foreground leading-relaxed">• Violate any applicable laws, regulations, or legal requirements</p>
                    <p className="text-foreground leading-relaxed">• Infringe on intellectual property rights of others</p>
                    <p className="text-foreground leading-relaxed">• Engage in fraudulent, deceptive, or misleading activities</p>
                    <p className="text-foreground leading-relaxed">• Facilitate money laundering or terrorist financing</p>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-2">Security Violations:</p>
                  <div className="ml-4">
                    <p className="text-foreground leading-relaxed">• Attempt unauthorized access to accounts, systems, or networks</p>
                    <p className="text-foreground leading-relaxed">• Probe, scan, or test the vulnerability of our systems</p>
                    <p className="text-foreground leading-relaxed">• Circumvent authentication or security measures</p>
                    <p className="text-foreground leading-relaxed">• Introduce malware, viruses, or malicious code</p>
                    <p className="text-foreground leading-relaxed">• Attempt to decrypt or reverse engineer our services</p>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-2">Abuse and Misuse:</p>
                  <div className="ml-4">
                    <p className="text-foreground leading-relaxed">• Send spam, unsolicited communications, or phishing attempts</p>
                    <p className="text-foreground leading-relaxed">• Host or distribute harmful, offensive, or illegal content</p>
                    <p className="text-foreground leading-relaxed">• Impersonate others or misrepresent your identity</p>
                    <p className="text-foreground leading-relaxed">• Harass, threaten, or abuse other users or our staff</p>
                    <p className="text-foreground leading-relaxed">• Use excessive resources that impact service performance</p>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-2">Commercial Restrictions:</p>
                  <div className="ml-4">
                    <p className="text-foreground leading-relaxed">• Resell or redistribute our services without authorization</p>
                    <p className="text-foreground leading-relaxed">• Use our services to compete directly with Hopsworks offerings</p>
                    <p className="text-foreground leading-relaxed">• Create derivative works based on our proprietary technology</p>
                    <p className="text-foreground leading-relaxed">• Use our services for cryptocurrency mining without approval</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">3. Data and Content Restrictions</h2>
              <p className="text-foreground leading-relaxed mb-4">
                The following types of data are prohibited unless explicitly authorized:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Personal Health Information (PHI) without HIPAA compliance</p>
                <p className="text-foreground leading-relaxed">• Payment Card Industry (PCI) data without proper authorization</p>
                <p className="text-foreground leading-relaxed">• Classified or export-controlled information</p>
                <p className="text-foreground leading-relaxed">• Biometric data without explicit consent and safeguards</p>
                <p className="text-foreground leading-relaxed">• Data obtained through unauthorized means</p>
                <p className="text-foreground leading-relaxed">• Content that violates third-party privacy rights</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">4. Resource Usage</h2>
              <p className="text-foreground leading-relaxed mb-4">
                You agree to use resources responsibly:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Monitor and optimize your resource consumption</p>
                <p className="text-foreground leading-relaxed">• Avoid activities that could degrade service performance for other users</p>
                <p className="text-foreground leading-relaxed">• Implement appropriate safeguards for long-running processes</p>
                <p className="text-foreground leading-relaxed">• Clean up unused resources and data promptly</p>
                <p className="text-foreground leading-relaxed">• Report any suspicious resource usage patterns</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">5. Compliance Requirements</h2>
              <p className="text-foreground leading-relaxed">
                If your use case involves regulated data or industries, you must ensure compliance with 
                relevant regulations including GDPR, CCPA, HIPAA, PCI-DSS, SOC 2, and industry-specific 
                requirements. You are responsible for implementing appropriate controls and obtaining 
                necessary certifications.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">6. Monitoring and Enforcement</h2>
              <p className="text-foreground leading-relaxed">
                We monitor our services for compliance with this AUP and may investigate suspected 
                violations. We reserve the right to suspend or terminate accounts that violate this 
                policy, remove violating content, and cooperate with law enforcement when required.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">7. Reporting Violations</h2>
              <p className="text-foreground leading-relaxed mb-4">
                If you become aware of activities that violate this AUP, please report them immediately:
              </p>
              <div className="ml-6">
                <p className="text-foreground">Email: info@hopsworks.ai</p>
                <p className="text-foreground">Subject: AUP Violation Report</p>
                <p className="text-foreground">Include: Detailed description, evidence, and your contact information</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">8. Consequences of Violations</h2>
              <p className="text-foreground leading-relaxed mb-4">
                Violations may result in:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Warning and required corrective action</p>
                <p className="text-foreground leading-relaxed">• Temporary suspension of service access</p>
                <p className="text-foreground leading-relaxed">• Permanent account termination</p>
                <p className="text-foreground leading-relaxed">• Legal action where appropriate</p>
                <p className="text-foreground leading-relaxed">• Cooperation with law enforcement investigations</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">9. Appeals Process</h2>
              <p className="text-foreground leading-relaxed">
                If you believe your account was suspended or terminated in error, you may appeal by 
                contacting us at info@hopsworks.ai with &ldquo;AUP Appeal&rdquo; in the subject line. Include 
                your account information and explanation of why you believe the action was taken in error.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">10. Changes to This Policy</h2>
              <p className="text-foreground leading-relaxed">
                We may update this AUP as needed to address new threats or requirements. We will notify 
                users of material changes via email or service notifications. Continued use of our services 
                constitutes acceptance of policy updates.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">11. Contact Information</h2>
              <p className="text-foreground leading-relaxed mb-4">
                For questions about this policy:
              </p>
              <div className="ml-6">
                <p className="text-foreground">Hopsworks AB</p>
                <p className="text-foreground">Åsögatan 119</p>
                <p className="text-foreground">116 24 Stockholm, Sweden</p>
                <p className="text-foreground">Email: info@hopsworks.ai</p>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground">
                This Acceptable Use Policy is part of and incorporated into our Terms of Service. 
                Violation of this AUP constitutes a material breach of the Terms of Service.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}