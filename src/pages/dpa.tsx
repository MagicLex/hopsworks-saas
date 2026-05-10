import React from 'react';
import Head from 'next/head';

import Layout from '@/components/Layout';

export default function DataProcessingAgreement() {
  return (
    <>
      <Head>
        <title>Data Processing Agreement - Hopsworks Managed</title>
        <meta name="description" content="Data Processing Agreement for Hopsworks Managed platform" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      
      <Layout className="py-10 px-5">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Data Processing Agreement</h1>
          <p className="text-sm text-muted-foreground mb-8">Last updated: September 2025</p>
          
          <div className="prose prose-gray max-w-none space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">1. Introduction and Scope</h2>
              <p className="text-foreground leading-relaxed">
                This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the Terms of Service between you (&ldquo;Controller&rdquo;) 
                and Hopsworks AB (&ldquo;Processor&rdquo;) and governs the processing of personal data in connection with the 
                Hopsworks Managed platform. This DPA applies where and only to the extent that Hopsworks processes 
                personal data on behalf of the Controller.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">2. Definitions</h2>
              <div className="space-y-2">
                <p className="text-foreground leading-relaxed">
                  <strong>Controller:</strong> The entity that determines the purposes and means of processing personal data.
                </p>
                <p className="text-foreground leading-relaxed">
                  <strong>Processor:</strong> The entity that processes personal data on behalf of the Controller.
                </p>
                <p className="text-foreground leading-relaxed">
                  <strong>Personal Data:</strong> Any information relating to an identified or identifiable natural person.
                </p>
                <p className="text-foreground leading-relaxed">
                  <strong>Processing:</strong> Any operation performed on personal data.
                </p>
                <p className="text-foreground leading-relaxed">
                  <strong>Sub-processor:</strong> Any third party appointed by the Processor to process personal data.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">3. Processing Details</h2>
              <div className="space-y-4">
                <div>
                  <p className="font-medium text-foreground mb-2">Subject Matter:</p>
                  <p className="text-foreground leading-relaxed">
                    Provision of machine learning platform services including feature store, model training, 
                    and deployment capabilities.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Duration:</p>
                  <p className="text-foreground leading-relaxed">
                    For the duration of the service agreement and as necessary for compliance with legal obligations.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Purpose:</p>
                  <p className="text-foreground leading-relaxed">
                    To provide the Hopsworks Managed platform services as specified in the Terms of Service.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Categories of Data Subjects:</p>
                  <p className="text-foreground leading-relaxed">
                    End users of Controller&apos;s systems, employees, customers, and other individuals whose 
                    personal data is processed through the platform.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-2">Types of Personal Data:</p>
                  <p className="text-foreground leading-relaxed">
                    The personal data may include identifiers, professional information, usage data, 
                    technical data, and any other personal data uploaded by the Controller.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">4. Processor Obligations</h2>
              <p className="text-foreground leading-relaxed mb-4">Hopsworks will:</p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Process personal data only on documented instructions from the Controller</p>
                <p className="text-foreground leading-relaxed">• Ensure confidentiality of personal data</p>
                <p className="text-foreground leading-relaxed">• Implement appropriate technical and organizational security measures</p>
                <p className="text-foreground leading-relaxed">• Only engage sub-processors with appropriate contractual guarantees</p>
                <p className="text-foreground leading-relaxed">• Assist the Controller in responding to data subject requests</p>
                <p className="text-foreground leading-relaxed">• Assist with compliance, including impact assessments and consultations</p>
                <p className="text-foreground leading-relaxed">• Delete or return personal data upon termination</p>
                <p className="text-foreground leading-relaxed">• Notify the Controller of any personal data breaches</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">5. Controller Obligations</h2>
              <p className="text-foreground leading-relaxed mb-4">The Controller will:</p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Ensure it has legal basis for processing personal data</p>
                <p className="text-foreground leading-relaxed">• Provide clear instructions for personal data processing</p>
                <p className="text-foreground leading-relaxed">• Ensure personal data is accurate and up to date</p>
                <p className="text-foreground leading-relaxed">• Comply with data subject rights and requests</p>
                <p className="text-foreground leading-relaxed">• Maintain appropriate privacy notices</p>
                <p className="text-foreground leading-relaxed">• Not transfer personal data to countries without adequate protection</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">6. Security Measures</h2>
              <p className="text-foreground leading-relaxed">
                Hopsworks implements industry-standard technical and organizational measures including 
                encryption, access controls, employee training, regular security assessments, incident 
                response procedures, and compliance with relevant security frameworks such as SOC 2.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">7. Sub-processing</h2>
              <p className="text-foreground leading-relaxed mb-4">
                Current sub-processors include:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Amazon Web Services (cloud infrastructure)</p>
                <p className="text-foreground leading-relaxed">• Auth0 (authentication services)</p>
                <p className="text-foreground leading-relaxed">• Stripe (payment processing)</p>
                <p className="text-foreground leading-relaxed">• Supabase (database services)</p>
              </div>
              <p className="text-foreground leading-relaxed mt-4">
                We will notify you of any changes to sub-processors and provide opportunity to object to such changes.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">8. International Transfers</h2>
              <p className="text-foreground leading-relaxed">
                Personal data may be transferred to countries outside the EEA. Where such transfers occur, 
                Hopsworks ensures appropriate safeguards are in place, including Standard Contractual Clauses 
                approved by the European Commission or adequacy decisions where available.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibent mb-4">9. Data Subject Rights</h2>
              <p className="text-foreground leading-relaxed">
                Hopsworks will assist the Controller in fulfilling data subject requests including access, 
                rectification, erasure, restriction of processing, data portability, and objection to processing. 
                Such requests should be directed to the Controller in the first instance.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">10. Data Breach Notification</h2>
              <p className="text-foreground leading-relaxed">
                Hopsworks will notify the Controller without undue delay and no later than 72 hours after 
                becoming aware of any personal data breach. The notification will include available information 
                about the breach, its likely consequences, and measures taken to address it.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">11. Data Return and Deletion</h2>
              <p className="text-foreground leading-relaxed">
                Upon termination of services, Hopsworks will delete or return all personal data to the 
                Controller as instructed, unless retention is required by applicable law. The Controller 
                has 30 days to request data return before automatic deletion occurs.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">12. Audits and Compliance</h2>
              <p className="text-foreground leading-relaxed">
                Hopsworks will provide reasonable assistance for Controller audits or inspections by 
                regulators. Hopsworks maintains relevant certifications and compliance reports which 
                may be provided in lieu of audits where appropriate.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">13. Liability and Indemnification</h2>
              <p className="text-foreground leading-relaxed">
                Each party is liable for damages caused by its infringement of applicable data protection 
                laws. The Controller will indemnify Hopsworks against claims arising from the Controller&apos;s 
                violation of data protection laws or processing instructions.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">14. Contact Information</h2>
              <p className="text-foreground leading-relaxed mb-4">
                For questions about data processing:
              </p>
              <div className="ml-6">
                <p className="text-foreground">Hopsworks AB</p>
                <p className="text-foreground">Data Protection Officer</p>
                <p className="text-foreground">Åsögatan 119</p>
                <p className="text-foreground">116 24 Stockholm, Sweden</p>
                <p className="text-foreground">Email: info@hopsworks.ai</p>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground">
                This DPA is governed by Swedish law and shall be interpreted in accordance with applicable 
                EU data protection law including the General Data Protection Regulation (GDPR).
              </p>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}