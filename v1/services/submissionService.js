const { supabaseAdmin } = require('../db/config');
const { canTransition } = require('./applicationStateMachine');
const path = require('path');

class SubmissionService {
  /**
   * Upload file to storage (supports PDF, documents, images, videos)
   */
  async uploadFile(fileBuffer, fileName, mimeType, folder = 'submissions') {
    try {
      // Determine file type and storage subfolder
      const isImage = mimeType.startsWith('image/');
      const isVideo = mimeType.startsWith('video/');
      const isDocument = !isImage && !isVideo; // PDFs, docs, etc.
      
      // Map folder parameter and determine subfolder
      let storageFolder;
      if (folder === 'script') {
        // Scripts are always documents
        storageFolder = 'scripts/documents';
      } else if (folder === 'work') {
        // Works can be images, videos, or documents
        if (isImage) {
          storageFolder = 'works/images';
        } else if (isVideo) {
          storageFolder = 'works/videos';
        } else {
          storageFolder = 'works/documents';
        }
      } else {
        // Default fallback
        storageFolder = isImage ? `${folder}/images` : isVideo ? `${folder}/videos` : `${folder}/documents`;
      }
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileExtension = path.extname(fileName);
      const randomString = Math.random().toString(36).substring(2, 15);
      const uniqueFileName = `${storageFolder}/${timestamp}_${randomString}${fileExtension}`;

      // All files are stored in 'v1' bucket
      const bucket = 'v1';

      // Upload to Supabase Storage
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(uniqueFileName, fileBuffer, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('[SubmissionService/uploadFile] Upload error:', error);
        return { success: false, error: error.message };
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(uniqueFileName);

      return { success: true, url: urlData.publicUrl };
    } catch (err) {
      console.error('[SubmissionService/uploadFile] Exception:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Validate script file type (PDF or document)
   */
  validateScriptFile(mimeType, fileName) {
    const validMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    
    const ext = path.extname(fileName).toLowerCase();
    const validExtensions = ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx'];
    
    return validMimeTypes.includes(mimeType) || validExtensions.includes(ext);
  }

  /**
   * Check if influencer owns the application
   */
  async checkInfluencerOwnership(applicationId, influencerId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('v1_applications')
        .select('id, influencer_id, phase, campaign_id')
        .eq('id', applicationId)
        .maybeSingle();

      if (error) {
        console.error('[SubmissionService/checkInfluencerOwnership] Error:', error);
        return { success: false, message: 'Database error' };
      }

      if (!data) {
        return { success: false, message: 'Application not found' };
      }

      if (data.influencer_id !== influencerId) {
        return { success: false, message: 'Unauthorized: Not your application' };
      }

      return { success: true, application: data };
    } catch (err) {
      console.error('[SubmissionService/checkInfluencerOwnership] Exception:', err);
      return { success: false, message: 'Internal server error' };
    }
  }

  /**
   * Check if brand owns the application
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
        console.error('[SubmissionService/checkBrandOwnership] Error:', error);
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
      console.error('[SubmissionService/checkBrandOwnership] Exception:', err);
      return { success: false, message: 'Internal server error' };
    }
  }

  /**
   * Submit script (Influencer)
   */
  async submitScript({ applicationId, influencerId, fileUrl }) {
    try {
      // Check ownership and application status
      const ownershipCheck = await this.checkInfluencerOwnership(applicationId, influencerId);
      if (!ownershipCheck.success) {
        return ownershipCheck;
      }

      const application = ownershipCheck.application;

      // Check if application is in ACCEPTED or SCRIPT phase
      if (!['ACCEPTED', 'SCRIPT'].includes(application.phase)) {
        return {
          success: false,
          message: `Cannot submit script. Application phase must be ACCEPTED or SCRIPT. Current phase: ${application.phase}`
        };
      }

      // Get campaign to check if script is required
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('requires_script')
        .eq('id', application.campaign_id)
        .maybeSingle();

      if (campaignError || !campaign) {
        return { success: false, message: 'Campaign not found' };
      }

      // Calculate next version automatically by finding the highest existing version
      const { data: existingScripts, error: versionError } = await supabaseAdmin
        .from('v1_scripts')
        .select('version')
        .eq('application_id', applicationId)
        .order('version', { ascending: false })
        .limit(1);

      if (versionError) {
        console.error('[SubmissionService/submitScript] Version check error:', versionError);
        return { success: false, message: 'Database error while calculating version' };
      }

      // Determine next version: if scripts exist, increment highest version; otherwise start at 1
      const nextVersion = existingScripts && existingScripts.length > 0 
        ? existingScripts[0].version + 1 
        : 1;

      // Safety check: verify the calculated version doesn't already exist
      const { data: existingScript, error: existingError } = await supabaseAdmin
        .from('v1_scripts')
        .select('id')
        .eq('application_id', applicationId)
        .eq('version', nextVersion)
        .maybeSingle();

      if (existingError) {
        console.error('[SubmissionService/submitScript] Check existing error:', existingError);
        return { success: false, message: 'Database error' };
      }

      if (existingScript) {
        return { success: false, message: `Script version ${nextVersion} already exists for this application` };
      }

      // Create script submission with calculated version
      const { data: script, error: insertError } = await supabaseAdmin
        .from('v1_scripts')
        .insert({
          application_id: applicationId,
          version: nextVersion,
          file_url: fileUrl,
          status: 'PENDING'
        })
        .select()
        .single();

      if (insertError) {
        console.error('[SubmissionService/submitScript] Insert error:', insertError);
        return { success: false, message: insertError.message || 'Failed to submit script' };
      }

      // Update application phase to SCRIPT if not already
      if (application.phase === 'ACCEPTED') {
        const { error: updateError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'SCRIPT' })
          .eq('id', applicationId);

        if (updateError) {
          console.error('[SubmissionService/submitScript] Phase update error:', updateError);
          // Don't fail the entire operation, just log it
        }
      }

      // Always send notification to brand owner when script is submitted (including resubmissions)
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyScriptSubmitted(
          script.id,
          applicationId,
          application.brand_id,
          application.influencer_id
        );
      } catch (notifError) {
        console.error('[SubmissionService/submitScript] Failed to send notification:', notifError);
      }

      return {
        success: true,
        message: 'Script submitted successfully',
        script: script
      };
    } catch (err) {
      console.error('[SubmissionService/submitScript] Exception:', err);
      return { success: false, message: err.message || 'Failed to submit script' };
    }
  }

  /**
   * Submit work (Influencer)
   */
  async submitWork({ applicationId, influencerId, fileUrl }) {
    try {
      // Check ownership and application status
      const ownershipCheck = await this.checkInfluencerOwnership(applicationId, influencerId);
      if (!ownershipCheck.success) {
        return ownershipCheck;
      }

      const application = ownershipCheck.application;

      // Check if application is in SCRIPT or WORK phase
      if (!['SCRIPT', 'WORK'].includes(application.phase)) {
        return {
          success: false,
          message: `Cannot submit work. Application phase must be SCRIPT or WORK. Current phase: ${application.phase}`
        };
      }

      // If in SCRIPT phase, check if script is accepted
      if (application.phase === 'SCRIPT') {
        const { data: latestScript, error: scriptError } = await supabaseAdmin
          .from('v1_scripts')
          .select('status')
          .eq('application_id', applicationId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (scriptError) {
          console.error('[SubmissionService/submitWork] Script check error:', scriptError);
          return { success: false, message: 'Database error' };
        }

        if (!latestScript || latestScript.status !== 'ACCEPTED') {
          return {
            success: false,
            message: 'Cannot submit work. Script must be accepted first.'
          };
        }
      }

      // Create work submission
      const { data: workSubmission, error: insertError } = await supabaseAdmin
        .from('v1_work_submissions')
        .insert({
          application_id: applicationId,
          file_url: fileUrl,
          status: 'PENDING'
        })
        .select()
        .single();

      if (insertError) {
        console.error('[SubmissionService/submitWork] Insert error:', insertError);
        return { success: false, message: insertError.message || 'Failed to submit work' };
      }

      // Update application phase to WORK if not already
      if (application.phase === 'SCRIPT') {
        const { error: updateError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'WORK' })
          .eq('id', applicationId);

        if (updateError) {
          console.error('[SubmissionService/submitWork] Phase update error:', updateError);
          // Don't fail the entire operation, just log it
        }
      }

      // Always send notification to brand owner when work is submitted (including resubmissions)
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyWorkSubmitted(
          workSubmission.id,
          applicationId,
          application.brand_id,
          application.influencer_id
        );
      } catch (notifError) {
        console.error('[SubmissionService/submitWork] Failed to send notification:', notifError);
      }

      return {
        success: true,
        message: 'Work submitted successfully',
        workSubmission: workSubmission
      };
    } catch (err) {
      console.error('[SubmissionService/submitWork] Exception:', err);
      return { success: false, message: err.message || 'Failed to submit work' };
    }
  }

  /**
   * Review script (Brand Owner)
   */
  async reviewScript({ scriptId, brandId, status, rejectionReasonId, remarks }) {
    try {
      // Get script with application and campaign info
      const { data: script, error: scriptError } = await supabaseAdmin
        .from('v1_scripts')
        .select(`
          *,
          v1_applications!inner(
            id,
            campaign_id,
            phase,
            v1_campaigns!inner(brand_id)
          )
        `)
        .eq('id', scriptId)
        .maybeSingle();

      if (scriptError || !script) {
        return { success: false, message: 'Script not found' };
      }

      const application = script.v1_applications;
      const campaign = application.v1_campaigns;

      // Check brand ownership
      if (campaign.brand_id !== brandId) {
        return { success: false, message: 'Unauthorized: Not your campaign' };
      }

      // Validate status
      const validStatuses = ['ACCEPTED', 'REVISION', 'REJECTED'];
      if (!validStatuses.includes(status)) {
        return { success: false, message: 'Invalid status. Must be ACCEPTED, REVISION, or REJECTED' };
      }

      // If rejected, require rejection reason
      if (status === 'REJECTED') {
        if (!rejectionReasonId && !remarks) {
          return { success: false, message: 'Rejection reason or remarks required when rejecting' };
        }
      }

      // Create rejection record if rejected
      let rejectionId = null;
      if (status === 'REJECTED') {
        const { data: rejection, error: rejectionError } = await supabaseAdmin
          .from('v1_rejections')
          .insert({
            entity_type: 'SCRIPT',
            entity_id: scriptId,
            campaign_id: application.campaign_id,
            application_id: application.id,
            rejected_by_role: 'BRAND',
            rejected_by_user_id: brandId,
            reason_code: null,
            reason_text: remarks || 'Script rejected by brand'
          })
          .select()
          .single();

        if (rejectionError) {
          console.error('[SubmissionService/reviewScript] Rejection insert error:', rejectionError);
          return { success: false, message: 'Failed to create rejection record' };
        }

        rejectionId = rejection.id;
      }

      // Update script status
      const updateData = {
        status: status,
        rejection_reason_id: rejectionId,
        remarks: remarks || null
      };

      const { data: updatedScript, error: updateError } = await supabaseAdmin
        .from('v1_scripts')
        .update(updateData)
        .eq('id', scriptId)
        .select()
        .single();

      if (updateError) {
        console.error('[SubmissionService/reviewScript] Update error:', updateError);
        return { success: false, message: updateError.message || 'Failed to update script status' };
      }

      // If rejected, cancel application
      if (status === 'REJECTED') {
        const { error: cancelError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'CANCELLED' })
          .eq('id', application.id);

        if (cancelError) {
          console.error('[SubmissionService/reviewScript] Cancel error:', cancelError);
          // Log but don't fail
        }
      } else if (status === 'ACCEPTED') {
        // Move application to WORK phase
        const { error: phaseError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'WORK' })
          .eq('id', application.id);

        if (phaseError) {
          console.error('[SubmissionService/reviewScript] Phase update error:', phaseError);
          // Log but don't fail
        }
      }

      // Send notification to influencer (includes all statuses: ACCEPTED, REJECTED, REVISION)
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyScriptReview(
          scriptId,
          application.id,
          brandId,
          application.influencer_id,
          status,
          remarks
        );
      } catch (notifError) {
        console.error('[SubmissionService/reviewScript] Failed to send notification:', notifError);
        // Don't fail the operation if notification fails
      }

      return {
        success: true,
        message: `Script ${status.toLowerCase()} successfully`,
        script: updatedScript
      };
    } catch (err) {
      console.error('[SubmissionService/reviewScript] Exception:', err);
      return { success: false, message: err.message || 'Failed to review script' };
    }
  }

  /**
   * Review work (Brand Owner)
   */
  async reviewWork({ workSubmissionId, brandId, status, rejectionReasonId, remarks }) {
    try {
      // Get work submission with application and campaign info
      const { data: workSubmission, error: workError } = await supabaseAdmin
        .from('v1_work_submissions')
        .select(`
          *,
          v1_applications!inner(
            id,
            campaign_id,
            phase,
            v1_campaigns!inner(brand_id)
          )
        `)
        .eq('id', workSubmissionId)
        .maybeSingle();

      if (workError || !workSubmission) {
        return { success: false, message: 'Work submission not found' };
      }

      const application = workSubmission.v1_applications;
      const campaign = application.v1_campaigns;

      // Check brand ownership
      if (campaign.brand_id !== brandId) {
        return { success: false, message: 'Unauthorized: Not your campaign' };
      }

      // Validate status
      const validStatuses = ['ACCEPTED', 'REVISION', 'REJECTED'];
      if (!validStatuses.includes(status)) {
        return { success: false, message: 'Invalid status. Must be ACCEPTED, REVISION, or REJECTED' };
      }

      // If rejected, require rejection reason
      if (status === 'REJECTED') {
        if (!rejectionReasonId && !remarks) {
          return { success: false, message: 'Rejection reason or remarks required when rejecting' };
        }
      }

      // Create rejection record if rejected
      let rejectionId = null;
      if (status === 'REJECTED') {
        const { data: rejection, error: rejectionError } = await supabaseAdmin
          .from('v1_rejections')
          .insert({
            entity_type: 'WORK',
            entity_id: workSubmissionId,
            campaign_id: application.campaign_id,
            application_id: application.id,
            rejected_by_role: 'BRAND',
            rejected_by_user_id: brandId,
            reason_code: null,
            reason_text: remarks || 'Work rejected by brand'
          })
          .select()
          .single();

        if (rejectionError) {
          console.error('[SubmissionService/reviewWork] Rejection insert error:', rejectionError);
          return { success: false, message: 'Failed to create rejection record' };
        }

        rejectionId = rejection.id;
      }

      // Update work submission status
      const updateData = {
        status: status,
        rejection_reason_id: rejectionId,
        remarks: remarks || null
      };

      const { data: updatedWork, error: updateError } = await supabaseAdmin
        .from('v1_work_submissions')
        .update(updateData)
        .eq('id', workSubmissionId)
        .select()
        .single();

      if (updateError) {
        console.error('[SubmissionService/reviewWork] Update error:', updateError);
        return { success: false, message: updateError.message || 'Failed to update work status' };
      }

      // If rejected, cancel application
      if (status === 'REJECTED') {
        const { error: cancelError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'CANCELLED' })
          .eq('id', application.id);

        if (cancelError) {
          console.error('[SubmissionService/reviewWork] Cancel error:', cancelError);
          // Log but don't fail
        }
      } else if (status === 'ACCEPTED') {
        // Move application to PAYOUT phase (not COMPLETED)
        const { error: phaseError } = await supabaseAdmin
          .from('v1_applications')
          .update({ phase: 'PAYOUT' })
          .eq('id', application.id);

        if (phaseError) {
          console.error('[SubmissionService/reviewWork] Phase update error:', phaseError);
          // Log but don't fail
        } else {
          // Create payout entry when work is accepted and application moves to PAYOUT phase
          // Get application details to calculate payout amount
          // Use agreed_amount from application first, fallback to campaign net_amount
          const { data: applicationDetails, error: appError } = await supabaseAdmin
            .from('v1_applications')
            .select(`
              agreed_amount, 
              influencer_id,
              v1_campaigns!inner(
                net_amount
              )
            `)
            .eq('id', application.id)
            .maybeSingle();

          if (appError) {
            console.error('[SubmissionService/reviewWork] Application fetch error:', appError);
          } else if (applicationDetails) {
            // Use agreed_amount from application first, fallback to campaign net_amount
            const payoutAmount = applicationDetails.agreed_amount ?? applicationDetails.v1_campaigns?.net_amount ?? null;

            if (payoutAmount && payoutAmount > 0) {
              // Check if payout already exists for this application
              const { data: existingPayout } = await supabaseAdmin
                .from('v1_payouts')
                .select('id')
                .eq('application_id', application.id)
                .maybeSingle();

              if (!existingPayout) {
                const { error: payoutError } = await supabaseAdmin
                  .from('v1_payouts')
                  .insert({
                    application_id: application.id,
                    influencer_id: applicationDetails.influencer_id,
                    amount: payoutAmount,
                    status: 'PENDING',
                    created_at: new Date().toISOString()
                  });

                if (payoutError) {
                  console.error('[SubmissionService/reviewWork] Payout creation error:', payoutError);
                  // Don't fail work review if payout creation fails, just log it
                }
              }
            }
          }
        }
      }

      // Send notification to influencer
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.notifyWorkReview(
          workSubmissionId,
          application.id,
          brandId,
          application.influencer_id,
          status,
          remarks
        );
      } catch (notifError) {
        console.error('[SubmissionService/reviewWork] Failed to send notification:', notifError);
        // Don't fail the operation if notification fails
      }

      return {
        success: true,
        message: `Work ${status.toLowerCase()} successfully`,
        workSubmission: updatedWork
      };
    } catch (err) {
      console.error('[SubmissionService/reviewWork] Exception:', err);
      return { success: false, message: err.message || 'Failed to review work' };
    }
  }

  /**
   * Get scripts for an application
   */
  async getScripts(applicationId, userId, userRole) {
    try {
      // First, get the application with campaign info to check access
      const { data: application, error: appError } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          *,
          v1_campaigns!inner(
            *,
            brand_id
          )
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (appError || !application) {
        return { success: false, message: 'Application not found' };
      }

      const campaign = application.v1_campaigns;

      // Check access
      if (userRole === 'INFLUENCER' && application.influencer_id !== userId) {
        return { success: false, message: 'Unauthorized' };
      }

      if (userRole === 'BRAND_OWNER' && campaign.brand_id !== userId) {
        return { success: false, message: 'Unauthorized' };
      }

      // Get scripts
      const { data: scripts, error: scriptsError } = await supabaseAdmin
        .from('v1_scripts')
        .select('*')
        .eq('application_id', applicationId)
        .order('version', { ascending: false });

      if (scriptsError) {
        console.error('[SubmissionService/getScripts] Error:', scriptsError);
        return { success: false, message: 'Database error' };
      }

      // Get campaign details
      const { data: campaignDetails, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('*')
        .eq('id', campaign.id)
        .maybeSingle();

      if (campaignError) {
        console.error('[SubmissionService/getScripts] Campaign error:', campaignError);
      }

      // Get brand profile details
      let brandProfile = null;
      if (campaignDetails && campaignDetails.brand_id) {
        const { data: brandProfileData, error: brandError } = await supabaseAdmin
          .from('v1_brand_profiles')
          .select('*')
          .eq('user_id', campaignDetails.brand_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (brandError) {
          console.error('[SubmissionService/getScripts] Brand profile error:', brandError);
        } else {
          brandProfile = brandProfileData;
        }
      }

      // Get influencer profile and user details
      let influencerProfile = null;
      let influencerUser = null;
      if (application.influencer_id) {
        const { data: influencerProfileData, error: influencerError } = await supabaseAdmin
          .from('v1_influencer_profiles')
          .select('*')
          .eq('user_id', application.influencer_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (influencerError) {
          console.error('[SubmissionService/getScripts] Influencer profile error:', influencerError);
        } else {
          influencerProfile = influencerProfileData;
        }

        // Get influencer user details
        const { data: userData, error: userError } = await supabaseAdmin
          .from('v1_users')
        .select('id, name, email, role')
          .eq('id', application.influencer_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (userError) {
          console.error('[SubmissionService/getScripts] User error:', userError);
        } else {
          influencerUser = userData;
        }
      }

      // Combine influencer profile with user data
      const influencerDetails = influencerProfile ? {
        ...influencerProfile,
        user: influencerUser
      } : null;

      // Remove v1_campaigns from application and attach details to each script
      const { v1_campaigns, ...applicationWithoutCampaign } = application;
      const scriptsWithDetails = (scripts || []).map(script => ({
        ...script,
        application: {
          ...applicationWithoutCampaign,
          campaign: campaignDetails ? {
            ...campaignDetails,
            brand_profile: brandProfile
          } : null,
          influencer_profile: influencerDetails
        }
      }));

      return {
        success: true,
        scripts: scriptsWithDetails
      };
    } catch (err) {
      console.error('[SubmissionService/getScripts] Exception:', err);
      return { success: false, message: err.message || 'Failed to fetch scripts' };
    }
  }

  /**
   * Get work submissions for an application
   */
  async getWorkSubmissions(applicationId, userId, userRole) {
    try {
      // First, get the application with campaign info to check access
      const { data: application, error: appError } = await supabaseAdmin
        .from('v1_applications')
        .select(`
          *,
          v1_campaigns!inner(
            *,
            brand_id
          )
        `)
        .eq('id', applicationId)
        .maybeSingle();

      if (appError || !application) {
        return { success: false, message: 'Application not found' };
      }

      const campaign = application.v1_campaigns;

      // Check access
      if (userRole === 'INFLUENCER' && application.influencer_id !== userId) {
        return { success: false, message: 'Unauthorized' };
      }

      if (userRole === 'BRAND_OWNER' && campaign.brand_id !== userId) {
        return { success: false, message: 'Unauthorized' };
      }

      // Get work submissions
      const { data: workSubmissions, error: workError } = await supabaseAdmin
        .from('v1_work_submissions')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false });

      if (workError) {
        console.error('[SubmissionService/getWorkSubmissions] Error:', workError);
        return { success: false, message: 'Database error' };
      }

      // Get campaign details
      const { data: campaignDetails, error: campaignError } = await supabaseAdmin
        .from('v1_campaigns')
        .select('*')
        .eq('id', campaign.id)
        .maybeSingle();

      if (campaignError) {
        console.error('[SubmissionService/getWorkSubmissions] Campaign error:', campaignError);
      }

      // Get brand profile details
      let brandProfile = null;
      if (campaignDetails && campaignDetails.brand_id) {
        const { data: brandProfileData, error: brandError } = await supabaseAdmin
          .from('v1_brand_profiles')
          .select('*')
          .eq('user_id', campaignDetails.brand_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (brandError) {
          console.error('[SubmissionService/getWorkSubmissions] Brand profile error:', brandError);
        } else {
          brandProfile = brandProfileData;
        }
      }

      // Get influencer profile and user details
      let influencerProfile = null;
      let influencerUser = null;
      if (application.influencer_id) {
        const { data: influencerProfileData, error: influencerError } = await supabaseAdmin
          .from('v1_influencer_profiles')
          .select('*')
          .eq('user_id', application.influencer_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (influencerError) {
          console.error('[SubmissionService/getWorkSubmissions] Influencer profile error:', influencerError);
        } else {
          influencerProfile = influencerProfileData;
        }

        // Get influencer user details
        const { data: userData, error: userError } = await supabaseAdmin
          .from('v1_users')
        .select('id, name, email, role')
          .eq('id', application.influencer_id)
          .eq('is_deleted', false)
          .maybeSingle();

        if (userError) {
          console.error('[SubmissionService/getWorkSubmissions] User error:', userError);
        } else {
          influencerUser = userData;
        }
      }

      // Combine influencer profile with user data
      const influencerDetails = influencerProfile ? {
        ...influencerProfile,
        user: influencerUser
      } : null;

      // Remove v1_campaigns from application and attach details to each work submission
      const { v1_campaigns, ...applicationWithoutCampaign } = application;
      const workSubmissionsWithDetails = (workSubmissions || []).map(workSubmission => ({
        ...workSubmission,
        application: {
          ...applicationWithoutCampaign,
          campaign: campaignDetails ? {
            ...campaignDetails,
            brand_profile: brandProfile
          } : null,
          influencer_profile: influencerDetails
        }
      }));

      return {
        success: true,
        workSubmissions: workSubmissionsWithDetails
      };
    } catch (err) {
      console.error('[SubmissionService/getWorkSubmissions] Exception:', err);
      return { success: false, message: err.message || 'Failed to fetch work submissions' };
    }
  }
}

module.exports = new SubmissionService();

