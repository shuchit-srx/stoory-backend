const { supabaseAdmin } = require('../db/config');
const { canTransition } = require('./applicationStateMachine');
const { CampaignStatus, CampaignType, ApplicationPhase } = require('../utils/constants');

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
        .in('phase', [ApplicationPhase.ACCEPTED, ApplicationPhase.COMPLETED]);

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

      // Allow LIVE status for all campaigns
      // Allow IN_PROGRESS status only for BULK campaigns (can accept more applications)
      // Block COMPLETED campaigns
      if (campaign.status === CampaignStatus.LIVE) {
        // LIVE campaigns can accept applications
      } else if (campaign.status === CampaignStatus.IN_PROGRESS && campaign.type === CampaignType.BULK) {
        // BULK campaigns in IN_PROGRESS can still accept applications
      } else {
        return {
          success: false,
          message: `Campaign is not accepting applications (Status: ${campaign.status})`
        };
      }

      // Check dynamic expiration: if applications_accepted_till has passed and no applications accepted
      const now = new Date();
      if (campaign.applications_accepted_till) {
        const acceptedTill = new Date(campaign.applications_accepted_till);
        const acceptedCount = campaign.accepted_count || 0;

        // Campaign is expired if: deadline passed AND no accepted applications
        if (now >= acceptedTill && acceptedCount === 0) {
          return {
            success: false,
            message: 'Campaign has expired (application deadline has passed)'
          };
        }
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

      // Fetch values from campaign and map to application fields
      // budget -> budget_amount
      // platform_fee_percentage -> platform_fee_percentage
      // platform_fee_amount -> platform_fee_amount
      // net_amount -> agreed_amount
      // Amounts remain in rupees (not converted to paisa)
      const { data: app, error: insertError } = await supabaseAdmin
        .from('v1_applications')
        .insert({
          campaign_id: campaignId,
          influencer_id: influencerId,
          brand_id: campaign.brand_id,
          phase: ApplicationPhase.APPLIED,
          budget_amount: campaign.budget ?? null,
          platform_fee_percentage: campaign.platform_fee_percentage ?? null,
          platform_fee_amount: campaign.platform_fee_amount ?? null,
          agreed_amount: campaign.net_amount ?? null,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[ApplicationService/apply] Insert error:', insertError);
        return { success: false, message: insertError.message || 'Failed to apply to campaign' };
      }

      // Send notification to brand owner
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyApplicationCreated(
          app.id,
          campaignId,
          influencerId,
          campaign.brand_id
        );
      } catch (notifError) {
        console.error('[ApplicationService/apply] Failed to send notification:', notifError);
        // Don't fail the operation if notification fails
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

      // Verify brand owns the campaign and fetch campaign details
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('id, brand_id, budget, platform_fee_percentage, platform_fee_amount, net_amount, requires_script')
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
        const { applicationId } = appData;
        let individualResult = { applicationId, success: false, message: 'Unknown error' };

        try {
          // Find the existing application
          const existingApp = existingApplications.find(app => app.id === applicationId);
          if (!existingApp) {
            individualResult.message = 'Application not found';
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          // Check state transition
          if (!canTransition(existingApp.phase, ApplicationPhase.ACCEPTED)) {
            individualResult.message = `Cannot accept application. Current phase: ${existingApp.phase}`;
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          // Use values from campaign
          // budget -> budget_amount
          // platform_fee_percentage -> platform_fee_percentage
          // platform_fee_amount -> platform_fee_amount
          // net_amount -> agreed_amount
          // Amounts remain in rupees (not converted to paisa)
          const { data: updated, error: updateError } = await supabaseAdmin
            .from('v1_applications')
            .update({
              phase: ApplicationPhase.ACCEPTED,
              budget_amount: campaign.budget ?? null,
              platform_fee_percentage: campaign.platform_fee_percentage ?? null,
              platform_fee_amount: campaign.platform_fee_amount ?? null,
              agreed_amount: campaign.net_amount ?? null,
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

          if (existingApp.campaign_id) {
            campaignIdsToUpdate.add(existingApp.campaign_id);
          }

          // Automatically generate MOU for the accepted application immediately
          // This must happen synchronously before marking as successful
          const MOUService = require('./mouService');
          const mouResult = await MOUService.generateMOUForApplication(applicationId);

          if (!mouResult.success) {
            console.error(`❌ [ApplicationService/bulkAccept] Failed to generate MOU for application ${applicationId}: ${mouResult.message}`, mouResult.error || '');
            // MOU generation is critical - mark this application as failed
            individualResult = {
              applicationId,
              success: false,
              message: `Application was accepted but MOU generation failed: ${mouResult.message}`,
              error: mouResult.error || mouResult.message,
              application: updated, // Still include the updated application for reference
            };
            errors.push({ applicationId, error: individualResult.message });
            results.push(individualResult);
            continue;
          }

          console.log(`✅ [ApplicationService/bulkAccept] MOU generated successfully for application ${applicationId}`);

          // Notify the influencer that their application was accepted
          try {
            const NotificationService = require('./notificationService');
            const { data: appForNotif } = await supabaseAdmin
              .from('v1_applications')
              .select('influencer_id')
              .eq('id', applicationId)
              .maybeSingle();
            if (appForNotif?.influencer_id) {
              await NotificationService.notifyApplicationAccepted(applicationId, appForNotif.influencer_id, brandId);
            }
          } catch (notifError) {
            console.error(`[ApplicationService/bulkAccept] Notification error for ${applicationId}:`, notifError);
          }

          individualResult = {
            applicationId,
            success: true,
            message: 'Application accepted successfully and MOU generated',
            application: updated,
            mou: mouResult.data, // Include MOU data in response
          };
          results.push(individualResult);

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
        } else {
          // Move campaign from LIVE to IN_PROGRESS when first application is accepted
          try {
            const CampaignService = require('./campaignService');
            const campaignStatusResult = await CampaignService.moveCampaignToInProgress(campId);
            if (campaignStatusResult.success && campaignStatusResult.statusChanged) {
              console.log(`[ApplicationService/bulkAccept] Campaign ${campId} moved to IN_PROGRESS`);
            }
          } catch (campaignError) {
            console.error(`[ApplicationService/bulkAccept] Failed to update campaign status:`, campaignError);
            // Don't fail the operation if campaign status update fails, but log it
          }
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
  }) {
    try {
      // Check ownership
      const ownershipCheck = await this.checkBrandOwnership(applicationId, brandId);
      if (!ownershipCheck.success) {
        return ownershipCheck;
      }

      const app = ownershipCheck.application;

      // Check state transition
      if (!canTransition(app.phase, ApplicationPhase.ACCEPTED)) {
        return {
          success: false,
          message: `Cannot accept application. Current phase: ${app.phase}`,
        };
      }

      // Fetch campaign to get budget, platform_fee_percentage, platform_fee_amount, and net_amount
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('budget, platform_fee_percentage, platform_fee_amount, net_amount, requires_script')
        .eq('id', app.campaign_id)
        .maybeSingle();

      if (campaignError) {
        console.error('[ApplicationService/accept] Campaign fetch error:', campaignError);
        return {
          success: false,
          message: 'Failed to fetch campaign details',
        };
      }

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found',
        };
      }

      // Use values from campaign
      // budget -> budget_amount (already set during apply, but update to ensure consistency)
      // platform_fee_percentage -> platform_fee_percentage
      // platform_fee_amount -> platform_fee_amount
      // net_amount -> agreed_amount
      // Amounts remain in rupees (not converted to paisa)
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          phase: ApplicationPhase.ACCEPTED,
          budget_amount: campaign.budget ?? null,
          platform_fee_percentage: campaign.platform_fee_percentage ?? null,
          platform_fee_amount: campaign.platform_fee_amount ?? null,
          agreed_amount: campaign.net_amount ?? null,
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

      // Automatically generate MOU for the accepted application immediately
      // This must happen synchronously before returning success
      const MOUService = require('./mouService');
      const mouResult = await MOUService.generateMOUForApplication(applicationId);

      if (!mouResult.success) {
        console.error(`❌ [ApplicationService/accept] Failed to generate MOU for application ${applicationId}: ${mouResult.message}`, mouResult.error || '');
        // MOU generation is critical - fail the operation if it doesn't succeed
        return {
          success: false,
          message: `Application was accepted but MOU generation failed: ${mouResult.message}`,
          error: mouResult.error || mouResult.message,
          application: updated, // Still return the updated application for reference
        };
      }

      console.log(`✅ [ApplicationService/accept] MOU generated successfully for application ${applicationId}`);

      // Update accepted_count in v1_campaigns table
      // Count all applications with phase ACCEPTED or COMPLETED for this campaign
      if (app.campaign_id) {
        const countUpdateResult = await this.updateCampaignAcceptedCount(app.campaign_id);
        if (!countUpdateResult.success) {
          console.error('[ApplicationService/accept] Failed to update accepted_count:', countUpdateResult.message);
          // Don't fail the entire operation if count update fails, just log it
        } else {
          // Move campaign from LIVE to IN_PROGRESS when first application is accepted
          try {
            const CampaignService = require('./campaignService');
            const campaignStatusResult = await CampaignService.moveCampaignToInProgress(app.campaign_id);
            if (campaignStatusResult.success && campaignStatusResult.statusChanged) {
              console.log(`[ApplicationService/accept] Campaign ${app.campaign_id} moved to IN_PROGRESS`);
            }
          } catch (campaignError) {
            console.error(`[ApplicationService/accept] Failed to update campaign status:`, campaignError);
            // Don't fail the operation if campaign status update fails, but log it
          }
        }
      }

      // Send notification to influencer (Trigger #2)
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyApplicationAccepted(
          applicationId,
          app.influencer_id,
          brandId
        );
      } catch (notifError) {
        console.error('[ApplicationService/accept] Failed to send notification:', notifError);
        // Don't fail the operation if notification fails
      }

      return {
        success: true,
        message: 'Application accepted successfully and MOU generated',
        application: updated,
        mou: mouResult.data, // Include MOU data in response
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
      if (!canTransition(app.phase, ApplicationPhase.CANCELLED)) {
        return {
          success: false,
          message: `Cannot cancel application. Current phase: ${app.phase}`,
        };
      }

      // Update application
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('v1_applications')
        .update({
          phase: ApplicationPhase.CANCELLED
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

      // Send notification to the other party
      try {
        const NotificationService = require('./notificationService');
        const { data: applicationData } = await supabaseAdmin
          .from('v1_applications')
          .select('influencer_id, v1_campaigns!inner(brand_id)')
          .eq('id', applicationId)
          .single();

        if (applicationData) {
          const otherUserId = app.influencer_id === user.id
            ? applicationData.v1_campaigns?.brand_id
            : app.influencer_id;

          if (otherUserId) {
            await NotificationService.notifyApplicationCancelled(
              applicationId,
              otherUserId,
              user.role
            );
          }
        }
      } catch (notifError) {
        console.error('[ApplicationService/cancel] Failed to send notification:', notifError);
        // Don't fail the operation if notification fails
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
  async complete(applicationId, initiatorId = null) {
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

      // Close chat for this application when admin completes it
      // Chat should only close when admin completes, not when work is completed
      try {
        const ChatService = require('./chatService');
        await ChatService.closeChat(applicationId, 'system'); // System/admin closes chat
        console.log(`[ApplicationService/complete] Chat closed for application ${applicationId}`);
      } catch (chatError) {
        console.error(`[ApplicationService/complete] Failed to close chat:`, chatError);
        // Don't fail completion if chat closure fails, but log it
      }

      // Notify both parties about completion
      try {
        const NotificationService = require('./notificationService');
        const { data: completedApp } = await supabaseAdmin
          .from('v1_applications')
          .select('influencer_id, brand_id, v1_campaigns(id, title, brand_id)')
          .eq('id', applicationId)
          .maybeSingle();

        if (completedApp) {
          const brandId = completedApp.brand_id || completedApp.v1_campaigns?.brand_id;
          const influencerId = completedApp.influencer_id;
          const campaignTitle = completedApp.v1_campaigns?.title || 'Campaign';

          // Notify influencer
          if (influencerId && influencerId !== initiatorId) {
            await NotificationService.sendAndStoreNotification(influencerId, {
              type: 'CAMPAIGN_COMPLETED',
              title: `${campaignTitle} Update`,
              body: `Congratulations! "${campaignTitle}" is now complete. Your payout has been processed`,
              clickAction: `/applications/${applicationId}`,
              data: { applicationId, campaignId: completedApp.v1_campaigns?.id },
            });
          }
          // Notify brand
          if (brandId) {
            await NotificationService.notifyCampaignCompleted(completedApp.v1_campaigns?.id, brandId, initiatorId);
          }
        }
      } catch (notifError) {
        console.error(`[ApplicationService/complete] Notification error:`, notifError);
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

  /**
   * Get all applications for an influencer with campaign and brand details
   */
  async getInfluencerApplications(influencerId) {
    try {
      // Fetch applications with nested campaign and brand data
      // Filter out applications with deleted campaigns
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          id,
          phase,
          created_at,
          v1_campaigns!inner(
            id,
            title,
            description,
            budget,
            platform,
            content_type,
            language,
            brand_id,
            cover_image_url,
            is_deleted
          )
        `)
        .eq('influencer_id', influencerId)
        .eq('v1_campaigns.is_deleted', false)
        .order('created_at', { ascending: false });

      if (applicationsError) {
        console.error('[ApplicationService/getInfluencerApplications] Error:', applicationsError);
        return {
          success: false,
          message: 'Failed to fetch applications',
          error: applicationsError.message,
        };
      }

      if (!applications || applications.length === 0) {
        return {
          success: true,
          applications: [],
        };
      }

      // Get unique brand IDs
      const brandIds = [...new Set(
        applications
          .map(app => app.v1_campaigns?.brand_id)
          .filter(Boolean)
      )];

      // Fetch brand profiles
      let brandMap = {};
      if (brandIds.length > 0) {
        const { data: brandProfiles, error: brandError } = await supabaseAdmin
          .from('v1_brand_profiles')
          .select('user_id, brand_name')
          .in('user_id', brandIds)
          .eq('is_deleted', false);

        if (brandError) {
          console.error('[ApplicationService/getInfluencerApplications] Brand fetch error:', brandError);
        } else if (brandProfiles) {
          brandProfiles.forEach(profile => {
            brandMap[profile.user_id] = {
              id: profile.user_id,
              brand_name: profile.brand_name,
            };
          });
        }
      }

      // Format response according to required structure
      // Filter out applications where brand owner is deleted
      const formattedApplications = applications
        .filter(app => {
          const campaign = app.v1_campaigns;
          const brandId = campaign?.brand_id;
          return brandId && brandMap[brandId]; // Only include if brand owner is not deleted
        })
        .map(app => {
          const campaign = app.v1_campaigns;
          const brandId = campaign.brand_id;
          const brand = brandMap[brandId];

          return {
            id: app.id,
            phase: app.phase,
            created_at: app.created_at,
            campaign: {
              id: campaign.id,
              title: campaign.title,
              description: campaign.description,
              cover_image_url: campaign.cover_image_url,
              budget: campaign.budget,
              platform: campaign.platform,
              content_type: campaign.content_type,
              language: campaign.language,
              brand: brand,
            },
          };
        });

      return {
        success: true,
        applications: formattedApplications,
      };
    } catch (err) {
      console.error('[ApplicationService/getInfluencerApplications] Exception:', err);
      return {
        success: false,
        message: err.message || 'Failed to fetch applications',
      };
    }
  }
}

module.exports = new ApplicationService();