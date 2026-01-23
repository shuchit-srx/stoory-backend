const { supabaseAdmin } = require('../db/config');

/**
 * MOU Service
 * Handles business logic for MOU operations
 */
class MOUService {
  /**
   * Get the latest MOU for an application
   * @param {string} applicationId - Application UUID
   * @param {string} userId - User ID making the request
   * @param {string} userRole - User role (INFLUENCER, BRAND_OWNER, ADMIN)
   * @returns {Promise<Object>} - Latest MOU or error
   */
  async getLatestMOU(applicationId, userId, userRole) {
    try {
      // First, verify the application exists and user has access
      const { data: application, error: appError } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          id,
          phase,
          influencer_id,
          brand_id,
          v1_campaigns!inner(brand_id)
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (appError) {
        console.error('[MOUService/getLatestMOU] Application fetch error:', appError);
        return { success: false, message: 'Database error' };
      }

      if (!application) {
        return { success: false, message: 'Application not found' };
      }

      // Check access permissions
      if (userRole === 'INFLUENCER') {
        if (application.influencer_id !== userId) {
          return { success: false, message: 'You do not have access to this application' };
        }
      } else if (userRole === 'BRAND_OWNER') {
        // Brand owner access is via campaign's brand_id
        if (application.v1_campaigns.brand_id !== userId) {
          return { success: false, message: 'You do not have access to this application' };
        }
      }
      // ADMIN has access to all

      // Get the latest MOU for this application (by created_at desc)
      const { data: mous, error: mouError } = await supabaseAdmin
        .from('v1_mous')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (mouError) {
        console.error('[MOUService/getLatestMOU] MOU fetch error:', mouError);
        return { success: false, message: 'Database error' };
      }

      if (!mous || mous.length === 0) {
        // If application is ACCEPTED but no MOU exists, try to generate it automatically
        if (application && application.phase === 'ACCEPTED') {
          console.log(`[MOUService/getLatestMOU] No MOU found for ACCEPTED application ${applicationId}, attempting to generate...`);
          const generateResult = await this.generateMOUForApplication(applicationId);
          if (generateResult.success) {
            // Fetch the newly created MOU
            const { data: newMous, error: newMouError } = await supabaseAdmin
              .from('v1_mous')
              .select('*')
              .eq('application_id', applicationId)
              .order('created_at', { ascending: false })
              .limit(1);

            if (!newMouError && newMous && newMous.length > 0) {
              return {
                success: true,
                message: 'MOU generated and fetched successfully',
                data: newMous[0]
              };
            } else {
              console.error(`[MOUService/getLatestMOU] Failed to fetch newly generated MOU:`, newMouError?.message || 'Unknown error');
            }
          } else {
            console.error(`[MOUService/getLatestMOU] Failed to auto-generate MOU: ${generateResult.message}`, generateResult.error || '');
          }
        }

        return { 
          success: true, 
          message: 'No MOU found for this application',
          data: null 
        };
      }

      return {
        success: true,
        message: 'MOU fetched successfully',
        data: mous[0]
      };
    } catch (err) {
      console.error('[MOUService/getLatestMOU] Exception:', err);
      return {
        success: false,
        message: 'Failed to fetch MOU',
        error: err.message
      };
    }
  }

  /**
   * Accept a MOU
   * @param {string} mouId - MOU UUID
   * @param {string} userId - User ID accepting the MOU
   * @param {string} userRole - User role (INFLUENCER or BRAND_OWNER)
   * @returns {Promise<Object>} - Updated MOU or error
   */
  async acceptMOU(mouId, userId, userRole) {
    try {
      // Get the MOU with application details
      const { data: mou, error: mouError } = await supabaseAdmin
        .from('v1_mous')
        .select(`
          *,
          v1_applications!inner(
            id,
            influencer_id,
            brand_id,
            v1_campaigns!inner(brand_id)
          )
        `)
        .eq('id', mouId)
        .maybeSingle();

      if (mouError) {
        console.error('[MOUService/acceptMOU] MOU fetch error:', mouError);
        return { success: false, message: 'Database error' };
      }

      if (!mou) {
        return { success: false, message: 'MOU not found' };
      }

      const application = mou.v1_applications;

      // Validate user has access and can accept
      if (userRole === 'INFLUENCER') {
        if (application.influencer_id !== userId) {
          return { 
            success: false, 
            message: 'Only the influencer associated with this MOU can accept it as influencer' 
          };
        }
      } else if (userRole === 'BRAND_OWNER') {
        if (application.v1_campaigns.brand_id !== userId) {
          return { 
            success: false, 
            message: 'Only the brand owner associated with this MOU can accept it as brand' 
          };
        }
      } else {
        return { 
          success: false, 
          message: 'Only influencers and brand owners can accept MOUs' 
        };
      }

      // Check if already accepted by this party
      if (userRole === 'INFLUENCER' && mou.accepted_by_influencer) {
        return { 
          success: false, 
          message: 'MOU has already been accepted by the influencer' 
        };
      }

      if (userRole === 'BRAND_OWNER' && mou.accepted_by_brand) {
        return { 
          success: false, 
          message: 'MOU has already been accepted by the brand' 
        };
      }

      // Check if MOU is in a state that prevents acceptance
      // CANCELLED and EXPIRED always block acceptance
      if (['CANCELLED', 'EXPIRED'].includes(mou.status)) {
        return { 
          success: false, 
          message: `MOU cannot be accepted. Current status: ${mou.status}` 
        };
      }

      // For ACTIVE status, only block if both parties have actually accepted
      // (This handles cases where admin set status to ACTIVE but parties haven't accepted)
      if (mou.status === 'ACTIVE' && mou.accepted_by_influencer && mou.accepted_by_brand) {
        return { 
          success: false, 
          message: 'MOU has already been fully accepted by both parties' 
        };
      }

      // Prepare update data
      const now = new Date().toISOString();
      const updateData = {};

      if (userRole === 'INFLUENCER') {
        updateData.accepted_by_influencer = true;
        updateData.influencer_accepted_at = now;
      } else if (userRole === 'BRAND_OWNER') {
        updateData.accepted_by_brand = true;
        updateData.brand_accepted_at = now;
      }

      // Determine new status
      const willBeFullyAccepted = 
        (userRole === 'INFLUENCER' && mou.accepted_by_brand) ||
        (userRole === 'BRAND_OWNER' && mou.accepted_by_influencer);

      if (willBeFullyAccepted) {
        updateData.status = 'ACTIVE';
      } else if (mou.status === 'DRAFT') {
        // If status is DRAFT and first party accepts, change to SENT
        updateData.status = 'SENT';
      } else if (mou.status === 'ACTIVE' && !mou.accepted_by_influencer && !mou.accepted_by_brand) {
        // If status was set to ACTIVE by admin but no one has accepted yet, change to SENT on first acceptance
        updateData.status = 'SENT';
      }
      // If status is already SENT, keep it as SENT until both parties accept

      // Update MOU
      const { data: updatedMOU, error: updateError } = await supabaseAdmin
        .from('v1_mous')
        .update(updateData)
        .eq('id', mouId)
        .select()
        .single();

      if (updateError) {
        console.error('[MOUService/acceptMOU] Update error:', updateError);
        return { 
          success: false, 
          message: 'Failed to accept MOU',
          error: updateError.message 
        };
      }

      const fullyAccepted = updatedMOU.accepted_by_influencer && updatedMOU.accepted_by_brand;

      return {
        success: true,
        message: 'MOU accepted successfully',
        data: updatedMOU,
        fullyAccepted
      };
    } catch (err) {
      console.error('[MOUService/acceptMOU] Exception:', err);
      return {
        success: false,
        message: 'Failed to accept MOU',
        error: err.message
      };
    }
  }

  /**
   * Generate MOU for an application automatically when brand owner accepts
   * @param {string} applicationId - Application UUID
   * @returns {Promise<Object>} - Created MOU or error
   */
  async generateMOUForApplication(applicationId) {
    try {
      if (!applicationId) {
        return { success: false, message: 'applicationId is required' };
      }

      // Fetch application with all related data
      const { data: application, error: appError } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          *,
          v1_campaigns(
            *,
            brand_id
          )
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (appError) {
        console.error('[MOUService/generateMOUForApplication] Application fetch error:', appError);
        return { success: false, message: 'Database error', error: appError.message };
      }

      if (!application) {
        return { success: false, message: 'Application not found' };
      }

      // Check if application is in ACCEPTED phase (warn if not, but still proceed if called from accept flow)
      if (application.phase !== 'ACCEPTED') {
        console.warn(`[MOUService/generateMOUForApplication] Warning: Application ${applicationId} is not in ACCEPTED phase (current: ${application.phase}). Proceeding with MOU generation anyway.`);
        // Don't block - allow generation even if phase check fails (might be a timing issue)
      }

      const campaign = application.v1_campaigns;
      if (!campaign) {
        return { success: false, message: 'Campaign not found for this application' };
      }

      // Fetch influencer details
      const { data: influencerUser, error: influencerError } = await supabaseAdmin
        .from('v1_users')
        .select('id, name, email, phone_number')
        .eq('id', application.influencer_id)
        .eq('is_deleted', false)
        .maybeSingle();

      if (influencerError) {
        console.error('[MOUService/generateMOUForApplication] Influencer fetch error:', influencerError);
        console.error('[MOUService/generateMOUForApplication] Influencer ID:', application.influencer_id);
        // Continue with fallback values instead of failing
      }

      if (!influencerUser) {
        console.warn(`[MOUService/generateMOUForApplication] Influencer user not found for ID: ${application.influencer_id}`);
      } else {
        console.log(`[MOUService/generateMOUForApplication] Found influencer: ${influencerUser.name} (${influencerUser.email})`);
      }

      const { data: influencerProfile, error: influencerProfileError } = await supabaseAdmin
        .from('v1_influencer_profiles')
        .select('*')
        .eq('user_id', application.influencer_id)
        .eq('is_deleted', false)
        .maybeSingle();

      if (influencerProfileError) {
        console.warn('[MOUService/generateMOUForApplication] Influencer profile fetch error (non-critical):', influencerProfileError.message);
      }

      // Fetch brand details
      const { data: brandUser, error: brandError } = await supabaseAdmin
        .from('v1_users')
        .select('id, name, email, phone_number')
        .eq('id', campaign.brand_id)
        .eq('is_deleted', false)
        .maybeSingle();

      if (brandError) {
        console.error('[MOUService/generateMOUForApplication] Brand fetch error:', brandError);
        console.error('[MOUService/generateMOUForApplication] Brand ID:', campaign.brand_id);
        // Continue with fallback values instead of failing
      }

      if (!brandUser) {
        console.warn(`[MOUService/generateMOUForApplication] Brand user not found for ID: ${campaign.brand_id}`);
      } else {
        console.log(`[MOUService/generateMOUForApplication] Found brand: ${brandUser.name} (${brandUser.email})`);
      }

      const { data: brandProfile, error: brandProfileError } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('*')
        .eq('user_id', campaign.brand_id)
        .eq('is_deleted', false)
        .maybeSingle();

      if (brandProfileError) {
        console.warn('[MOUService/generateMOUForApplication] Brand profile fetch error (non-critical):', brandProfileError.message);
      }

      // Get financial details from application
      const budget = application.budget_amount || campaign.budget || 0;
      const platformFeePercentage = application.platform_fee_percentage || campaign.platform_fee_percentage || 0;
      const platformFeeAmount = application.platform_fee_amount || campaign.platform_fee_amount || 0;
      const agreedAmount = application.agreed_amount || campaign.net_amount || 0;
      const requiresScript = campaign.requires_script || false;
      const bufferDays = campaign.buffer_days || 0;

      // Get deadlines directly from campaign (all values come from user, no calculations)
      const scriptDeadline = campaign.script_deadline ? new Date(campaign.script_deadline) : null;
      const workDeadline = campaign.work_deadline ? new Date(campaign.work_deadline) : null;
      // Note: buffer_deadline is not in the schema, so it's not used
      const bufferDeadline = null;

      // Format dates
      const formatDate = (date) => {
        if (!date) return 'Not specified';
        return new Date(date).toLocaleDateString('en-IN', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      };

      // Format currency
      const formatCurrency = (amount) => {
        return `₹${parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      // Generate MOU content
      const mouContent = this.generateMOUContent({
        influencer: {
          name: influencerUser?.name || 'Not specified',
          email: influencerUser?.email || 'Not specified',
          phone: influencerUser?.phone_number || 'Not specified',
          profile: influencerProfile
        },
        brand: {
          name: brandUser?.name || 'Not specified',
          email: brandUser?.email || 'Not specified',
          phone: brandUser?.phone_number || 'Not specified',
          brandName: brandProfile?.brand_name || brandUser?.name || 'Not specified',
          profile: brandProfile
        },
        campaign: {
          title: campaign.title || 'Not specified',
          description: campaign.description || 'Not specified',
          bufferDays: bufferDays
        },
        financials: {
          budget: budget,
          platformFeePercentage: platformFeePercentage,
          platformFeeAmount: platformFeeAmount,
          agreedAmount: agreedAmount
        },
        requiresScript: requiresScript,
        scriptDeadline: scriptDeadline,
        workDeadline: workDeadline,
        bufferDeadline: bufferDeadline,
        bufferDays: bufferDays,
        formatDate: formatDate,
        formatCurrency: formatCurrency
      });

      // Check if MOU already exists for this application
      const { data: existingMous, error: existingError } = await supabaseAdmin
        .from('v1_mous')
        .select('template_version')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingError && !existingError.message?.includes('does not exist')) {
        console.error('[MOUService/generateMOUForApplication] Existing MOU check error:', existingError);
        return { success: false, message: 'Database error', error: existingError.message };
      }

      // Determine template version
      let templateVersion = 1;
      if (existingMous && existingMous.length > 0) {
        const latestVersion = existingMous[0].template_version;
        if (typeof latestVersion === 'number') {
          templateVersion = latestVersion + 1;
        } else if (typeof latestVersion === 'string') {
          const versionMatch = latestVersion.match(/v?(\d+)/);
          if (versionMatch) {
            templateVersion = parseInt(versionMatch[1], 10) + 1;
          } else {
            templateVersion = 2;
          }
        } else {
          templateVersion = 2;
        }
      }

      // Create MOU
      const { data: newMOU, error: createError } = await supabaseAdmin
        .from('v1_mous')
        .insert({
          application_id: applicationId,
          template_version: templateVersion,
          content: mouContent,
          status: 'SENT', // Set to SENT so both parties can accept
          accepted_by_influencer: false,
          accepted_by_brand: false
        })
        .select()
        .single();

      if (createError) {
        console.error('[MOUService/generateMOUForApplication] Create error:', createError);
        return { 
          success: false, 
          message: 'Failed to create MOU',
          error: createError.message 
        };
      }

      return {
        success: true,
        message: 'MOU generated successfully',
        data: newMOU
      };
    } catch (err) {
      console.error('[MOUService/generateMOUForApplication] Exception:', err);
      return {
        success: false,
        message: 'Failed to generate MOU',
        error: err.message
      };
    }
  }

  /**
   * Generate MOU content text
   * @param {Object} data - MOU data
   * @returns {string} - MOU content
   */
  generateMOUContent(data) {
    const {
      influencer,
      brand,
      campaign,
      financials,
      requiresScript,
      scriptDeadline,
      workDeadline,
      bufferDeadline,
      bufferDays,
      formatDate,
      formatCurrency
    } = data;

    let content = `MEMORANDUM OF UNDERSTANDING\n`;
    content += `================================\n\n`;
    content += `This Memorandum of Understanding (MOU) is entered into between:\n\n`;
    if(brand){
    content += `PARTY 1 - BRAND OWNER:\n`;
    content += `Name: ${brand.name}\n`;
    content += `Brand Name: ${brand.brandName}\n`;
    content += `Email: ${brand.email}\n`;
    content += `Phone: ${brand.phone}\n\n`;
  }
  if(influencer){
    content += `PARTY 2 - INFLUENCER:\n`;
    content += `Name: ${influencer.name}\n`;
    content += `Email: ${influencer.email}\n`;
    content += `Phone: ${influencer.phone}\n\n`;
  }
    
  if(campaign){
    content += `CAMPAIGN DETAILS:\n`;
    content += `Campaign Title: ${campaign.title}\n`;
    if (campaign.description) {
        content += `Campaign Description: ${campaign.description}\n`;
      }
      content += `\n`;
    }

    // Combined FINANCIAL TERMS with CALCULATION BREAKDOWN
    content += `FINANCIAL TERMS:\n`;
    content += `----------------\n`;
    content += `Total Budget (Paid by Brand): ${formatCurrency(financials.budget)}\n`;
    content += `Platform Fee Percentage: ${financials.platformFeePercentage}%\n`;
    content += `Platform Fee Amount: ${formatCurrency(financials.platformFeeAmount)}\n`;
    content += `Agreed Amount (Net Amount to Influencer): ${formatCurrency(financials.agreedAmount)}\n\n`;
    

    // PROCEDURE section (replaced WORK PROCEDURE)
    content += `PROCEDURE:\n`;
    content += `----------\n`;
    
    if (requiresScript) {
      content += `1. SCRIPT SUBMISSION:\n`;
      content += `   - The Influencer must submit the script within the stipulated deadline.\n`;
      content += `   - Script Deadline: ${formatDate(scriptDeadline)}\n`;
      content += `   - The script is subject to revision, rejection, and acceptance.\n`;
      content += `   - In case of revision, the Influencer needs to submit the revised script.\n\n`;
      
      content += `2. WORK SUBMISSION:\n`;
      content += `   - The Influencer must submit the work within the stipulated deadline.\n`;
      content += `   - Work Deadline: ${formatDate(workDeadline)}\n`;
      content += `   - The work is subject to revision, rejection, and acceptance.\n`;
      content += `   - In case of revision, the Influencer needs to submit the revised work.\n\n`;
    } else {
      content += `1. WORK SUBMISSION:\n`;
      content += `   - The Influencer must submit the work within the stipulated deadline.\n`;
      content += `   - Work Deadline: ${formatDate(workDeadline)}\n`;
      content += `   - The work is subject to revision, rejection, and acceptance.\n`;
      content += `   - In case of revision, the Influencer needs to submit the revised work.\n\n`;
    }

    // Buffer timeline
    if (bufferDeadline) {
      content += `BUFFER TIMELINE:\n`;
      content += `----------------\n`;
      content += `A buffer period of ${bufferDays} days is provided after the work deadline.\n`;
      content += `Buffer Deadline: ${formatDate(bufferDeadline)}\n\n`;
    }

    // Terms and Conditions
    content += `TERMS AND CONDITIONS:\n`;
    content += `---------------------\n`;
    content += `1. Both parties agree to fulfill their obligations as outlined in this MOU.\n`;
    content += `2. The Brand Owner agrees to pay to the platform immediately after the agreement of MOU, and the Influencer agrees to receive the Agreed Amount after successful submission of the work.\n`;
    content += `3. The Influencer agrees to deliver the work as per the campaign requirements and within the specified deadlines.\n`;
    content += `4. In case of dispute and rejection, it is up to the platform authority to resolve the dispute and will give payouts accordingly.\n`;
    content += `5. This MOU is binding upon both parties and their respective successors.\n\n`;

    // Agreement Statement (kept as is)
    content += `AGREEMENT STATEMENT:\n`;
    content += `--------------------\n`;
    content += `Both parties hereby acknowledge that they have read, understood, and agree to all the terms and conditions mentioned in this Memorandum of Understanding. Both parties agree to abide by the financial terms, work procedures, and deadlines as specified above.\n\n`;

    content += `This MOU is effective from the date of acceptance by both parties.\n\n`;

    content += `Generated on: ${formatDate(new Date())}\n`;

    return content;
  }

  /**
   * Create a new MOU (Admin only)
   * @param {Object} mouData - MOU data
   * @param {string} mouData.application_id - Application UUID
   * @param {string} mouData.content - MOU content
   * @param {string} mouData.status - MOU status (optional, defaults to DRAFT)
   * @returns {Promise<Object>} - Created MOU or error
   */
  async createMOU(mouData) {
    try {
      const { application_id, content, status = 'DRAFT' } = mouData;

      // Validate required fields
      if (!application_id || !content) {
        return { 
          success: false, 
          message: 'application_id and content are required' 
        };
      }

      // Validate status
      const validStatuses = ['DRAFT', 'SENT', 'ACTIVE', 'CANCELLED', 'EXPIRED'];
      if (!validStatuses.includes(status)) {
        return { 
          success: false, 
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        };
      }

      // Verify application exists
      const { data: application, error: appError } = await supabaseAdmin
        .from('v1_applications')
        .select('id')
        .eq('id', application_id)
        .maybeSingle();

      if (appError) {
        console.error('[MOUService/createMOU] Application check error:', appError);
        return { success: false, message: 'Database error' };
      }

      if (!application) {
        return { success: false, message: 'Application not found' };
      }

      // Get the latest MOU for this application to determine next template version
      const { data: existingMous, error: existingError } = await supabaseAdmin
        .from('v1_mous')
        .select('template_version')
        .eq('application_id', application_id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingError) {
        console.error('[MOUService/createMOU] Existing MOU check error:', existingError);
        return { success: false, message: 'Database error' };
      }

      // Determine template version (numeric: 1, 2, 3, etc.)
      let templateVersion = 1;
      if (existingMous && existingMous.length > 0) {
        const latestVersion = existingMous[0].template_version;
        
        // Handle both numeric and string versions (for backward compatibility)
        if (typeof latestVersion === 'number') {
          templateVersion = latestVersion + 1;
        } else if (typeof latestVersion === 'string') {
          // If it's a string like "v1.0" or "1", extract the number
          const versionMatch = latestVersion.match(/v?(\d+)/);
          if (versionMatch) {
            templateVersion = parseInt(versionMatch[1], 10) + 1;
          } else {
            // If format is unexpected, default to 2
            templateVersion = 2;
          }
        } else {
          // If it's neither number nor string, default to 2
          templateVersion = 2;
        }
      }

      // Create new MOU
      const { data: newMOU, error: createError } = await supabaseAdmin
        .from('v1_mous')
        .insert({
          application_id,
          template_version: templateVersion,
          content,
          status,
          accepted_by_influencer: false,
          accepted_by_brand: false
        })
        .select()
        .single();

      if (createError) {
        console.error('[MOUService/createMOU] Create error:', createError);
        return { 
          success: false, 
          message: 'Failed to create MOU',
          error: createError.message 
        };
      }

      return {
        success: true,
        message: 'MOU created successfully',
        data: newMOU
      };
    } catch (err) {
      console.error('[MOUService/createMOU] Exception:', err);
      return {
        success: false,
        message: 'Failed to create MOU',
        error: err.message
      };
    }
  }
}

module.exports = new MOUService();

