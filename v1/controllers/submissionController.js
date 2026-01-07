const { validationResult } = require('express-validator');
const SubmissionService = require('../services/submissionService');
const { supabaseAdmin } = require('../db/config');
const multer = require('multer');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  }
});

class SubmissionController {
  /**
   * Helper function to transform v1_campaigns to campaigns and v1_applications to applications in response
   */
  transformResponse(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.transformResponse(item));
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const transformed = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'v1_campaigns') {
        transformed.campaigns = this.transformResponse(value);
      } else if (key === 'v1_applications') {
        transformed.applications = this.transformResponse(value);
      } else {
        transformed[key] = this.transformResponse(value);
      }
    }

    return transformed;
  }

  /**
   * Submit script (Influencer)
   */
  async submitScript(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { applicationId } = req.body;
      const influencerId = req.user.id;

      // Handle file upload
      let fileUrl = null;
      if (req.file) {
        const uploadResult = await SubmissionService.uploadFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'scripts'
        );

        if (!uploadResult.success) {
          return res.status(400).json({
            success: false,
            message: uploadResult.error || 'Failed to upload file'
          });
        }

        fileUrl = uploadResult.url;

        // Validate script file type
        if (!SubmissionService.validateScriptFile(req.file.mimetype, req.file.originalname)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid file type. Script must be PDF or document format.'
          });
        }
      } else if (req.body.fileUrl) {
        fileUrl = req.body.fileUrl;
      } else {
        return res.status(400).json({
          success: false,
          message: 'File is required. Provide either file upload or fileUrl'
        });
      }

      const result = await SubmissionService.submitScript({
        applicationId,
        influencerId,
        fileUrl
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      console.error('[SubmissionController/submitScript] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to submit script'
      });
    }
  }

  /**
   * Submit work (Influencer)
   */
  async submitWork(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { applicationId } = req.body;
      const influencerId = req.user.id;

      // Handle file upload
      let fileUrl = null;
      if (req.file) {
        const uploadResult = await SubmissionService.uploadFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'work'
        );

        if (!uploadResult.success) {
          return res.status(400).json({
            success: false,
            message: uploadResult.error || 'Failed to upload file'
          });
        }

        fileUrl = uploadResult.url;
      } else if (req.body.fileUrl) {
        fileUrl = req.body.fileUrl;
      } else {
        return res.status(400).json({
          success: false,
          message: 'File is required. Provide either file upload or fileUrl'
        });
      }

      const result = await SubmissionService.submitWork({
        applicationId,
        influencerId,
        fileUrl
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      console.error('[SubmissionController/submitWork] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to submit work'
      });
    }
  }

  /**
   * Review script (Brand Owner)
   */
  async reviewScript(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      
      // Get brand_id from brand profile
      const { data: brandProfile, error: brandError } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .maybeSingle();

      if (brandError || !brandProfile) {
        return res.status(404).json({
          success: false,
          message: 'Brand profile not found'
        });
      }

      const brandId = userId; // brand_id = user_id in v1_brand_profiles

      const result = await SubmissionService.reviewScript({
        scriptId: req.params.id,
        brandId,
        status: req.body.status,
        rejectionReasonId: req.body.rejectionReasonId,
        remarks: req.body.remarks
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[SubmissionController/reviewScript] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to review script'
      });
    }
  }

  /**
   * Review work (Brand Owner)
   */
  async reviewWork(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      
      // Get brand_id from brand profile
      const { data: brandProfile, error: brandError } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .maybeSingle();

      if (brandError || !brandProfile) {
        return res.status(404).json({
          success: false,
          message: 'Brand profile not found'
        });
      }

      const brandId = userId; // brand_id = user_id in v1_brand_profiles

      const result = await SubmissionService.reviewWork({
        workSubmissionId: req.params.id,
        brandId,
        status: req.body.status,
        rejectionReasonId: req.body.rejectionReasonId,
        remarks: req.body.remarks
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[SubmissionController/reviewWork] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to review work'
      });
    }
  }

  /**
   * Get scripts for an application
   */
  async getScripts(req, res) {
    try {
      const { applicationId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const result = await SubmissionService.getScripts(applicationId, userId, userRole);

      if (!result.success) {
        return res.status(400).json(result);
      }

      // Transform v1_campaigns to campaigns and v1_applications to applications
      const transformedResult = this.transformResponse(result);
      res.json(transformedResult);
    } catch (err) {
      console.error('[SubmissionController/getScripts] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to fetch scripts'
      });
    }
  }

  /**
   * Get work submissions for an application
   */
  async getWorkSubmissions(req, res) {
    try {
      const { applicationId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const result = await SubmissionService.getWorkSubmissions(applicationId, userId, userRole);

      if (!result.success) {
        return res.status(400).json(result);
      }

      // Transform v1_campaigns to campaigns and v1_applications to applications
      const transformedResult = this.transformResponse(result);
      res.json(transformedResult);
    } catch (err) {
      console.error('[SubmissionController/getWorkSubmissions] Exception:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to fetch work submissions'
      });
    }
  }
}

// Create instance and bind methods
const submissionController = new SubmissionController();
submissionController.submitScript = submissionController.submitScript.bind(submissionController);
submissionController.submitWork = submissionController.submitWork.bind(submissionController);
submissionController.reviewScript = submissionController.reviewScript.bind(submissionController);
submissionController.reviewWork = submissionController.reviewWork.bind(submissionController);
submissionController.getScripts = submissionController.getScripts.bind(submissionController);
submissionController.getWorkSubmissions = submissionController.getWorkSubmissions.bind(submissionController);

// Export upload middleware
submissionController.upload = upload.single('file');

module.exports = submissionController;

