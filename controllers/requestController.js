const { supabaseAdmin } = require('../supabase/client');
const paymentService = require('../utils/payment');
const { body, validationResult } = require('express-validator');

class RequestController {
    /**
     * Apply to a campaign (create request)
     */
    async createRequest(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const userId = req.user.id;
            const { campaign_id, bid_id } = req.body;

            // Ensure only influencers can apply
            if (req.user.role !== 'influencer') {
                return res.status(403).json({
                    success: false,
                    message: 'Only influencers can apply'
                });
            }

            // Validate that either campaign_id or bid_id is provided, not both
            if (!campaign_id && !bid_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Either campaign_id or bid_id is required'
                });
            }

            if (campaign_id && bid_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot apply to both campaign and bid simultaneously'
                });
            }

            let source, sourceType, sourceId;

            if (campaign_id) {
                // Check if campaign exists and is open
                const { data: campaign, error: campaignError } = await supabaseAdmin
                    .from('campaigns')
                    .select('status, created_by')
                    .eq('id', campaign_id)
                    .single();

                if (campaignError || !campaign) {
                    return res.status(404).json({
                        success: false,
                        message: 'Campaign not found'
                    });
                }

                if (campaign.status !== 'open') {
                    return res.status(400).json({
                        success: false,
                        message: 'Campaign is not accepting applications'
                    });
                }

                source = campaign;
                sourceType = 'campaign';
                sourceId = campaign_id;
            } else {
                // Check if bid exists and is open
                const { data: bid, error: bidError } = await supabaseAdmin
                    .from('bids')
                    .select('status, created_by')
                    .eq('id', bid_id)
                    .single();

                if (bidError || !bid) {
                    return res.status(404).json({
                        success: false,
                        message: 'Bid not found'
                    });
                }

                if (bid.status !== 'open') {
                    return res.status(400).json({
                        success: false,
                        message: 'Bid is not accepting applications'
                    });
                }

                source = bid;
                sourceType = 'bid';
                sourceId = bid_id;
            }

            // Check if user has already applied
            const { data: existingRequest, error: existingError } = await supabaseAdmin
                .from('requests')
                .select('id')
                .eq(sourceType === 'campaign' ? 'campaign_id' : 'bid_id', sourceId)
                .eq('influencer_id', userId)
                .single();

            if (existingRequest) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already applied to this campaign'
                });
            }

            // Create request (connection initiated for organic discovery)
            const requestData = {
                influencer_id: userId,
                status: 'connected'
            };

            if (sourceType === 'campaign') {
                requestData.campaign_id = sourceId;
            } else {
                requestData.bid_id = sourceId;
            }

            const { data: request, error } = await supabaseAdmin
                .from('requests')
                .insert(requestData)
                .select(`
                    *,
                    campaigns (
                        *,
                        type:campaign_type
                    ),
                    bids (*),
                    influencer:users!requests_influencer_id_fkey (*)
                `)
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create request'
                });
            }

            // Emit real-time update to bid/campaign room
            const io = req.app.get('io');
            if (io) {
                if (sourceType === 'campaign') {
                    io.to(`campaign_${sourceId}`).emit('new_influencer_application', {
                        type: 'campaign',
                        campaignId: sourceId,
                        influencerId: userId,
                        requestId: request.id,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    io.to(`bid_${sourceId}`).emit('new_influencer_application', {
                        type: 'bid',
                        bidId: sourceId,
                        influencerId: userId,
                        requestId: request.id,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            // Create conversation automatically
            const conversationData = {
                brand_owner_id: source.created_by,
                influencer_id: userId
            };

            if (sourceType === 'campaign') {
                conversationData.campaign_id = sourceId;
            } else {
                conversationData.bid_id = sourceId;
            }

            const { data: conversation, error: conversationError } = await supabaseAdmin
                .from('conversations')
                .insert(conversationData)
                .select()
                .single();

            if (conversationError) {
                console.error('Failed to create conversation:', conversationError);
                // Don't fail the request creation, just log the error
            }

            res.status(201).json({
                success: true,
                request: request,
                conversation: conversation,
                message: 'Application submitted successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get requests with filtering and pagination
     */
    async getRequests(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                status,
                campaign_id
            } = req.query;

            const offset = (page - 1) * limit;
            let query = supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        type:campaign_type,
                        budget,
                        status,
                        created_by_user:users!campaigns_created_by_fkey (
                            id,
                            phone,
                            email,
                            role
                        )
                    ),
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
                `);

            // Apply filters
            if (status) {
                query = query.eq('status', status);
            }
            if (campaign_id) {
                query = query.eq('campaign_id', campaign_id);
            }

            // Apply role-based filtering
            if (req.user.role === 'influencer') {
                query = query.eq('influencer_id', req.user.id);
            } else if (req.user.role === 'brand_owner') {
                // Get requests for campaigns created by this brand owner
                query = supabaseAdmin
                    .from('requests')
                    .select(`
                        *,
                        campaigns!inner (
                            id,
                            title,
                            type:campaign_type,
                            budget,
                            status,
                            created_by_user:users!campaigns_created_by_fkey (
                                id,
                                phone,
                                email,
                                role
                            )
                        ),
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
                    `)
                    .eq('campaigns.created_by', req.user.id);
            }
            // Admin can see all requests

            const { data: requests, error, count } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch requests'
                });
            }

            res.json({
                success: true,
                requests: requests,
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
     * Get a specific request by ID
     */
    async getRequest(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const { data: request, error } = await supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        type:campaign_type,
                        budget,
                        status,
                        created_by,
                        created_by_user:users!campaigns_created_by_fkey (
                            id,
                            phone,
                            email,
                            role
                        )
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        role,
                        languages,
                        categories,
                        min_range,
                        max_range
                    ),
                    conversations (
                        id,
                        messages (
                            id,
                            sender_id,
                            receiver_id,
                            message,
                            media_url,
                            seen,
                            created_at
                        )
                    )
                `)
                .eq('id', id)
                .single();

            if (error || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Check access permissions
            if (req.user.role === 'influencer' && request.influencer_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (req.user.role === 'brand_owner' && request.campaigns.created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            res.json({
                success: true,
                request: request
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update request status (approve/reject)
     */
    async updateRequestStatus(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { id } = req.params;
            const { status } = req.body;
            const userId = req.user.id;

            // Check if request exists
            const { data: request, error: fetchError } = await supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `)
                .eq('id', id)
                .single();

            if (fetchError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Check permissions
            if (req.user.role === 'brand_owner' && request.campaigns.created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (req.user.role !== 'brand_owner' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only brand owners can update request status'
                });
            }

            // Validate status transition
            const validTransitions = {
                'pending': ['approved', 'rejected'],
                'approved': ['in_progress', 'rejected'],
                'in_progress': ['completed'],
                'completed': [],
                'rejected': []
            };

            if (!validTransitions[request.status].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot change status from ${request.status} to ${status}`
                });
            }

            // Update request status
            const { data: updatedRequest, error } = await supabaseAdmin
                .from('requests')
                .update({ status: status })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update request status'
                });
            }

            res.json({
                success: true,
                request: updatedRequest,
                message: 'Request status updated successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Process approval payment
     */
    async processApprovalPayment(req, res) {
        try {
            const { request_id } = req.body;
            const userId = req.user.id;

            // Check if request exists and user has permission
            const { data: request, error: fetchError } = await supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `)
                .eq('id', request_id)
                .single();

            if (fetchError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Check permissions
            if (req.user.role === 'brand_owner' && request.campaigns.created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (req.user.role !== 'brand_owner' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only brand owners can process payments'
                });
            }

            if (request.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'Request is not in pending status'
                });
            }

            // Calculate approval amount (50% of budget)
            const approvalAmount = parseFloat(request.campaigns.budget) * 0.5;

            // Process payment
            const paymentResult = await paymentService.processApprovalPayment(
                request_id,
                approvalAmount
            );

            if (!paymentResult.success) {
                return res.status(500).json({
                    success: false,
                    message: paymentResult.error
                });
            }

            res.json({
                success: true,
                order: paymentResult.order,
                message: 'Payment order created successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Process completion payment
     */
    async processCompletionPayment(req, res) {
        try {
            const { request_id } = req.body;
            const userId = req.user.id;

            // Check if request exists and user has permission
            const { data: request, error: fetchError } = await supabaseAdmin
                .from('requests')
                .select(`
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `)
                .eq('id', request_id)
                .single();

            if (fetchError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Check permissions
            if (req.user.role === 'brand_owner' && request.campaigns.created_by !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (req.user.role !== 'brand_owner' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only brand owners can process payments'
                });
            }

            if (request.status !== 'in_progress') {
                return res.status(400).json({
                    success: false,
                    message: 'Request is not in progress'
                });
            }

            // Calculate completion amount (remaining 50% of budget)
            const completionAmount = parseFloat(request.campaigns.budget) * 0.5;

            // Process payment
            const paymentResult = await paymentService.processCompletionPayment(
                request_id,
                completionAmount
            );

            if (!paymentResult.success) {
                return res.status(500).json({
                    success: false,
                    message: paymentResult.error
                });
            }

            res.json({
                success: true,
                order: paymentResult.order,
                message: 'Completion payment order created successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update final agreed amount (after chat negotiation)
     */
    async updateAgreedAmount(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { id } = req.params;
            const { final_agreed_amount } = req.body;
            const userId = req.user.id;

            // Check if request exists and user has permission
            const { data: request, error: checkError } = await supabaseAdmin
                .from('requests')
                .select('influencer_id, campaign_id, bid_id')
                .eq('id', id)
                .single();

            if (checkError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Only influencer can update agreed amount
            if (request.influencer_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Calculate payment amounts (30% initial, 70% final)
            const initialPayment = final_agreed_amount * 0.3;
            const finalPayment = final_agreed_amount * 0.7;

            const { data: updatedRequest, error } = await supabaseAdmin
                .from('requests')
                .update({
                    final_agreed_amount: final_agreed_amount,
                    initial_payment: initialPayment,
                    final_payment: finalPayment,
                    status: 'negotiating'
                })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update agreed amount'
                });
            }

            res.json({
                success: true,
                request: updatedRequest,
                message: 'Agreed amount updated successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Withdraw application
     */
    async withdrawRequest(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            // Check if request exists
            const { data: request, error: fetchError } = await supabaseAdmin
                .from('requests')
                .select('influencer_id, status')
                .eq('id', id)
                .single();

            if (fetchError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            // Check permissions
            if (request.influencer_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            if (request.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot withdraw approved or in-progress request'
                });
            }

            // Delete the request
            const { error } = await supabaseAdmin
                .from('requests')
                .delete()
                .eq('id', id);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to withdraw request'
                });
            }

            res.json({
                success: true,
                message: 'Application withdrawn successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get influencers who applied to a specific bid
     */
    async getBidInfluencers(req, res) {
        try {
            const { bid_id } = req.params;
            const userId = req.user.id;

            // Check if bid exists and user has permission
            const { data: bid, error: bidError } = await supabaseAdmin
                .from('bids')
                .select('created_by')
                .eq('id', bid_id)
                .single();

            if (bidError || !bid) {
                return res.status(404).json({
                    success: false,
                    message: 'Bid not found'
                });
            }

            // Only bid creator or admin can view influencers
            if (bid.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Get influencers who applied to this bid
            const { data: influencers, error } = await supabaseAdmin
                .from('requests')
                .select(`
                    id,
                    status,
                    final_agreed_amount,
                    initial_payment,
                    final_payment,
                    created_at,
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        name,
                        languages,
                        categories,
                        min_range,
                        max_range,
                        role
                    )
                `)
                .eq('bid_id', bid_id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Database error fetching bid influencers:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch influencers',
                    error: error.message
                });
            }

            console.log('Successfully fetched bid influencers:', {
                bidId: bid_id,
                count: influencers.length,
                influencers: influencers
            });

            res.json({
                success: true,
                influencers: influencers,
                total: influencers.length
            });
        } catch (error) {
            console.error('Error getting bid influencers:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }

    /**
     * Get influencers who applied to a specific campaign
     */
    async getCampaignInfluencers(req, res) {
        try {
            const { campaign_id } = req.params;
            const userId = req.user.id;

            // Check if campaign exists and user has permission
            const { data: campaign, error: campaignError } = await supabaseAdmin
                .from('campaigns')
                .select('created_by')
                .eq('id', campaign_id)
                .single();

            if (campaignError || !campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            // Only campaign creator or admin can view influencers
            if (campaign.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Get influencers who applied to this campaign
            const { data: influencers, error } = await supabaseAdmin
                .from('requests')
                .select(`
                    id,
                    status,
                    final_agreed_amount,
                    initial_payment,
                    final_payment,
                    created_at,
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        name,
                        languages,
                        categories,
                        min_range,
                        max_range,
                        role
                    )
                `)
                .eq('campaign_id', campaign_id)
                .order('created_at', { ascending: false });

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch influencers'
                });
            }

            res.json({
                success: true,
                influencers: influencers,
                total: influencers.length
            });
        } catch (error) {
            console.error('Error getting campaign influencers:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get real-time influencer count for a bid
     */
    async getBidInfluencerCount(req, res) {
        try {
            const { bid_id } = req.params;
            const userId = req.user.id;

            // Check if bid exists and user has permission
            const { data: bid, error: bidError } = await supabaseAdmin
                .from('bids')
                .select('created_by')
                .eq('id', bid_id)
                .single();

            if (bidError || !bid) {
                return res.status(404).json({
                    success: false,
                    message: 'Bid not found'
                });
            }

            // Only bid creator or admin can view count
            if (bid.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Get count of influencers who applied
            const { count, error } = await supabaseAdmin
                .from('requests')
                .select('*', { count: 'exact', head: true })
                .eq('bid_id', bid_id);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch influencer count'
                });
            }

            res.json({
                success: true,
                count: count || 0
            });
        } catch (error) {
            console.error('Error getting bid influencer count:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get real-time influencer count for a campaign
     */
    async getCampaignInfluencerCount(req, res) {
        try {
            const { campaign_id } = req.params;
            const userId = req.user.id;

            // Check if campaign exists and user has permission
            const { data: campaign, error: campaignError } = await supabaseAdmin
                .from('campaigns')
                .select('created_by')
                .eq('id', campaign_id)
                .single();

            if (campaignError || !campaign) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            // Only campaign creator or admin can view count
            if (campaign.created_by !== userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Get count of influencers who applied
            const { count, error } = await supabaseAdmin
                .from('requests')
                .select('*', { count: 'exact', head: true })
                .eq('campaign_id', campaign_id);

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch influencer count'
                });
            }

            res.json({
                success: true,
                count: count || 0
            });
        } catch (error) {
            console.error('Error getting campaign influencer count:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

// Validation middleware
const validateCreateRequest = [
    body('campaign_id')
        .isUUID()
        .withMessage('Invalid campaign ID')
];

const validateUpdateRequestStatus = [
    body('status')
        .isIn(['pending', 'approved', 'in_progress', 'completed', 'rejected'])
        .withMessage('Invalid status')
];

module.exports = {
    RequestController: new RequestController(),
    validateCreateRequest,
    validateUpdateRequestStatus
}; 