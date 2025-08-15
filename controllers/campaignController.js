const { supabaseAdmin } = require('../supabase/client');
const { body, validationResult, query } = require('express-validator');
const { uploadImageToStorage, deleteImageFromStorage } = require('../utils/imageUpload');

class CampaignController {
    /**
     * Create a new campaign
     */
    async createCampaign(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const userId = req.user.id;
            const formData = req.body;

            // Handle image upload if present
            let imageUrl = formData.image_url || formData.image || null;
            if (req.file) {
                const { url, error } = await uploadImageToStorage(
                    req.file.buffer,
                    req.file.originalname,
                    'campaigns'
                );
                
                if (error) {
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to upload image',
                        error: error
                    });
                }
                
                imageUrl = url;
            }

            // Handle both old format (database columns) and new format (form fields)
            const campaignData = {
                title: formData.name || formData.title,
                description: formData.description || '',
                min_budget: parseFloat(formData.min_budget || formData.budget || 0),
                max_budget: parseFloat(formData.max_budget || formData.budget || 0),
                start_date: formData.start_date || formData.startDate,
                end_date: formData.end_date || formData.expiryDate || formData.endDate,
                campaign_type: formData.campaign_type || (formData.category === 'product' ? 'product' : 'service'),
                requirements: formData.requirements || formData.targetAudience || '',
                deliverables: formData.deliverables || (formData.contentType ? [formData.contentType] : []),
                // New fields from form
                image_url: imageUrl,
                language: formData.language || '',
                platform: formData.platform || '',
                content_type: formData.content_type || formData.contentType || '',
                // Package options for product campaigns
                sending_package: formData.sending_package || (formData.sendingPackageToInfluencer === 'yes'),
                no_of_packages: formData.no_of_packages || (formData.noOfPackages ? parseInt(formData.noOfPackages) : null)
            };

            // Ensure only brand owners can create campaigns
            if (req.user.role !== 'brand_owner' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only brand owners can create campaigns'
                });
            }

            // Check subscription status for brand owners
            if (req.user.role === 'brand_owner') {
                const { data: hasPremiumAccess } = await supabaseAdmin.rpc('has_active_premium_subscription', {
                    user_uuid: userId
                });

                if (!hasPremiumAccess) {
                    return res.status(403).json({
                        success: false,
                        message: 'Premium subscription required to create campaigns',
                        requires_subscription: true
                    });
                }
            }

            console.log('Creating campaign with data:', {
                userId: userId,
                formData: formData,
                campaignData: campaignData
            });

            const { data: campaign, error } = await supabaseAdmin
                .from('campaigns')
                .insert({
                    ...campaignData,
                    created_by: userId
                })
                .select()
                .single();

            if (error) {
                console.error('Database error creating campaign:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create campaign',
                    error: error.message
                });
            }

            console.log('Campaign created successfully:', campaign);
            res.status(201).json({
                success: true,
                campaign: campaign,
                message: 'Campaign created successfully'
            });
        } catch (error) {
            console.error('Exception creating campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }

    /**
     * Get all campaigns with filtering and pagination
     */
    async getCampaigns(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                status,
                min_budget,
                max_budget,
                search,
                category,
                type,
                campaign_type
            } = req.query;

            const offset = (page - 1) * limit;
            let queryBuilder = supabaseAdmin
                .from('campaigns')
                .select(`
                    *,
                    created_by_user:users!campaigns_created_by_fkey (
                        id,
                        phone,
                        email,
                        role
                    ),
                    requests_count:requests(count)
                `);

            // Apply filters
            if (status) {
                queryBuilder = queryBuilder.eq('status', status);
            }
            if (min_budget) {
                queryBuilder = queryBuilder.gte('budget', min_budget);
            }
            if (max_budget) {
                queryBuilder = queryBuilder.lte('budget', max_budget);
            }
            if (search) {
                queryBuilder = queryBuilder.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
            }
            // Filter by campaign type (support both `type` and `campaign_type` query names)
            const typeFilter = type || campaign_type;
            if (typeFilter) {
                queryBuilder = queryBuilder.eq('campaign_type', typeFilter);
            }

            // Apply role-based filtering
            if (req.user.role === 'influencer') {
                // Influencers can only see campaigns they've interacted with or open campaigns
                queryBuilder = queryBuilder.or(`status.eq.open,status.eq.pending`);
            } else if (req.user.role === 'brand_owner') {
                // Brand owners can only see their own campaigns
                queryBuilder = queryBuilder.eq('created_by', req.user.id);
            }
            // Admin can see all campaigns

            const { data: campaigns, error, count } = await queryBuilder
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch campaigns'
                });
            }

            res.json({
                success: true,
                campaigns: campaigns,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limit)
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get a specific campaign by ID
     */
    async getCampaign(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            let query = supabaseAdmin
                .from('campaigns')
                .select(`
                    *,
                    created_by_user:users!campaigns_created_by_fkey (
                        id,
                        phone,
                        email,
                        role
                    ),
                    requests (
                        id,
                        status,
                        created_at,
                        influencer:users!requests_influencer_id_fkey (
                            id,
                            phone,
                            email,
                            role,
                            languages,
                            categories,
                            min_range,
                            max_range
                        )
                    )
                `)
                .eq('id', id);

            const { data: campaign, error } = await query.single();

            if (error || !campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            // Check access permissions
            if (req.user.role === 'brand_owner' && campaign.created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (req.user.role === 'influencer') {
                // Check if influencer has interacted with this campaign
                const hasInteraction = campaign.requests.some(
                    request => request.influencer.id === userId
                );
                if (!hasInteraction && campaign.status !== 'open') {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied'
                    });
                }
            }

            res.json({
                success: true,
                campaign: campaign
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update a campaign
     */
    async updateCampaign(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { id } = req.params;
            const userId = req.user.id;
            const formData = req.body;

            // Handle image upload if present
            let imageUrl = null;
            if (req.file) {
                const { url, error } = await uploadImageToStorage(
                    req.file.buffer,
                    req.file.originalname,
                    'campaigns'
                );
                
                if (error) {
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to upload image',
                        error: error
                    });
                }
                
                imageUrl = url;
            }

            // Map frontend form fields to database columns
            const updateData = {};
            
            if (formData.name !== undefined) updateData.title = formData.name;
            if (formData.description !== undefined) updateData.description = formData.description;
            if (formData.min_budget !== undefined) updateData.min_budget = parseFloat(formData.min_budget);
            if (formData.max_budget !== undefined) updateData.max_budget = parseFloat(formData.max_budget);
            if (formData.budget !== undefined) {
                updateData.min_budget = parseFloat(formData.budget);
                updateData.max_budget = parseFloat(formData.budget);
            }
            if (formData.expiryDate !== undefined) updateData.end_date = formData.expiryDate;
            if (formData.category !== undefined) updateData.campaign_type = formData.category === 'product' ? 'product' : 'service';
            if (formData.targetAudience !== undefined) updateData.requirements = formData.targetAudience;
            if (formData.contentType !== undefined) updateData.deliverables = [formData.contentType];
            if (imageUrl !== null) updateData.image_url = imageUrl;
            else if (formData.image !== undefined) updateData.image_url = formData.image;
            if (formData.language !== undefined) updateData.language = formData.language;
            if (formData.platform !== undefined) updateData.platform = formData.platform;
            if (formData.contentType !== undefined) updateData.content_type = formData.contentType;
            if (formData.sendingPackageToInfluencer !== undefined) updateData.sending_package = formData.sendingPackageToInfluencer === 'yes';
            if (formData.noOfPackages !== undefined) updateData.no_of_packages = formData.noOfPackages ? parseInt(formData.noOfPackages) : null;

            console.log('Update campaign request:', {
                campaignId: id,
                userId: userId,
                receivedData: formData,
                updateData: updateData
            });

            // Check if campaign exists and user has permission
            const { data: existingCampaign, error: checkError } = await supabaseAdmin
                .from('campaigns')
                .select('created_by')
                .eq('id', id)
                .single();

            if (checkError || !existingCampaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            if (existingCampaign.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            const { data: campaign, error } = await supabaseAdmin
                .from('campaigns')
                .update(updateData)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                console.error('Database error updating campaign:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update campaign',
                    error: error.message
                });
            }

            console.log('Campaign updated successfully:', campaign);
            res.json({
                success: true,
                campaign: campaign,
                message: 'Campaign updated successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Delete a campaign
     */
    async deleteCampaign(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            // Check if campaign exists and user has permission
            const { data: existingCampaign, error: checkError } = await supabaseAdmin
                .from('campaigns')
                .select('created_by, image_url')
                .eq('id', id)
                .single();

            if (checkError || !existingCampaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            if (existingCampaign.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Delete associated image if it exists
            if (existingCampaign.image_url) {
                await deleteImageFromStorage(existingCampaign.image_url);
            }

            const { error } = await supabaseAdmin
                .from('campaigns')
                .delete()
                .eq('id', id);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to delete campaign'
                });
            }

            res.json({
                success: true,
                message: 'Campaign deleted successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get campaign statistics
     */
    async getCampaignStats(req, res) {
        try {
            const userId = req.user.id;

            let queryBuilder = supabaseAdmin
                .from('campaigns')
                .select('status, budget');

            // Apply role-based filtering
            if (req.user.role === 'brand_owner') {
                queryBuilder = queryBuilder.eq('created_by', userId);
            } else if (req.user.role === 'influencer') {
                // Get campaigns where influencer has requests
                queryBuilder = supabaseAdmin
                    .from('requests')
                    .select(`
                        campaigns (
                            status,
                            budget
                        )
                    `)
                    .eq('influencer_id', userId);
            }

            const { data, error } = await queryBuilder;

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch statistics'
                });
            }

            // Calculate statistics
            const campaigns = req.user.role === 'influencer' 
                ? data.map(item => item.campaigns).filter(Boolean)
                : data;

            const stats = {
                total: campaigns.length,
                byStatus: {},
                totalBudget: 0
            };

            campaigns.forEach(campaign => {
                // Status stats
                stats.byStatus[campaign.status] = (stats.byStatus[campaign.status] || 0) + 1;
                
                // Budget
                stats.totalBudget += parseFloat(campaign.budget || 0);
            });

            res.json({
                success: true,
                stats: stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

// Validation middleware
const validateCreateCampaign = [
    // Support both old format (title) and new format (name)
    body('title')
        .optional()
        .isLength({ min: 3, max: 200 })
        .withMessage('Title must be between 3 and 200 characters'),
    body('name')
        .optional()
        .isLength({ min: 3, max: 200 })
        .withMessage('Name must be between 3 and 200 characters'),
    // Custom validation to ensure at least one of title or name is provided
    body()
        .custom((value) => {
            if (!value.title && !value.name) {
                throw new Error('Either title or name is required');
            }
            return true;
        }),
    body('description')
        .optional()
        .isLength({ max: 2000 })
        .withMessage('Description must be less than 2000 characters'),
    body('min_budget')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Min budget must be a positive number'),
    body('max_budget')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Max budget must be a positive number'),
    body('budget')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Budget must be a positive number'),
    body('start_date')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid date'),
    body('end_date')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid date'),
    body('campaign_type')
        .optional()
        .isIn(['product', 'service', 'mixed'])
        .withMessage('Campaign type must be product, service, or mixed'),
    body('requirements')
        .optional()
        .isLength({ max: 2000 })
        .withMessage('Requirements must be less than 2000 characters'),
    body('deliverables')
        .optional()
        .isArray()
        .withMessage('Deliverables must be an array'),
    // New form fields
    body('image_url')
        .optional()
        .isURL()
        .withMessage('Image URL must be a valid URL'),
    body('language')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Language must be less than 100 characters'),
    body('platform')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Platform must be less than 100 characters'),
    body('content_type')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Content type must be less than 100 characters'),
    body('sending_package')
        .optional()
        .isBoolean()
        .withMessage('Sending package must be a boolean'),
    body('no_of_packages')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Number of packages must be a non-negative integer')
];

const validateUpdateCampaign = [
    // Support both old format (title) and new format (name)
    body('title')
        .optional()
        .isLength({ min: 3, max: 200 })
        .withMessage('Title must be between 3 and 200 characters'),
    body('name')
        .optional()
        .isLength({ min: 3, max: 200 })
        .withMessage('Name must be between 3 and 200 characters'),
    body('description')
        .optional()
        .isLength({ max: 2000 })
        .withMessage('Description must be less than 2000 characters'),
    body('budget')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Budget must be a positive number'),
    body('start_date')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid date'),
    body('end_date')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid date'),
    body('campaign_type')
        .optional()
        .isIn(['product', 'service', 'mixed'])
        .withMessage('Campaign type must be product, service, or mixed'),
    body('requirements')
        .optional()
        .isLength({ max: 2000 })
        .withMessage('Requirements must be less than 2000 characters'),
    body('deliverables')
        .optional()
        .isArray()
        .withMessage('Deliverables must be an array'),
    // New form fields
    body('image_url')
        .optional()
        .isURL()
        .withMessage('Image URL must be a valid URL'),
    body('language')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Language must be less than 100 characters'),
    body('platform')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Platform must be less than 100 characters'),
    body('content_type')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Content type must be less than 100 characters'),
    body('sending_package')
        .optional()
        .isBoolean()
        .withMessage('Sending package must be a boolean'),
    body('no_of_packages')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Number of packages must be a non-negative integer')
];

module.exports = {
    CampaignController: new CampaignController(),
    validateCreateCampaign,
    validateUpdateCampaign
}; 