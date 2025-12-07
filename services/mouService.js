const { supabaseAdmin } = require("../supabase/client");

class MOUService {
  /**
   * Generate MOU document for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<{success: boolean, mouContent?: string, mouHtml?: string, error?: string}>}
   */
  async generateMOU(conversationId) {
    try {
      console.log(`📄 [MOU] Generating MOU for conversation: ${conversationId}`);

      // Fetch conversation details with related data
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(`
          *,
          brand_owner:users!conversations_brand_owner_id_fkey(id, name, email, phone, brand_name),
          influencer:users!conversations_influencer_id_fkey(id, name, email, phone),
          campaigns(id, title, description, budget)
        `)
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Log fetched data for debugging
      console.log(`📋 [MOU] Fetched conversation data:`, {
        conversation_id: conversationId,
        brand_owner: conversation.brand_owner ? {
          id: conversation.brand_owner.id,
          name: conversation.brand_owner.name,
          brand_name: conversation.brand_owner.brand_name
        } : null,
        influencer: conversation.influencer ? {
          id: conversation.influencer.id,
          name: conversation.influencer.name
        } : null,
        campaign_id: conversation.campaign_id,
        campaign_title: conversation.campaigns?.title
      });

      // Get payment breakdown
      const paymentBreakdown = await this.getPaymentBreakdown(conversationId);
      console.log(`💰 [MOU] Payment breakdown:`, paymentBreakdown);

      // Get collaboration details
      const collaborationType = "Campaign";
      const collaborationTitle = conversation.campaigns?.title;
      const collaborationDescription = conversation.campaigns?.description;
      const totalAmount = conversation.campaigns?.budget;

      // Validate required data
      if (!conversation.brand_owner) {
        console.warn(`⚠️ [MOU] Brand owner data missing for conversation ${conversationId}`);
      }
      if (!conversation.influencer) {
        console.warn(`⚠️ [MOU] Influencer data missing for conversation ${conversationId}`);
      }
      if (!collaborationTitle) {
        console.warn(`⚠️ [MOU] Collaboration title missing for conversation ${conversationId}`);
      }
      if (paymentBreakdown.totalAmount === 0) {
        console.warn(`⚠️ [MOU] Payment amount is 0 for conversation ${conversationId}`);
      }

      // Generate MOU content (text and HTML)
      const mouData = {
        conversationId,
        brandOwner: conversation.brand_owner,
        influencer: conversation.influencer,
        collaborationType,
        collaborationTitle,
        collaborationDescription,
        totalAmount,
        paymentBreakdown,
        createdAt: conversation.created_at,
      };

      const mouText = this.generateMOUText(mouData);
      const mouHtml = this.generateMOUHTML(mouData);

      // Save MOU to mou_documents table
      const { data: mouDocument, error: saveError } = await supabaseAdmin
        .from("mou_documents")
        .upsert({
          conversation_id: conversationId,
          mou_content: mouText,
          mou_html: mouHtml,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'conversation_id',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (saveError) {
        console.error(`❌ [MOU] Failed to save MOU document: ${saveError.message}`);
        throw new Error(`Failed to save MOU: ${saveError.message}`);
      }

      console.log(`✅ [MOU] MOU generated successfully for conversation ${conversationId}`);

      return {
        success: true,
        mouContent: mouText,
        mouHtml: mouHtml,
      };
    } catch (error) {
      console.error("❌ [MOU] Error generating MOU:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get payment breakdown for conversation
   */
  async getPaymentBreakdown(conversationId) {
    try {
      // Check if admin payment tracking exists
      const { data: adminPayment } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle();

      if (adminPayment) {
        return {
          totalAmount: adminPayment.total_amount_paise / 100,
          netAmount: adminPayment.net_amount_paise / 100,
          commissionAmount: adminPayment.commission_amount_paise / 100,
          commissionPercentage: adminPayment.commission_percentage,
          advanceAmount: adminPayment.advance_amount_paise / 100,
          finalAmount: adminPayment.final_amount_paise / 100,
        };
      }

      // If no admin payment tracking, calculate from conversation flow_data
      const { data: conversation } = await supabaseAdmin
        .from("conversations")
        .select("flow_data")
        .eq("id", conversationId)
        .single();

      if (conversation?.flow_data?.agreed_amount) {
        const agreedAmount = conversation.flow_data.agreed_amount;
        // Default commission is 10% if not specified
        const commissionPercentage = conversation.flow_data.commission_percentage || 10;
        const commissionAmount = (agreedAmount * commissionPercentage) / 100;
        const netAmount = agreedAmount - commissionAmount;
        const advanceAmount = (netAmount * 30) / 100;
        const finalAmount = (netAmount * 70) / 100;

        return {
          totalAmount: agreedAmount,
          netAmount: netAmount,
          commissionAmount: commissionAmount,
          commissionPercentage: commissionPercentage,
          advanceAmount: advanceAmount,
          finalAmount: finalAmount,
        };
      }

      // Default values if nothing found
      return {
        totalAmount: 0,
        netAmount: 0,
        commissionAmount: 0,
        commissionPercentage: 10,
        advanceAmount: 0,
        finalAmount: 0,
      };
    } catch (error) {
      console.error("Error getting payment breakdown:", error);
      return {
        totalAmount: 0,
        netAmount: 0,
        commissionAmount: 0,
        commissionPercentage: 10,
        advanceAmount: 0,
        finalAmount: 0,
      };
    }
  }

  /**
   * Generate plain text MOU content
   */
  generateMOUText(data) {
    const {
      conversationId,
      brandOwner,
      influencer,
      collaborationType,
      collaborationTitle,
      collaborationDescription,
      totalAmount,
      paymentBreakdown,
      createdAt,
    } = data;

    const formatDate = (dateString) => {
      if (!dateString) return "N/A";
      const date = new Date(dateString);
      return date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    return `MEMORANDUM OF UNDERSTANDING
Collaboration Agreement

Document ID: ${conversationId}
Date: ${formatDate(createdAt)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PARTIES INVOLVED

Brand Owner:
  Name: ${brandOwner?.name || "N/A"}
  ${brandOwner?.brand_name ? `Brand: ${brandOwner.brand_name}\n` : ""}
  Email: ${brandOwner?.email || "N/A"}
  Phone: ${brandOwner?.phone || "N/A"}

Influencer:
  Name: ${influencer?.name || "N/A"}
  Email: ${influencer?.email || "N/A"}
  Phone: ${influencer?.phone || "N/A"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. COLLABORATION DETAILS

Type: ${collaborationType}
Title: ${collaborationTitle || "N/A"}
${collaborationDescription ? `Description: ${collaborationDescription}\n` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. PAYMENT TERMS

Total Collaboration Amount: ₹${paymentBreakdown.totalAmount.toFixed(2)}
Platform Commission (${paymentBreakdown.commissionPercentage}%): ₹${paymentBreakdown.commissionAmount.toFixed(2)}
Net Amount to Influencer: ₹${paymentBreakdown.netAmount.toFixed(2)}

Payment Schedule:
  • Advance Payment (30%): ₹${paymentBreakdown.advanceAmount.toFixed(2)}
  • Final Payment (70%): ₹${paymentBreakdown.finalAmount.toFixed(2)}

Payment Processing:
  • Advance payment (30% of net amount) will be processed by the platform admin after payment confirmation from brand owner.
  • Final payment (70% of net amount) will be processed by the platform admin after work approval by brand owner.
  • Platform commission of ${paymentBreakdown.commissionPercentage}% will be deducted from the total collaboration amount.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. TERMS AND CONDITIONS

• This Memorandum of Understanding (MOU) outlines the terms of collaboration between the Brand Owner and Influencer.
• The platform (Stoory) acts as an intermediary and facilitates the collaboration process.
• All payments will be processed through the platform's payment system.
• The platform commission of ${paymentBreakdown.commissionPercentage}% is clearly disclosed and will be deducted from the total collaboration amount.
• Work deliverables and timelines should be agreed upon by both parties through the platform's communication system.
• Disputes, if any, should be resolved through the platform's dispute resolution mechanism.
• This MOU is generated automatically upon work assignment and serves as a record of the collaboration agreement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SIGNATURES

Brand Owner: _________________    Date: _________________

Influencer: _________________    Date: _________________

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This document is generated automatically by Stoory Platform
Document ID: ${conversationId} | Generated on: ${formatDate(new Date().toISOString())}
`;
  }

  /**
   * Generate HTML template for MOU
   */
  generateMOUHTML(data) {
    const {
      conversationId,
      brandOwner,
      influencer,
      collaborationType,
      collaborationTitle,
      collaborationDescription,
      totalAmount,
      paymentBreakdown,
      createdAt,
    } = data;

    const formatDate = (dateString) => {
      if (!dateString) return "N/A";
      const date = new Date(dateString);
      return date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memorandum of Understanding - ${collaborationTitle || "Collaboration"}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            padding: 40px;
            background: #fff;
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #007bff;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #007bff;
            font-size: 28px;
            margin-bottom: 10px;
        }
        .header p {
            color: #666;
            font-size: 14px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 20px;
            color: #007bff;
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 10px;
            margin-bottom: 15px;
            font-weight: bold;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        .info-item {
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
        }
        .info-label {
            font-weight: bold;
            color: #555;
            margin-bottom: 5px;
            font-size: 14px;
        }
        .info-value {
            color: #333;
            font-size: 16px;
        }
        .payment-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .payment-table th,
        .payment-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        .payment-table th {
            background-color: #007bff;
            color: white;
            font-weight: bold;
        }
        .payment-table tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        .payment-table .amount {
            text-align: right;
            font-weight: bold;
        }
        .terms {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .terms ul {
            margin-left: 20px;
            margin-top: 10px;
        }
        .terms li {
            margin-bottom: 8px;
        }
        .signature-section {
            margin-top: 50px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
        }
        .signature-box {
            border-top: 2px solid #333;
            padding-top: 10px;
            margin-top: 60px;
        }
        .signature-label {
            font-weight: bold;
            margin-bottom: 5px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            color: #666;
            font-size: 12px;
        }
        .highlight {
            background-color: #fff3cd;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>MEMORANDUM OF UNDERSTANDING</h1>
        <p>Collaboration Agreement</p>
        <p style="margin-top: 10px;">Document ID: ${conversationId}</p>
        <p>Date: ${formatDate(createdAt)}</p>
    </div>

    <div class="section">
        <div class="section-title">1. Parties Involved</div>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Brand Owner</div>
                <div class="info-value">${brandOwner?.name || "N/A"}</div>
                ${brandOwner?.brand_name ? `<div class="info-value" style="margin-top: 5px; color: #666;">${brandOwner.brand_name}</div>` : ""}
                <div class="info-value" style="margin-top: 5px; font-size: 14px; color: #666;">
                    ${brandOwner?.email || ""}<br>
                    ${brandOwner?.phone || ""}
                </div>
            </div>
            <div class="info-item">
                <div class="info-label">Influencer</div>
                <div class="info-value">${influencer?.name || "N/A"}</div>
                <div class="info-value" style="margin-top: 5px; font-size: 14px; color: #666;">
                    ${influencer?.email || ""}<br>
                    ${influencer?.phone || ""}
                </div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">2. Collaboration Details</div>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Type</div>
                <div class="info-value">${collaborationType}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Title</div>
                <div class="info-value">${collaborationTitle || "N/A"}</div>
            </div>
        </div>
        ${collaborationDescription ? `
        <div class="info-item" style="margin-top: 15px;">
            <div class="info-label">Description</div>
            <div class="info-value">${collaborationDescription}</div>
        </div>
        ` : ""}
    </div>

    <div class="section">
        <div class="section-title">3. Payment Terms</div>
        <table class="payment-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th class="amount">Amount (₹)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Total Collaboration Amount</td>
                    <td class="amount">₹${paymentBreakdown.totalAmount.toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Platform Commission (${paymentBreakdown.commissionPercentage}%)</td>
                    <td class="amount">₹${paymentBreakdown.commissionAmount.toFixed(2)}</td>
                </tr>
                <tr style="background-color: #e7f3ff;">
                    <td><strong>Net Amount to Influencer</strong></td>
                    <td class="amount"><strong>₹${paymentBreakdown.netAmount.toFixed(2)}</strong></td>
                </tr>
                <tr>
                    <td>Advance Payment (30%)</td>
                    <td class="amount">₹${paymentBreakdown.advanceAmount.toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Final Payment (70%)</td>
                    <td class="amount">₹${paymentBreakdown.finalAmount.toFixed(2)}</td>
                </tr>
            </tbody>
        </table>
        <div class="terms" style="margin-top: 20px;">
            <strong>Payment Schedule:</strong>
            <ul>
                <li>Advance payment (30% of net amount) will be processed by the platform admin after payment confirmation from brand owner.</li>
                <li>Final payment (70% of net amount) will be processed by the platform admin after work approval by brand owner.</li>
                <li>Platform commission of <span class="highlight">${paymentBreakdown.commissionPercentage}%</span> will be deducted from the total collaboration amount.</li>
            </ul>
        </div>
    </div>

    <div class="section">
        <div class="section-title">4. Terms and Conditions</div>
        <div class="terms">
            <ul>
                <li>This Memorandum of Understanding (MOU) outlines the terms of collaboration between the Brand Owner and Influencer.</li>
                <li>The platform (Stoory) acts as an intermediary and facilitates the collaboration process.</li>
                <li>All payments will be processed through the platform's payment system.</li>
                <li>The platform commission of <span class="highlight">${paymentBreakdown.commissionPercentage}%</span> is clearly disclosed and will be deducted from the total collaboration amount.</li>
                <li>Work deliverables and timelines should be agreed upon by both parties through the platform's communication system.</li>
                <li>Disputes, if any, should be resolved through the platform's dispute resolution mechanism.</li>
                <li>This MOU is generated automatically upon work assignment and serves as a record of the collaboration agreement.</li>
            </ul>
        </div>
    </div>

    <div class="signature-section">
        <div class="signature-box">
            <div class="signature-label">Brand Owner</div>
            <div style="margin-top: 40px; color: #666;">Signature: _________________</div>
            <div style="margin-top: 10px; color: #666;">Date: _________________</div>
        </div>
        <div class="signature-box">
            <div class="signature-label">Influencer</div>
            <div style="margin-top: 40px; color: #666;">Signature: _________________</div>
            <div style="margin-top: 10px; color: #666;">Date: _________________</div>
        </div>
    </div>

    <div class="footer">
        <p>This document is generated automatically by Stoory Platform</p>
        <p>Document ID: ${conversationId} | Generated on: ${formatDate(new Date().toISOString())}</p>
    </div>
</body>
</html>
    `;
  }

}

module.exports = new MOUService();

