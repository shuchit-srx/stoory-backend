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
        brand_name,
        brand_description,
        brand_profile_image_url
    } = user || {};
    return {
        id,
        role,
        name,
        created_at,
        brand_name,
        brand_description,
        brand_profile_image_url
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
                    upi_id,
                    verification_image_url,
                    verification_document_type,
                    address_line1,
                    address_city,
                    address_state,
                    address_pincode,
                    brand_name,
                    brand_description,
                    brand_profile_image_url,
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

            // Get social platforms count (using is_connected instead of platform_is_active which doesn't exist)
            const { count: socialPlatformsCount } = await supabaseAdmin
                .from('social_platforms')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('is_connected', true);

            // Calculate verification completeness (role-specific)
            let verificationFields = [
                user.pan_number,
                user.verification_image_url,
                user.address_line1,
                user.bio,
                socialPlatformsCount > 0
            ];

            // Add role-specific fields
            if (user.role === 'brand_owner') {
                verificationFields.push(user.brand_name);
            } else if (user.role === 'influencer') {
                verificationFields.push(user.upi_id);
                verificationFields.push(user.experience_years);
                verificationFields.push(user.specializations && user.specializations.length > 0);
            }

            const completedFields = verificationFields.filter(Boolean).length;
            const verificationCompleteness = (completedFields / verificationFields.length) * 100;

            const missingFields = this.getMissingVerificationFields(user, socialPlatformsCount);

            res.json({
                success: true,
                verification: {
                    ...user,
                    social_platforms_count: socialPlatformsCount || 0,
                    verification_completeness: Math.round(verificationCompleteness),
                    missing_fields: missingFields,
                    missing_fields_count: missingFields.length,
                    is_registration_complete: missingFields.length === 0
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
     * Get registration status - shows what fields are missing after OTP verification
     * This endpoint helps users know what steps are remaining in their registration
     * Follows the step-based approach with role-specific field requirements
     */
    async getRegistrationStatus(req, res) {
        try {
            // Reduced logging - only log essential info

            if (!req.user || !req.user.id) {
                console.error('❌ [getRegistrationStatus] No user in request - authentication failed');
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.user.id;
            console.log('🔍 [getRegistrationStatus] Fetching user data for userId:', userId);

            // Fetch user with all required fields
            // Use * to get all columns (handles missing columns gracefully)
            // Use maybeSingle() instead of single() to handle case where user doesn't exist
            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.error('❌ [getRegistrationStatus] Supabase query error:', error);
                console.error('Error details:', JSON.stringify(error, null, 2));
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to fetch user data',
                    error: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }

            if (!user) {
                console.log('⚠️ [getRegistrationStatus] User not found for userId:', userId);
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            console.log('✅ [getRegistrationStatus] User found:', { id: user.id, role: user.role, name: user.name });

            // Get social platforms count - use the SAME query as getSocialPlatforms endpoint
            // Just check if ANY platforms exist for this user (no filters, matches how platforms are managed)
            const { data: allPlatforms, error: platformsError } = await supabaseAdmin
                .from('social_platforms')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            let socialPlatformsCount = 0;
            let hasSocialPlatforms = false;

            if (platformsError) {
                console.error('⚠️ [getRegistrationStatus] Error fetching social platforms:', platformsError);
            } else {
                socialPlatformsCount = allPlatforms?.length || 0;
                hasSocialPlatforms = socialPlatformsCount > 0;
                console.log('🔍 [getRegistrationStatus] Social platforms found:', {
                    hasSocialPlatforms,
                    count: socialPlatformsCount,
                    platforms: allPlatforms?.map(p => ({ 
                        id: p.id, 
                        platform_name: p.platform_name, 
                        username: p.username 
                    })) || []
                });
            }

            // Calculate registration status based on role
            console.log('🔍 [getRegistrationStatus] User role:', user.role);
            console.log('🔍 [getRegistrationStatus] Key fields check:', {
                pan_number: user.pan_number ? '✓' : '✗',
                upi_id: user.upi_id ? '✓' : '✗',
                name: user.name ? '✓' : '✗',
                gender: user.gender ? '✓' : '✗',
                date_of_birth: user.date_of_birth ? '✓' : '✗',
                hasSocialPlatforms: hasSocialPlatforms ? '✓' : '✗'
            });
            
            let statusResponse;
            if (user.role === 'influencer') {
                console.log('🔍 [getRegistrationStatus] Calling getInfluencerRegistrationStatus...');
                if (typeof this.getInfluencerRegistrationStatus !== 'function') {
                    console.error('❌ [getRegistrationStatus] getInfluencerRegistrationStatus is not a function!');
                    console.error('❌ [getRegistrationStatus] this keys:', Object.keys(this || {}));
                    throw new Error('getInfluencerRegistrationStatus method not found on controller instance');
                }
                statusResponse = this.getInfluencerRegistrationStatus(user, hasSocialPlatforms);
            } else if (user.role === 'brand_owner') {
                console.log('🔍 [getRegistrationStatus] Calling getBrandOwnerRegistrationStatus...');
                if (typeof this.getBrandOwnerRegistrationStatus !== 'function') {
                    console.error('❌ [getRegistrationStatus] getBrandOwnerRegistrationStatus is not a function!');
                    console.error('❌ [getRegistrationStatus] this keys:', Object.keys(this || {}));
                    throw new Error('getBrandOwnerRegistrationStatus method not found on controller instance');
                }
                statusResponse = this.getBrandOwnerRegistrationStatus(user);
            } else {
                console.log('⚠️ [getRegistrationStatus] Invalid user role:', user.role);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user role'
                });
            }

            console.log('✅ [getRegistrationStatus] Status calculated:', {
                role: statusResponse.role,
                is_complete: statusResponse.is_complete,
                progress: statusResponse.progress_percentage + '%',
                next_screen: statusResponse.next_screen,
                remaining_steps: statusResponse.remaining_steps?.map(s => s.step_id) || []
            });
            
            // Validate response structure
            if (!statusResponse.role || statusResponse.role !== user.role) {
                console.error('❌ [getRegistrationStatus] ROLE MISMATCH! User role:', user.role, 'Response role:', statusResponse.role);
                return res.status(500).json({
                    success: false,
                    message: 'Role mismatch in registration status response'
                });
            }
            
            return res.json(statusResponse);
        } catch (error) {
            console.error('❌ [getRegistrationStatus] Error fetching registration status:', error);
            console.error('❌ [getRegistrationStatus] Error stack:', error.stack);
            res.status(500).json({ 
                success: false, 
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get registration status for influencers
     */
    getInfluencerRegistrationStatus(user, hasSocialPlatforms) {
        const completedSteps = [];
        const remainingSteps = [];
        const missingRequiredFields = [];
        let completed = 0;
        let total = 0;

        // Step mapping for screen navigation
        const stepScreenMap = {
            'otp_verified': 'Otp',
            'basic_info': 'Register',
            'profile_image': 'ImageUpload',
            'kyc_pan': 'Kyc',
            'upi_id': 'Kyc',
            'social_media': 'SocialMedia',
            'languages': 'FinalStep',
            'categories': 'FinalStep',
            'pricing': 'FinalStep'
        };

        // 1. OTP Verification (always completed if user is authenticated)
        if (user.phone && user.phone.length > 0) {
            completedSteps.push({
                step_id: 'otp_verified',
                step_name: 'OTP Verification',
                completed_at: user.created_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'otp_verified',
                step_name: 'OTP Verification',
                description: 'Verify your phone number',
                screen_name: stepScreenMap['otp_verified'],
                priority: 'high'
            });
            total++;
        }

        // 2. Basic Info (name, gender, date_of_birth) - email is optional
        const userName = user.name ? String(user.name).trim() : '';
        const userGender = user.gender ? String(user.gender).trim() : '';
        const userDOB = user.date_of_birth || null;
        
        console.log('🔍 [getInfluencerRegistrationStatus] Basic info validation:', {
            name: userName || 'MISSING',
            nameLength: userName.length,
            gender: userGender || 'MISSING',
            genderLength: userGender.length,
            date_of_birth: userDOB || 'MISSING',
            rawName: user.name,
            rawGender: user.gender,
            rawDOB: user.date_of_birth
        });
        
        if (userName.length > 0 && userGender.length > 0 && userDOB) {
            completedSteps.push({
                step_id: 'basic_info',
                step_name: 'Basic Information',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            const missingBasic = [];
            if (!userName || userName.length === 0) missingBasic.push('name');
            if (!userGender || userGender.length === 0) missingBasic.push('gender');
            if (!userDOB) missingBasic.push('date_of_birth');

            remainingSteps.push({
                step_id: 'basic_info',
                step_name: 'Complete your basic information',
                description: `Missing: ${missingBasic.join(', ')}`,
                screen_name: stepScreenMap['basic_info'],
                priority: 'high'
            });
            missingRequiredFields.push(...missingBasic.map(f => ({
                field_name: f,
                field_label: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
                category: 'common',
                screen_name: stepScreenMap['basic_info']
            })));
            total++;
        }

        // 3. Profile Image (Optional - not counted in completion)
        // Note: Profile image is optional for now, so we don't count it in the total steps

        // 4. KYC - PAN Number
        const panNumber = user.pan_number ? String(user.pan_number).trim() : '';
        if (panNumber.length > 0) {
            completedSteps.push({
                step_id: 'kyc_pan',
                step_name: 'PAN Verification',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'kyc_pan',
                step_name: 'Verify your PAN number',
                description: 'Enter and verify your PAN card number',
                screen_name: stepScreenMap['kyc_pan'],
                priority: 'high'
            });
            missingRequiredFields.push({
                field_name: 'pan_number',
                field_label: 'PAN Card Number',
                category: 'common',
                screen_name: stepScreenMap['kyc_pan']
            });
            total++;
        }

        // 5. UPI ID (Influencer-specific)
        const upiId = user.upi_id ? String(user.upi_id).trim() : '';
        if (upiId.length > 0) {
            completedSteps.push({
                step_id: 'upi_id',
                step_name: 'UPI ID',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'upi_id',
                step_name: 'Add your UPI ID for payments',
                description: 'Enter your UPI ID (e.g., username@paytm)',
                screen_name: stepScreenMap['upi_id'],
                priority: 'high'
            });
            missingRequiredFields.push({
                field_name: 'upi_id',
                field_label: 'UPI ID',
                category: 'influencer',
                screen_name: stepScreenMap['upi_id']
            });
            total++;
        }

        // 6. Social Media (Influencer-specific)
        if (hasSocialPlatforms) {
            completedSteps.push({
                step_id: 'social_media',
                step_name: 'Social Media Connection',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'social_media',
                step_name: 'Connect at least one social media account',
                description: 'Connect Instagram, Facebook, or YouTube',
                screen_name: stepScreenMap['social_media'],
                priority: 'high'
            });
            missingRequiredFields.push({
                field_name: 'social_platforms',
                field_label: 'Social Platforms',
                category: 'influencer',
                screen_name: stepScreenMap['social_media']
            });
            total++;
        }

        // 7. Languages (Influencer-specific) - Optional
        // Note: Languages are optional for now, so we don't count it in the total steps

        // 8. Categories (Influencer-specific) - Optional
        // Note: Categories are optional for now, so we don't count it in the total steps

        // 9. Pricing Range (Influencer-specific) - Optional
        // Note: Pricing is optional for now, so we don't count it in the total steps

        // 10. Verification Document (Optional - not counted in completion)
        // Note: Verification image is optional, shown in optional_fields

        // Optional fields (shown but not counted in completion)
        const optionalFields = [];
        if (!user.verification_image_url) {
            optionalFields.push({
                field_name: 'verification_image_url',
                field_label: 'Verification Document',
                category: 'common',
                screen_name: 'Kyc',
                description: 'Upload a verification document (PAN, Aadhaar, etc.)'
            });
        }

        const progressPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        const nextScreen = remainingSteps.length > 0 ? remainingSteps[0].screen_name : null;

        return {
            success: true,
            role: 'influencer',
            is_complete: remainingSteps.length === 0,
            progress_percentage: progressPercentage,
            completed_steps: completedSteps,
            remaining_steps: remainingSteps,
            next_screen: nextScreen,
            missing_required_fields: missingRequiredFields,
            optional_fields: optionalFields.length > 0 ? optionalFields : undefined
        };
    }

    /**
     * Get registration status for brand owners
     */
    getBrandOwnerRegistrationStatus(user) {
        const completedSteps = [];
        const remainingSteps = [];
        const missingRequiredFields = [];
        let completed = 0;
        let total = 0;

        // Step mapping for screen navigation
        const stepScreenMap = {
            'otp_verified': 'Otp',
            'basic_info': 'Register',
            'profile_image': 'ImageUpload',
            'kyc_pan': 'Kyc',
            'business_details': 'BrandBusinessDetails'
        };

        // 1. OTP Verification (always completed if user is authenticated)
        if (user.phone && user.phone.length > 0) {
            completedSteps.push({
                step_id: 'otp_verified',
                step_name: 'OTP Verification',
                completed_at: user.created_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'otp_verified',
                step_name: 'OTP Verification',
                description: 'Verify your phone number',
                screen_name: stepScreenMap['otp_verified'],
                priority: 'high'
            });
            total++;
        }

        // 2. Basic Info (name, gender, date_of_birth) - email is optional
        const userName = user.name ? String(user.name).trim() : '';
        const userGender = user.gender ? String(user.gender).trim() : '';
        const userDOB = user.date_of_birth || null;
        
        console.log('🔍 [getBrandOwnerRegistrationStatus] Basic info validation:', {
            name: userName || 'MISSING',
            nameLength: userName.length,
            gender: userGender || 'MISSING',
            genderLength: userGender.length,
            date_of_birth: userDOB || 'MISSING',
            rawName: user.name,
            rawGender: user.gender,
            rawDOB: user.date_of_birth
        });
        
        if (userName.length > 0 && userGender.length > 0 && userDOB) {
            completedSteps.push({
                step_id: 'basic_info',
                step_name: 'Basic Information',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            const missingBasic = [];
            if (!userName || userName.length === 0) missingBasic.push('name');
            if (!userGender || userGender.length === 0) missingBasic.push('gender');
            if (!userDOB) missingBasic.push('date_of_birth');

            remainingSteps.push({
                step_id: 'basic_info',
                step_name: 'Complete your basic information',
                description: `Missing: ${missingBasic.join(', ')}`,
                screen_name: stepScreenMap['basic_info'],
                priority: 'high'
            });
            missingRequiredFields.push(...missingBasic.map(f => ({
                field_name: f,
                field_label: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
                category: 'common',
                screen_name: stepScreenMap['basic_info']
            })));
            total++;
        }

        // 3. Profile Image (Optional - not counted in completion)
        // Note: Profile image is optional for now, so we don't count it in the total steps

        // 4. KYC - PAN Number
        const panNumber = user.pan_number ? String(user.pan_number).trim() : '';
        if (panNumber.length > 0) {
            completedSteps.push({
                step_id: 'kyc_pan',
                step_name: 'PAN Verification',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'kyc_pan',
                step_name: 'Verify your PAN number',
                description: 'Enter and verify your PAN card number',
                screen_name: stepScreenMap['kyc_pan'],
                priority: 'high'
            });
            missingRequiredFields.push({
                field_name: 'pan_number',
                field_label: 'PAN Card Number',
                category: 'common',
                screen_name: stepScreenMap['kyc_pan']
            });
            total++;
        }

        // 5. Brand Details (Brand Owner-specific)
        // Only brand_name is required (from schema), business_type and business_name don't exist
        const brandName = user.brand_name ? String(user.brand_name).trim() : '';
        
        console.log('🔍 [getBrandOwnerRegistrationStatus] Brand name validation:', {
            brandName: brandName || 'MISSING',
            brandNameLength: brandName.length,
            rawBrandName: user.brand_name,
            brandNameType: typeof user.brand_name,
            brandNameTruthy: !!user.brand_name
        });
        
        if (brandName.length > 0) {
            completedSteps.push({
                step_id: 'business_details',
                step_name: 'Brand Details',
                completed_at: user.updated_at || new Date().toISOString()
            });
            completed++; total++;
        } else {
            remainingSteps.push({
                step_id: 'business_details',
                step_name: 'Add your brand name',
                description: 'Enter your brand name',
                screen_name: stepScreenMap['business_details'],
                priority: 'high'
            });
            missingRequiredFields.push({
                field_name: 'brand_name',
                field_label: 'Brand Name',
                category: 'brand_owner',
                screen_name: stepScreenMap['business_details']
            });
            total++;
        }

        // Optional fields (shown but not counted in completion)
        // Note: Based on schema, only brand_name, brand_description, and brand_profile_image_url exist
        // business_type, gst_number, business_registration_number don't exist in this schema
        const optionalFields = [];
        if (!user.brand_description) {
            optionalFields.push({
                field_name: 'brand_description',
                field_label: 'Brand Description',
                category: 'brand_owner',
                screen_name: stepScreenMap['business_details']
            });
        }
        if (!user.verification_image_url) {
            optionalFields.push({
                field_name: 'verification_image_url',
                field_label: 'Verification Document',
                category: 'common',
                screen_name: stepScreenMap['kyc_pan'],
                description: 'Upload a verification document (PAN, Aadhaar, etc.)'
            });
        }

        const progressPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        const nextScreen = remainingSteps.length > 0 ? remainingSteps[0].screen_name : null;

        return {
            success: true,
            role: 'brand_owner',
            is_complete: remainingSteps.length === 0,
            progress_percentage: progressPercentage,
            completed_steps: completedSteps,
            remaining_steps: remainingSteps,
            next_screen: nextScreen,
            missing_required_fields: missingRequiredFields,
            optional_fields: optionalFields.length > 0 ? optionalFields : undefined
        };
    }

    /**
     * Update user verification details
     * NOTE: This endpoint allows ALL users (including brand owners) to update their verification details
     * WITHOUT requiring a subscription. Subscription checks should NOT be added here.
     */
    async updateVerificationDetails(req, res) {
        try {
            const userId = req.user.id;
            const updateData = req.body;

            // IMPORTANT: No subscription check here - brand owners can update details without subscription
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

        // Common required fields for all users
        if (!user.pan_number) missing.push('pan_number');
        if (!user.verification_image_url) missing.push('verification_document');
        if (!user.address_line1) missing.push('address');
        if (!user.bio) missing.push('bio');
        if (socialPlatformsCount === 0) missing.push('social_media_profiles');
        
        // Role-specific missing fields
        if (user.role === 'brand_owner') {
            // Brand owners don't need UPI ID, but need brand name
            if (!user.brand_name) missing.push('brand_name');
        } else if (user.role === 'influencer') {
            // Influencers need UPI ID and experience/specializations
            if (!user.upi_id) missing.push('upi_id');
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

            // Fetch user with all fields including social platforms
            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select(`
                    *,
                    social_platforms (
                        id,
                        platform_name,
                        platform,
                        username,
                        profile_link,
                        followers_count,
                        engagement_rate,
                        is_connected,
                        created_at,
                        updated_at
                    )
                `)
                .eq('id', userId)
                .single();

            if (error) {
                console.error('❌ [getUserProfile] Error fetching user:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch user profile'
                });
            }

            // Ensure social_platforms is always an array
            // If relation didn't return platforms, fetch them separately (fallback)
            let socialPlatforms = user.social_platforms || [];
            
            if (!socialPlatforms || socialPlatforms.length === 0) {
                console.log('⚠️ [getUserProfile] Social platforms not found in relation, fetching separately...');
                const { data: platformsData, error: platformsError } = await supabaseAdmin
                    .from('social_platforms')
                    .select('id, platform_name, platform, username, profile_link, followers_count, engagement_rate, is_connected, created_at, updated_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });
                
                if (!platformsError && platformsData) {
                    socialPlatforms = platformsData;
                    console.log('✅ [getUserProfile] Fetched platforms separately:', socialPlatforms.length);
                }
            }

            // Get social platforms count
            const socialPlatformsCount = socialPlatforms.length;

            console.log('🔍 [getUserProfile] Social platforms:', {
                countFromRelation: user.social_platforms?.length || 0,
                countAfterFetch: socialPlatformsCount,
                platforms: socialPlatforms
            });

            // Calculate verification completeness
            const verificationFields = [
                user.pan_number,
                user.verification_image_url,
                user.address_line1,
                user.bio,
                (socialPlatformsCount || 0) > 0
            ];
            const completedFields = verificationFields.filter(Boolean).length;
            const verificationCompleteness = (completedFields / verificationFields.length) * 100;

            res.json({
                success: true,
                user: {
                    ...user,
                    social_platforms: socialPlatforms, // Use the fetched platforms array
                    verification_completeness: Math.round(verificationCompleteness),
                    missing_verification_fields: this.getMissingVerificationFields(user, socialPlatformsCount || 0)
                }
            });
        } catch (error) {
            console.error('❌ [getUserProfile] Unexpected error:', error);
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

const userControllerInstance = new UserController();

// Export with all methods explicitly bound to preserve 'this' context when called by Express
// This is necessary because Express route handlers lose 'this' context
module.exports = {
    UserController: {
        listInfluencers: userControllerInstance.listInfluencers.bind(userControllerInstance),
        listBrandOwners: userControllerInstance.listBrandOwners.bind(userControllerInstance),
        getUserStats: userControllerInstance.getUserStats.bind(userControllerInstance),
        getUserProfile: userControllerInstance.getUserProfile.bind(userControllerInstance),
        getVerificationStatus: userControllerInstance.getVerificationStatus.bind(userControllerInstance),
        getRegistrationStatus: userControllerInstance.getRegistrationStatus.bind(userControllerInstance),
        updateVerificationDetails: userControllerInstance.updateVerificationDetails.bind(userControllerInstance),
        uploadVerificationDocument: userControllerInstance.uploadVerificationDocument.bind(userControllerInstance),
        getInfluencerById: userControllerInstance.getInfluencerById.bind(userControllerInstance),
        getBrandOwnerById: userControllerInstance.getBrandOwnerById.bind(userControllerInstance),
    }
};



