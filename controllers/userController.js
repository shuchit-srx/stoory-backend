const { supabaseAdmin } = require('../supabase/client');

// Helpers to shape public profiles (exclude contact/sensitive fields)
function shapeInfluencerPublic(user) {
    const {
        id,
        role,
        name,
        languages,
        categories,
        min_range,
        max_range,
        created_at,
        profile_image_url,
        bio,
        experience_years,
        specializations,
        portfolio_links,
        social_platforms
    } = user || {};
    return {
        id,
        role,
        name,
        languages,
        categories,
        min_range,
        max_range,
        created_at,
        profile_image_url,
        bio,
        experience_years,
        specializations,
        portfolio_links,
        social_platforms
    };
}

function shapeBrandOwnerPublic(user) {
    const {
        id,
        role,
        name,
        created_at,
        business_name,
        business_type,
        business_website
    } = user || {};
    return {
        id,
        role,
        name,
        created_at,
        business_name,
        business_type,
        business_website
    };
}

class UserController {
    /**
     * List influencers for brand owners with filtering and pagination
     */
    async listInfluencers(req, res) {
        try {
            const userId = req.user.id;
            const userRole = req.user.role;

            const {
                page = 1,
                limit = 10,
                search,
                languages,
                categories,
                min_range,
                max_range,
                sort_by = 'created_at',
                sort_order = 'desc'
            } = req.query;

            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const offset = (pageNum - 1) * limitNum;

            // Parse list filters (comma-separated or array)
            const parseList = (val) => {
                if (!val) return null;
                if (Array.isArray(val)) return val.filter(Boolean);
                if (typeof val === 'string') return val.split(',').map(v => v.trim()).filter(Boolean);
                return null;
            };

            const languagesFilter = parseList(languages);
            const categoriesFilter = parseList(categories);

            // Whitelist sort fields
            const allowedSortBy = new Set(['created_at', 'min_range', 'max_range']);
            const sortField = allowedSortBy.has(sort_by) ? sort_by : 'created_at';
            const sortAscending = (String(sort_order).toLowerCase() === 'asc');

            // Check if user has active premium subscription (only for brand owners)
            let hasPremiumAccess = false;
            if (userRole === 'brand_owner') {
                const { data: subscriptionStatus } = await supabaseAdmin.rpc('has_active_premium_subscription', {
                    user_uuid: userId
                });
                hasPremiumAccess = subscriptionStatus;
            }

            // Build query based on subscription status
            let selectFields = `
                id,
                role,
                languages,
                categories,
                min_range,
                max_range,
                created_at,
                profile_image_url,
                social_platforms (*)
            `;

            // Add name only for premium users or non-brand owners
            if (hasPremiumAccess || userRole !== 'brand_owner') {
                selectFields = `
                    id,
                    name,
                    role,
                    languages,
                    categories,
                    min_range,
                    max_range,
                    created_at,
                    profile_image_url,
                    social_platforms (*)
                `;
            }

            let query = supabaseAdmin
                .from('users')
                .select(selectFields, { count: 'exact' })
                .eq('role', 'influencer')
                .eq('is_deleted', false);

            // Search across name only (only if premium access)
            if (search && String(search).trim().length > 0) {
                const term = String(search).trim();
                if (hasPremiumAccess || userRole !== 'brand_owner') {
                    query = query.ilike('name', `%${term}%`);
                } else {
                    // For non-premium brand owners, no search available
                    // (since we don't expose name, phone, or email)
                }
            }

            // Array overlaps for languages and categories
            if (languagesFilter && languagesFilter.length > 0) {
                query = query.overlaps('languages', languagesFilter);
            }
            if (categoriesFilter && categoriesFilter.length > 0) {
                query = query.overlaps('categories', categoriesFilter);
            }

            // Range filters
            if (min_range !== undefined && min_range !== null && min_range !== '') {
                const minVal = Number(min_range);
                if (!Number.isNaN(minVal)) {
                    query = query.gte('min_range', minVal);
                }
            }
            if (max_range !== undefined && max_range !== null && max_range !== '') {
                const maxVal = Number(max_range);
                if (!Number.isNaN(maxVal)) {
                    query = query.lte('max_range', maxVal);
                }
            }

            const { data: influencers, error, count } = await query
                .order(sortField, { ascending: sortAscending })
                .range(offset, offset + limitNum - 1);

            if (error) {
                return res.status(500).json({ success: false, message: 'Failed to fetch influencers' });
            }

            // Admin-only: fetch involvement counts (bids, campaigns) via RPC
            const influencerIds = (influencers || []).map(i => i.id);
            let countsByInfluencer = new Map();
            if (req.user.role === 'admin' && influencerIds.length > 0) {
                const { data: countsData } = await supabaseAdmin
                    .rpc('get_influencer_involvement_counts', { ids: influencerIds });
                if (Array.isArray(countsData)) {
                    countsData.forEach(row => countsByInfluencer.set(row.influencer_id, row));
                }
            }

            // Process influencers data based on subscription status
            let processedInfluencers = influencers || [];
            
            if (userRole === 'brand_owner' && !hasPremiumAccess) {
                // Mask sensitive data for non-premium brand owners
                processedInfluencers = processedInfluencers.map(influencer => ({
                    ...influencer,
                    name: null
                }));
            }

            // Attach counts (admin only)
            if (req.user.role === 'admin') {
                processedInfluencers = processedInfluencers.map(influencer => {
                    const c = countsByInfluencer.get(influencer.id) || {};
                    return {
                        ...influencer,
                        bids_count: Number(c.bids_count || 0),
                        campaigns_count: Number(c.campaigns_count || 0)
                    };
                });
            }

            return res.json({
                success: true,
                influencers: processedInfluencers,
                subscription: {
                    has_premium_access: hasPremiumAccess,
                    requires_subscription: userRole === 'brand_owner' && !hasPremiumAccess
                },
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limitNum)
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * List brand owners (admin-only) with filtering and pagination
     */
    async listBrandOwners(req, res) {
    
        try {
            const {
                page = 1,
                limit = 10,
                search,
                sort_by = 'created_at',
                sort_order = 'desc'
            } = req.query;

            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const offset = (pageNum - 1) * limitNum;

            // Whitelist sort fields
            const allowedSortBy = new Set(['created_at']);
            const sortField = allowedSortBy.has(sort_by) ? sort_by : 'created_at';
            const sortAscending = (String(sort_order).toLowerCase() === 'asc');


            // Select only core fields to avoid failures when business fields are absent
            let query = supabaseAdmin
                .from('users')
                .select(`
                    id,
                    name,
                    email,
                    phone,
                    role,
                    created_at
                `, { count: 'exact' })
                .eq('role', 'brand_owner')
                .eq('is_deleted', false);

            // Basic search on name and email (business fields optional and excluded)
            if (search && String(search).trim().length > 0) {
                const term = String(search).trim();
                query = query.or(
                    `name.ilike.%${term}%,email.ilike.%${term}%`
                );
            }

            let { data: brandOwners, error, count } = await query
                .order(sortField, { ascending: sortAscending })
                .range(offset, offset + limitNum - 1);

            if (error) {
                return res.status(500).json({ success: false, message: 'Failed to fetch brand owners' });
            }

            // Admin-only: fetch brand owner involvement counts via RPC
            if (req.user.role === 'admin' && (brandOwners?.length || 0) > 0) {
                const ids = brandOwners.map(b => b.id);
                const { data: countsData } = await supabaseAdmin
                    .rpc('get_brand_owner_involvement_counts', { ids });
                const map = new Map((countsData || []).map(c => [c.brand_owner_id, c]));
                brandOwners = brandOwners.map(b => {
                    const c = map.get(b.id) || {};
                    return {
                        ...b,
                        created_bids_count: Number(c.created_bids_count || 0),
                        created_campaigns_count: Number(c.created_campaigns_count || 0),
                        requests_to_bids_count: Number(c.requests_to_bids_count || 0),
                        requests_to_campaigns_count: Number(c.requests_to_campaigns_count || 0)
                    };
                });
            }

            return res.json({
                success: true,
                brand_owners: brandOwners || [],
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limitNum)
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Get user counts by role (admin-only)
     */
    async getUserStats(req, res) {
        try {
            // Count influencers
            const { count: influencersCount } = await supabaseAdmin
                .from('users')
                .select('id', { count: 'exact', head: true })
                .eq('role', 'influencer')
                .eq('is_deleted', false);

            // Count brand owners
            const { count: brandOwnersCount } = await supabaseAdmin
                .from('users')
                .select('id', { count: 'exact', head: true })
                .eq('role', 'brand_owner')
                .eq('is_deleted', false);

            // Count admins
            const { count: adminsCount } = await supabaseAdmin
                .from('users')
                .select('id', { count: 'exact', head: true })
                .eq('role', 'admin')
                .eq('is_deleted', false);

            return res.json({
                success: true,
                stats: {
                    influencers: influencersCount || 0,
                    brand_owners: brandOwnersCount || 0,
                    admins: adminsCount || 0
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Get user verification status and details
     */
    async getVerificationStatus(req, res) {
        try {
            const userId = req.user.id;

            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select(`
                    id,
                    name,
                    role,
                    verification_status,
                    is_verified,
                    verification_priority,
                    pan_number,
                    verification_image_url,
                    verification_document_type,
                    address_line1,
                    address_city,
                    address_state,
                    address_pincode,
                    business_name,
                    business_type,
                    gst_number,
                    bio,
                    experience_years,
                    specializations,
                    portfolio_links,
                    created_at,
                    verified_at,
                    verification_notes
                `)
                .eq('id', userId)
                .single();

            if (error) {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to fetch verification status' 
                });
            }

            // Get social platforms count
            const { count: socialPlatformsCount } = await supabaseAdmin
                .from('social_platforms')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('platform_is_active', true);

            // Calculate verification completeness
            const verificationFields = [
                user.pan_number,
                user.verification_image_url,
                user.address_line1,
                user.bio,
                socialPlatformsCount > 0
            ];
            const completedFields = verificationFields.filter(Boolean).length;
            const verificationCompleteness = (completedFields / verificationFields.length) * 100;

            res.json({
                success: true,
                verification: {
                    ...user,
                    social_platforms_count: socialPlatformsCount || 0,
                    verification_completeness: Math.round(verificationCompleteness),
                    missing_fields: this.getMissingVerificationFields(user, socialPlatformsCount)
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
     * Update user verification details
     */
    async updateVerificationDetails(req, res) {
        try {
            const userId = req.user.id;
            const updateData = req.body;

            // Remove fields that shouldn't be updated by users
            const restrictedFields = [
                'verification_status',
                'is_verified',
                'verified_at',
                'verified_by',
                'verification_notes',
                'verification_priority'
            ];
            
            restrictedFields.forEach(field => delete updateData[field]);

            // Validate PAN number format if provided
            if (updateData.pan_number && !this.validatePANNumber(updateData.pan_number)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid PAN number format'
                });
            }

            // Validate GST number format if provided
            if (updateData.gst_number && !this.validateGSTNumber(updateData.gst_number)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid GST number format'
                });
            }

            const { data: updatedUser, error } = await supabaseAdmin
                .from('users')
                .update(updateData)
                .eq('id', userId)
                .select()
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update verification details'
                });
            }

            res.json({
                success: true,
                message: 'Verification details updated successfully',
                user: updatedUser
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Upload verification document
     */
    async uploadVerificationDocument(req, res) {
        try {
            const userId = req.user.id;
            const { document_type } = req.body;

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
            }

            if (!document_type || !['pan_card', 'aadhaar_card', 'passport', 'driving_license', 'voter_id'].includes(document_type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid document type'
                });
            }

            // Upload file to storage
            const { uploadImageToStorage, deleteImageFromStorage } = require('../utils/imageUpload');
            
            // Get current user to check for existing verification image
            const { data: currentUser } = await supabaseAdmin
                .from('users')
                .select('verification_image_url')
                .eq('id', userId)
                .single();

            // Upload new verification document
            const { url, error: uploadError } = await uploadImageToStorage(
                req.file.buffer,
                `verification_${userId}_${Date.now()}.${req.file.originalname.split('.').pop()}`,
                'verification-documents'
            );

            if (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to upload verification document',
                    error: uploadError
                });
            }

            // Delete old verification image if it exists
            if (currentUser?.verification_image_url) {
                await deleteImageFromStorage(currentUser.verification_image_url);
            }

            // Update user with new verification document
            const { data: updatedUser, error: updateError } = await supabaseAdmin
                .from('users')
                .update({
                    verification_image_url: url,
                    verification_document_type: document_type
                })
                .eq('id', userId)
                .select()
                .single();

            if (updateError) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update verification document'
                });
            }

            res.json({
                success: true,
                message: 'Verification document uploaded successfully',
                verification_image_url: url,
                document_type: document_type
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get missing verification fields for a user
     */
    getMissingVerificationFields(user, socialPlatformsCount = 0) {
        const missing = [];

        if (!user.pan_number) missing.push('pan_number');
        if (!user.verification_image_url) missing.push('verification_document');
        if (!user.address_line1) missing.push('address');
        if (!user.bio) missing.push('bio');
        if (socialPlatformsCount === 0) missing.push('social_media_profiles');
        
        // Role-specific missing fields
        if (user.role === 'brand_owner') {
            if (!user.business_name) missing.push('business_name');
            if (!user.business_type) missing.push('business_type');
        } else if (user.role === 'influencer') {
            if (!user.experience_years) missing.push('experience_years');
            if (!user.specializations || user.specializations.length === 0) missing.push('specializations');
        }

        return missing;
    }

    /**
     * Shape influencer public profile (exclude contact/sensitive fields)
     */
    shapeInfluencerPublic(user) {
        const {
            id,
            role,
            name,
            languages,
            categories,
            min_range,
            max_range,
            created_at,
            profile_image_url,
            bio,
            experience_years,
            specializations,
            portfolio_links,
            social_platforms
        } = user;
        return {
            id,
            role,
            name,
            languages,
            categories,
            min_range,
            max_range,
            created_at,
            profile_image_url,
            bio,
            experience_years,
            specializations,
            portfolio_links,
            social_platforms
        };
    }

    /**
     * Shape brand owner public profile (exclude contact/sensitive fields)
     */
    shapeBrandOwnerPublic(user) {
        const {
            id,
            role,
            name,
            created_at,
            business_name,
            business_type,
            business_website
        } = user;
        return {
            id,
            role,
            name,
            created_at,
            business_name,
            business_type,
            business_website
        };
    }

    /**
     * Validate PAN number format
     */
    validatePANNumber(pan) {
        const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
        return panRegex.test(pan);
    }

    /**
     * Validate GST number format
     */
    validateGSTNumber(gst) {
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        return gstRegex.test(gst);
    }

    /**
     * Get user profile with verification details
     */
    async getUserProfile(req, res) {
        try {
            const userId = req.user.id;

            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select(`
                    *,
                    social_platforms (*)
                `)
                .eq('id', userId)
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch user profile'
                });
            }

            // Get social platforms count
            const { count: socialPlatformsCount } = await supabaseAdmin
                .from('social_platforms')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('platform_is_active', true);

            // Calculate verification completeness
            const verificationFields = [
                user.pan_number,
                user.verification_image_url,
                user.address_line1,
                user.bio,
                socialPlatformsCount > 0
            ];
            const completedFields = verificationFields.filter(Boolean).length;
            const verificationCompleteness = (completedFields / verificationFields.length) * 100;

            res.json({
                success: true,
                user: {
                    ...user,
                    verification_completeness: Math.round(verificationCompleteness),
                    missing_verification_fields: this.getMissingVerificationFields(user, socialPlatformsCount)
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
     * Get influencer by ID with role-based field visibility
     */
    async getInfluencerById(req, res) {
        try {
            const { id } = req.params;
            const requesterRole = req.user.role;

            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select(`
                    *,
                    social_platforms (*),
                    requests_involved:requests!influencer_id (
                        id,
                        status,
                        created_at,
                        updated_at,
                        campaign:campaigns (
                            id, title, status, budget, start_date, end_date, created_by, created_at, updated_at
                        ),
                        bid:bids (
                            id, title, status, min_budget, max_budget, expiry_date, created_by, created_at, updated_at
                        )
                    )
                `)
                .eq('id', id)
                .eq('role', 'influencer')
                .eq('is_deleted', false)
                .single();

            if (error || !user) {
                return res.status(404).json({ success: false, message: 'Influencer not found' });
            }

            // Only admin can see full profile; include campaigns/bids involvement (already embedded)
            if (requesterRole === 'admin') {
                const campaigns = Array.from(new Map(
                    (user.requests_involved || [])
                        .map(r => r.campaign)
                        .filter(Boolean)
                        .map(c => [c.id, c])
                ).values());

                const bids = Array.from(new Map(
                    (user.requests_involved || [])
                        .map(r => r.bid)
                        .filter(Boolean)
                        .map(b => [b.id, b])
                ).values());

                // Fetch counts via RPC for this influencer
                const { data: [cnt] = [] } = await supabaseAdmin
                    .rpc('get_influencer_involvement_counts', { ids: [id] });

                const userWithCounts = {
                    ...user,
                    bids_count: Number(cnt?.bids_count || 0),
                    campaigns_count: Number(cnt?.campaigns_count || 0)
                };

                return res.json({ success: true, user: userWithCounts, campaigns, bids });
            }

            // For non-admins, return only non-contact/public fields
            const publicUser = shapeInfluencerPublic(user);
            return res.json({ success: true, user: publicUser });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Get brand owner by ID with role-based field visibility
     */
    async getBrandOwnerById(req, res) {
        try {
            const { id } = req.params;
            const requesterRole = req.user.role;

            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select(`
                    *,
                    campaigns_created:campaigns!created_by (
                        id, title, status, budget, start_date, end_date, created_by, created_at, updated_at
                    ),
                    bids_created:bids!created_by (
                        id, title, status, min_budget, max_budget, expiry_date, created_by, created_at, updated_at
                    )
                `)
                .eq('id', id)
                .eq('role', 'brand_owner')
                .eq('is_deleted', false)
                .single();

            if (error || !user) {
                return res.status(404).json({ success: false, message: 'Brand owner not found' });
            }

            // Only admin can see full profile; include campaigns/bids created and counts
            if (requesterRole === 'admin') {
                const { data: [cnt] = [] } = await supabaseAdmin
                    .rpc('get_brand_owner_involvement_counts', { ids: [id] });

                const userWithCounts = {
                    ...user,
                    created_bids_count: Number(cnt?.created_bids_count || 0),
                    created_campaigns_count: Number(cnt?.created_campaigns_count || 0),
                    requests_to_bids_count: Number(cnt?.requests_to_bids_count || 0),
                    requests_to_campaigns_count: Number(cnt?.requests_to_campaigns_count || 0)
                };

                return res.json({ success: true, user: userWithCounts, campaigns: user.campaigns_created || [], bids: user.bids_created || [] });
            }

            // For non-admins, return only non-contact/public fields
            const publicUser = shapeBrandOwnerPublic(user);
            return res.json({ success: true, user: publicUser });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
}

module.exports = {
    UserController: new UserController()
};



