const { supabaseAdmin } = require('../db/config');
const { canTransition } = require('./applicationStateMachine');

class ApplicationService {
  /**
   * Helper method to update accepted_count in v1_campaigns table
   * Counts applications with status ACCEPTED or COMPLETED for the campaign
   */
  async updateCampaignAcceptedCount(campaignId) {
    try {
      if (!campaignId) {
        return { success: false, message: 'Campaign ID is required' };
      }

      // Count applications with status ACCEPTED or COMPLETED for this campaign
      const { count, error: countError } = await supabaseAdmin
        .from('v1_applications')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('status', ['ACCEPTED', 'COMPLETED']);

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
      if (userRole === 'BRAND' && brandId && data.v1_campaigns.brand_id === brandId) {
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
        status: 'APPLIED',
        phase: 'WORK' // Default phase, will be updated to 'SCRIPT' or 'WORK' when accepted
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
      if (!canTransition(app.status, 'ACCEPTED')) {
        return {
          success: false,
          message: `Cannot accept application. Current status: ${app.status}`,
        };
      }

      const platformFeeAmount = (agreedAmount * platformFeePercent) / 100;
      const netAmount = agreedAmount - platformFeeAmount;
      const phase = requiresScript ? 'SCRIPT' : 'WORK';

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          status: 'ACCEPTED',
          phase: phase,
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
      // Count all applications with status ACCEPTED or COMPLETED for this campaign
      const campaignId = app.campaign_id;
      if (campaignId) {
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
      if (!canTransition(app.status, 'CANCELLED')) {
        return {
          success: false,
          message: `Cannot cancel application. Current status: ${app.status}`,
        };
      }

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          status: 'CANCELLED'
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
      if (!canTransition(app.status, 'COMPLETED')) {
        return {
          success: false,
          message: `Cannot complete application. Current status: ${app.status}`,
        };
      }

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          status: 'COMPLETED'
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