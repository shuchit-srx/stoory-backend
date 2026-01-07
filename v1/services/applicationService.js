const { supabaseAdmin } = require('../db/config');
const { canTransition } = require('./applicationStateMachine');

class ApplicationService {
  /**
   * Helper method to update accepted_count in v1_campaigns table
   * Counts applications with phase ACCEPTED or COMPLETED for the campaign
   */
  async updateCampaignAcceptedCount(campaignId) {
    try {
      if (!campaignId) {
        return { success: false, message: 'Campaign ID is required' };
      }

      // Count applications with phase ACCEPTED or COMPLETED for this campaign
      const { count, error: countError } = await supabaseAdmin
        .from('v1_applications')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('phase', ['ACCEPTED', 'COMPLETED']);

      if (countError) {
        console.error('[ApplicationService/updateCampaignAcceptedCount] Count error:', countError);
        return { success: false, message: 'Failed to count applications', error: countError.message };
      }

      const acceptedCount = count || 0;

      // Update accepted_count in v1_campaigns table
      const { error: updateError } = await supabaseAdmin
        .from('v1_campaigns')
        .update({ accepted_count: acceptedCount })
        .eq('id', campaignId);

      if (updateError) {
        console.error('[ApplicationService/updateCampaignAcceptedCount] Update error:', updateError);
        return { success: false, message: 'Failed to update accepted_count', error: updateError.message };
      }

      return { success: true, count: acceptedCount };
    } catch (err) {
      console.error('[ApplicationService/updateCampaignAcceptedCount] Exception:', err);
      return { success: false, message: 'Failed to update accepted_count', error: err.message };
    }
  }
  /**
   * Check if brand owns the campaign (via application)
   */
  async checkBrandOwnership(applicationId, brandId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          *,
          v1_campaigns!inner(brand_id)
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (error) {
        console.error('[ApplicationService/checkBrandOwnership] Error:', error);
        return { success: false, message: 'Database error' };
      }

      if (!data || !data.v1_campaigns) {
        return { success: false, message: 'Application not found' };
      }

      if (data.v1_campaigns.brand_id !== brandId) {
        return { success: false, message: 'Unauthorized: Not your campaign' };
      }

      return { success: true, application: { ...data, brand_id: data.v1_campaigns.brand_id } };
    } catch (err) {
      console.error('[ApplicationService/checkBrandOwnership] Error:', err);
      return { success: false, message: 'Database error' };
    }
  }

  /**
   * Check if user can cancel application (influencer or brand owner)
   */
  async checkCancelPermission(applicationId, userId, userRole, brandId = null) {
    try {
      const { data, error } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          *,
          v1_campaigns!inner(brand_id)
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (error) {
        console.error('[ApplicationService/checkCancelPermission] Error:', error);
        return { success: false, message: 'Database error' };
      }

      if (!data || !data.v1_campaigns) {
        return { success: false, message: 'Application not found' };
      }

      // Influencer can cancel their own application
      if (userRole === 'INFLUENCER' && data.influencer_id === userId) {
        return { success: true, application: { ...data, brand_id: data.v1_campaigns.brand_id } };
      }

      // Brand owner can cancel applications to their campaigns
      if (userRole === 'BRAND_OWNER' && brandId && data.v1_campaigns.brand_id === brandId) {
        return { success: true, application: { ...data, brand_id: data.v1_campaigns.brand_id } };
      }

      return { success: false, message: 'Unauthorized: Cannot cancel this application' };
    } catch (err) {
      console.error('[ApplicationService/checkCancelPermission] Error:', err);
      return { success: false, message: 'Database error' };
    }
  }

 /**
   * Apply to a campaign
   */
 async apply({ campaignId, influencerId }) {
  try {
    // Check if campaign exists and is in valid state
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('v1_campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('[ApplicationService/apply] Campaign check error:', campaignError);
      return { success: false, message: 'Database error' };
    }

    if (!campaign) {
      return { success: false, message: 'Campaign not found' };
    }

    // Allow various active statuses
    const allowedStatuses = ['LIVE', 'ACTIVE', 'OPEN', 'PUBLISHED'];
    if (!allowedStatuses.includes(campaign.status)) {
      return { 
         success: false, 
         message: `Campaign is not accepting applications (Status: ${campaign.status})` 
      };
    }

    // Check for duplicate application
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('v1_applications')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('influencer_id', influencerId)
      .maybeSingle();

    if (existingError) {
      console.error('[ApplicationService/apply] Duplicate check error:', existingError);
      return { success: false, message: 'Database error' };
    }

    if (existing) {
      return { success: false, message: 'You have already applied to this campaign' };
    }

    // --- FIX: Added brand_id to the insert payload ---
    const { data: app, error: insertError } = await supabaseAdmin
      .from('v1_applications')
      .insert({
        campaign_id: campaignId,
        influencer_id: influencerId,
        brand_id: campaign.brand_id,
        phase: 'APPLIED'
      })
      .select()
      .single();

    if (insertError) {
      console.error('[ApplicationService/apply] Insert error:', insertError);
      return { success: false, message: insertError.message || 'Failed to apply to campaign' };
    }

    return {
      success: true,
      message: 'Application submitted successfully',
      application: app,
    };
  } catch (err) {
    console.error('[ApplicationService/apply] Error:', err);
    return {
      success: false,
      message: err.message || 'Failed to apply to campaign',
    };
  }
}

  /**
   * Bulk accept multiple applications for a campaign
   */
  async bulkAccept({ campaignId, applications, brandId }) {
    try {
      if (!campaignId) {
        return { success: false, message: 'campaignId is required' };
      }

      if (!Array.isArray(applications) || applications.length === 0) {
        return {
          success: false,
          message: 'applications array is required and must not be empty',
        };
      }

      // Verify brand owns the campaign and fetch requires_script
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('id, brand_id, requires_script')
        .eq('id', campaignId)
        .maybeSingle();

      if (campaignError) {
        console.error('[ApplicationService/bulkAccept] Campaign check error:', campaignError);
        return { success: false, message: 'Database error' };
      }

      if (!campaign) {
        return { success: false, message: 'Campaign not found' };
      }

      if (campaign.brand_id !== brandId) {
        return { success: false, message: 'Unauthorized: You do not own this campaign' };
      }

      // Get script_needed from campaign
      const scriptNeeded = campaign.requires_script === true;

      // Verify all application IDs belong to this campaign and fetch their current phase
      const applicationIds = applications.map(app => app.applicationId);
      const { data: existingApplications, error: fetchError } = await supabaseAdmin
        .from('v1_applications')
        .select('id, campaign_id, phase, brand_id')
        .in('id', applicationIds);

      if (fetchError) {
        console.error('[ApplicationService/bulkAccept] Fetch applications error:', fetchError);
        return { success: false, message: 'Database error' };
      }

      if (!existingApplications || existingApplications.length !== applicationIds.length) {
        return { success: false, message: 'One or more applications not found' };
      }

      // Verify all applications belong to the specified campaign
      const invalidApplications = existingApplications.filter(app => app.campaign_id !== campaignId);
      if (invalidApplications.length > 0) {
        return {
          success: false,
          message: `One or more applications do not belong to campaign ${campaignId}`,
        };
      }

      const results = [];
      const errors = [];
      const campaignIdsToUpdate = new Set();

      // Process each application
      for (const appData of applications) {
        const { applicationId, agreedAmount, platformFeePercent } = appData;
        let individualResult = { applicationId, success: false, message: 'Unknown error' };

        try {
          // Validate inputs
          if (typeof agreedAmount !== 'number' || agreedAmount <= 0) {
            individualResult.message = 'Invalid agreedAmount. Must be a positive number.';
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          if (typeof platformFeePercent !== 'number' || platformFeePercent < 0 || platformFeePercent > 100) {
            individualResult.message = 'Invalid platformFeePercent. Must be between 0 and 100.';
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          // Find the existing application
          const existingApp = existingApplications.find(app => app.id === applicationId);
          if (!existingApp) {
            individualResult.message = 'Application not found';
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          // Check state transition
          if (!canTransition(existingApp.phase, 'ACCEPTED')) {
            individualResult.message = `Cannot accept application. Current phase: ${existingApp.phase}`;
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          // Set phase to ACCEPTED only - phase will transition to SCRIPT or WORK after payment
          const platformFeeAmount = (agreedAmount * platformFeePercent) / 100;
          const netAmount = agreedAmount - platformFeeAmount;

          // Update application
          const { data: updated, error: updateError } = await supabaseAdmin
            .from('v1_applications')
            .update({
              phase: 'ACCEPTED',
              agreed_amount: agreedAmount,
              platform_fee_percent: platformFeePercent,
              platform_fee_amount: platformFeeAmount,
              net_amount: netAmount,
              brand_id: brandId
            })
            .eq('id', applicationId)
            .select()
            .single();

          if (updateError) {
            console.error(`[ApplicationService/bulkAccept] Update error for ${applicationId}:`, updateError);
            individualResult.message = updateError.message || 'Failed to accept application';
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          individualResult = {
            applicationId,
            success: true,
            message: 'Application accepted successfully',
            application: updated,
          };
          results.push(individualResult);

          if (existingApp.campaign_id) {
            campaignIdsToUpdate.add(existingApp.campaign_id);
          }

        } catch (err) {
          console.error(`[ApplicationService/bulkAccept] Exception for ${applicationId}:`, err);
          individualResult.message = err.message || 'Failed to accept application';
          errors.push({ applicationId, error: individualResult.message });
          results.push(individualResult);
        }
      }

      // Update accepted_count for all affected campaigns (usually just one)
      for (const campId of campaignIdsToUpdate) {
        const countUpdateResult = await this.updateCampaignAcceptedCount(campId);
        if (!countUpdateResult.success) {
          console.error(`[ApplicationService/bulkAccept] Failed to update accepted_count for campaign ${campId}:`, countUpdateResult.message);
          // Log error but don't fail the entire bulk operation
        }
      }

      const succeededCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      const overallSuccess = errors.length === 0;
      const overallMessage = `Bulk accept completed. ${succeededCount} succeeded, ${failedCount} failed.`;

      return {
        success: overallSuccess,
        message: overallMessage,
        total: applications.length,
        succeeded: succeededCount,
        failed: failedCount,
        results: results,
        ...(errors.length > 0 && { errors }),
      };
    } catch (err) {
      console.error('[ApplicationService/bulkAccept] Exception:', err);
      return {
        success: false,
        message: err.message || 'Failed to bulk accept applications',
      };
    }
  }

  /**
   * Accept an application
   */
  async accept({
    applicationId,
    brandId,
    agreedAmount,
    platformFeePercent,
    requiresScript,
  }) {
    try {
      // Check ownership
      const ownershipCheck = await this.checkBrandOwnership(applicationId, brandId);
      if (!ownershipCheck.success) {
        return ownershipCheck;
      }

      const app = ownershipCheck.application;

      // Check state transition
      if (!canTransition(app.phase, 'ACCEPTED')) {
        return {
          success: false,
          message: `Cannot accept application. Current phase: ${app.phase}`,
        };
      }

      // Set phase to ACCEPTED only - phase will transition to SCRIPT or WORK after payment
      const platformFeeAmount = (agreedAmount * platformFeePercent) / 100;
      const netAmount = agreedAmount - platformFeeAmount;

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          phase: 'ACCEPTED',
          agreed_amount: agreedAmount,
          platform_fee_percent: platformFeePercent,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
          brand_id: brandId
        })
        .eq('id', applicationId)
        .select()
        .single();

      if (updateError) {
        console.error('[ApplicationService/accept] Update error:', updateError);
        return {
          success: false,
          message: updateError.message || 'Failed to accept application',
        };
      }

      // Update accepted_count in v1_campaigns table
      // Count all applications with phase ACCEPTED or COMPLETED for this campaign
      if (app.campaign_id) {
        const countUpdateResult = await this.updateCampaignAcceptedCount(campaignId);
        if (!countUpdateResult.success) {
          console.error('[ApplicationService/accept] Failed to update accepted_count:', countUpdateResult.message);
          // Don't fail the entire operation if count update fails, just log it
        }
      }

      return {
        success: true,
        message: 'Application accepted successfully',
        application: updated,
      };
    } catch (err) {
      console.error('[ApplicationService/accept] Error:', err);
      return {
        success: false,
        message: err.message || 'Failed to accept application',
      };
    }
  }

  /**
   * Cancel an application
   */
  async cancel({ applicationId, user, brandId = null }) {
    try {
      // Check permission
      const permissionCheck = await this.checkCancelPermission(
        applicationId,
        user.id,
        user.role,
        brandId
      );
      if (!permissionCheck.success) {
        return permissionCheck;
      }

      const app = permissionCheck.application;

      // Check state transition
      if (!canTransition(app.phase, 'CANCELLED')) {
        return {
          success: false,
          message: `Cannot cancel application. Current phase: ${app.phase}`,
        };
      }

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          phase: 'CANCELLED'
        })
        .eq('id', applicationId)
        .select()
        .single();

      if (updateError) {
        console.error('[ApplicationService/cancel] Update error:', updateError);
        return {
          success: false,
          message: updateError.message || 'Failed to cancel application',
        };
      }

      return {
        success: true,
        message: 'Application cancelled successfully',
        application: updated,
      };
    } catch (err) {
      console.error('[ApplicationService/cancel] Error:', err);
      return {
        success: false,
        message: err.message || 'Failed to cancel application',
      };
    }
  }

  /**
   * Complete an application (Admin only)
   */
  async complete(applicationId) {
    try {
      const { data: app, error: fetchError } = await supabaseAdmin
        .from('v1_applications')
        .select('*')
        .eq('id', applicationId)
        .maybeSingle();

      if (fetchError) {
        console.error('[ApplicationService/complete] Fetch error:', fetchError);
        return { success: false, message: 'Database error' };
      }

      if (!app) {
        return { success: false, message: 'Application not found' };
      }

      // Check state transition
      if (!canTransition(app.phase, 'COMPLETED')) {
        return {
          success: false,
          message: `Cannot complete application. Current phase: ${app.phase}`,
        };
      }

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          phase: 'COMPLETED'
        })
        .eq('id', applicationId)
        .select()
        .single();

      if (updateError) {
        console.error('[ApplicationService/complete] Update error:', updateError);
        return {
          success: false,
          message: updateError.message || 'Failed to complete application',
        };
      }

      return {
        success: true,
        message: 'Application completed successfully',
        application: updated,
      };
    } catch (err) {
      console.error('[ApplicationService/complete] Error:', err);
      return {
        success: false,
        message: err.message || 'Failed to complete application',
      };
    }
  }
}

module.exports = new ApplicationService();