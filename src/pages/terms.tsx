import React from 'react';
import Head from 'next/head';

import Layout from '@/components/Layout';

export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of Service - Hopsworks Managed</title>
        <meta name="description" content="Terms of Service for Hopsworks Managed platform-as-a-service" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      
      <Layout className="py-10 px-5">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mb-8">Last updated: September 2025</p>
          
          <div className="prose prose-gray max-w-none space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">1. Agreement Overview</h2>
              <p className="text-foreground leading-relaxed">
                This Terms of Service agreement (&ldquo;Agreement&rdquo;) governs your use of the Hopsworks Managed 
                platform-as-a-service (&ldquo;Service&rdquo;) provided by Hopsworks AB (&ldquo;Company&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;).
                By accessing or using our Service, you (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;, or &ldquo;your&rdquo;) agree to be bound by these terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">2. Service Description</h2>
              <p className="text-foreground leading-relaxed mb-4">
                Hopsworks Managed provides a cloud-based machine learning platform that includes:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Feature store and data management capabilities</p>
                <p className="text-foreground leading-relaxed">• ML pipeline orchestration and model training</p>
                <p className="text-foreground leading-relaxed">• Model deployment and serving infrastructure</p>
                <p className="text-foreground leading-relaxed">• Jupyter notebooks and development environment</p>
                <p className="text-foreground leading-relaxed">• Real-time feature serving and data processing</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">3. Account Registration and Use</h2>
              <p className="text-foreground leading-relaxed mb-4">
                To use our Service, you must:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Provide accurate and complete registration information</p>
                <p className="text-foreground leading-relaxed">• Maintain the security of your account credentials</p>
                <p className="text-foreground leading-relaxed">• Be responsible for all activities under your account</p>
                <p className="text-foreground leading-relaxed">• Comply with our Acceptable Use Policy</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">4. Billing and Payment</h2>
              <p className="text-foreground leading-relaxed">
                Our Service operates on a pay-as-you-go model based on actual resource consumption. 
                Charges are calculated using OpenCost metrics from your cluster usage. Payment is 
                processed monthly through Stripe, and you must maintain a valid payment method on file.
                Prepaid credit options are also available.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">5. Data and Privacy</h2>
              <p className="text-foreground leading-relaxed">
                You retain ownership of all data you upload to the Service (&ldquo;Customer Data&rdquo;). 
                We process your data solely to provide the Service and in accordance with our 
                Privacy Policy and Data Processing Agreement. We implement industry-standard 
                security measures to protect your data.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">6. Acceptable Use</h2>
              <p className="text-foreground leading-relaxed mb-4">
                You agree not to:
              </p>
              <div className="ml-6">
                <p className="text-foreground leading-relaxed">• Use the Service for illegal activities or violate applicable laws</p>
                <p className="text-foreground leading-relaxed">• Attempt to gain unauthorized access to our systems or other users&apos; data</p>
                <p className="text-foreground leading-relaxed">• Use the Service to develop competing products or services</p>
                <p className="text-foreground leading-relaxed">• Reverse engineer, decompile, or disassemble any part of the Service</p>
                <p className="text-foreground leading-relaxed">• Process sensitive data (PHI, PCI data) without explicit authorization</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">7. Service Availability</h2>
              <p className="text-foreground leading-relaxed">
                We strive to maintain high service availability but do not guarantee uninterrupted service. 
                Scheduled maintenance will be announced in advance when possible. Our Service Level Agreement 
                details specific uptime commitments and remedies.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
              <p className="text-foreground leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, HOPSWORKS AB SHALL NOT BE LIABLE FOR ANY 
                INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF 
                PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, 
                USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">9. Termination</h2>
              <p className="text-foreground leading-relaxed">
                Either party may terminate this Agreement with 30 days&apos; notice. We may terminate 
                immediately for material breach of these terms. Upon termination, you will retain 
                access to export your data for a reasonable period.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">10. Governing Law</h2>
              <p className="text-foreground leading-relaxed">
                These Terms are governed by the laws of Sweden. Any disputes will be subject to 
                the jurisdiction of Swedish courts.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">11. Contact Information</h2>
              <p className="text-foreground leading-relaxed">
                If you have questions about these Terms, please contact us at:
              </p>
              <div className="mt-4 ml-6">
                <p className="text-foreground">Hopsworks AB</p>
                <p className="text-foreground">Åsögatan 119</p>
                <p className="text-foreground">116 24 Stockholm, Sweden</p>
                <p className="text-foreground">Email: info@hopsworks.ai</p>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground">
                These Terms of Service are effective as of the date you first access the Service and 
                remain in effect until terminated in accordance with the provisions herein.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}