const { supabaseAdmin } = require("../supabase/client");
const { uploadImageToStorage } = require("../utils/imageUpload");
const path = require("path");
const crypto = require("crypto");

class BulkCampaignController {

    /**
     * Get Dashboard Stats (Pulse Check)
     * GET /dashboard/stats
     */
    async getDashboardStats(req, res) {
        try {
            const userId = req.user.id;

            // 1. Get all campaigns created by this user first
            // We need this list to filter submissions manually
            const { data: userCampaigns, error: campaignsError } = await supabaseAdmin
                .from('bulk_campaigns')
                .select('*')
                .eq('created_by', userId);

            if (campaignsError) throw campaignsError;

            const userCampaignIds = userCampaigns.map(c => c.id);
            const activeCampaigns = userCampaigns.filter(c => c.status === 'active');
            const activeCampaignIds = activeCampaigns.map(c => c.id);

            // 1. Active Campaigns Count
            const activeCampaignsCount = activeCampaigns.length;

            // 2. Total Creators (Unique count across active bulk campaigns)
            let uniqueCreators = 0;
            if (activeCampaignIds.length > 0) {
                const { data: activeCreators, error: creatorsError } = await supabaseAdmin
                    .from('bulk_submissions')
                    .select('influencer_id')
                    .in('bulk_campaign_id', activeCampaignIds)
                    .in('status', ['approved', 'work_submitted', 'completed']); // 'active' creators

                if (creatorsError) throw creatorsError;
                uniqueCreators = new Set(activeCreators.map(s => s.influencer_id)).size;
            }

            // 3. Pending Actions
            let submissionReviewsCount = 0;
            let applicationReviewsCount = 0;
            let totalSpent = 0;

            if (userCampaignIds.length > 0) {
                // Submission Reviews: status = 'work_submitted'
                const { count: subCount, error: pendingSubError } = await supabaseAdmin
                    .from('bulk_submissions')
                    .select('*', { count: 'exact', head: true })
                    .in('bulk_campaign_id', userCampaignIds)
                    .eq('status', 'work_submitted');

                if (pendingSubError) throw pendingSubError;
                submissionReviewsCount = subCount || 0;

                // Application Reviews: status = 'applied'
                const { count: appCount, error: pendingAppError } = await supabaseAdmin
                    .from('bulk_submissions')
                    .select('*', { count: 'exact', head: true })
                    .in('bulk_campaign_id', userCampaignIds)
                    .eq('status', 'applied');

                if (pendingAppError) throw pendingAppError;
                applicationReviewsCount = appCount || 0;

                // 4. Financials - Total Spent (Approved deliverables)
                const { data: approvedSubmissions, error: spentError } = await supabaseAdmin
                    .from('bulk_submissions')
                    .select('final_agreed_amount')
                    .in('bulk_campaign_id', userCampaignIds)
                    .eq('status', 'completed');

                if (spentError) throw spentError;
                totalSpent = approvedSubmissions.reduce((sum, s) => sum + (parseFloat(s.final_agreed_amount) || 0), 0);
            }

            // Total Budget Committed (Sum of budget of all non-draft campaigns)
            // Using the campaigns we already fetched
            const totalBudgetCommitted = userCampaigns
                .filter(c => c.status !== 'draft')
                .reduce((sum, c) => sum + (parseFloat(c.budget) || 0), 0);


            // 5. Widgets Data (Simplified for now)
            // Recent Campaigns
            // We can re-query with limit/order or just sort the fetched ones if list is small.
            // But let's follow the original pattern for latest 3 to be safe on pagination logic later.
            const { data: recentCampaigns, error: recentError } = await supabaseAdmin
                .from('bulk_campaigns')
                .select('id, title, status, updated_at')
                .eq('created_by', userId)
                .order('updated_at', { ascending: false })
                .limit(3);

            if (recentError) throw recentError;

            res.json({
                success: true,
                data: {
                    kpis: {
                        active_campaigns: activeCampaignsCount || 0,
                        total_creators: uniqueCreators,
                        pending_actions: {
                            submission_reviews: submissionReviewsCount,
                            application_reviews: applicationReviewsCount
                        },
                        financials: {
                            total_budget_committed: totalBudgetCommitted,
                            total_spent: totalSpent
                        }
                    },
                    widgets: {
                        recent_campaigns: recentCampaigns || [],
                        activity_feed: [],
                        performance_chart: []
                    }
                }
            });

        } catch (error) {
            console.error("Error getting dashboard stats:", error);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    }

    /**
     * Get Bulk Campaigns List
     * Handled via GET /campaigns?type=BULK
     */
    async getBulkCampaigns(req, res) {
        try {
            const userId = req.user.id;
            const { page = 1, limit = 10, status } = req.query;
            const offset = (page - 1) * limit;

            let query = supabaseAdmin
                .from('bulk_campaigns')
                .select('*')
                .eq('created_by', userId);

            if (status) {
                query = query.eq('status', status);
            }

            const { data: campaigns, error, count } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;

            // START: Enriched counters (invited, applied, accepted, pending)
            // Since supabase raw queries are limited, we might need a separate aggregation or rpc 
            // For now, we'll do a secondary query to get counts per campaign if volume is low, 
            // or rely on a view. Let's do a simple group by or separate counts for now to be safe and accurate.

            // Fetch all submissions for these campaigns to aggregate in memory (efficient for page=10)
            const campaignIds = campaigns.map(c => c.id);
            let statsMap = {};

            if (campaignIds.length > 0) {
                const { data: submissions } = await supabaseAdmin
                    .from('bulk_submissions')
                    .select('bulk_campaign_id, status')
                    .in('bulk_campaign_id', campaignIds);

                submissions?.forEach(sub => {
                    if (!statsMap[sub.bulk_campaign_id]) {
                        statsMap[sub.bulk_campaign_id] = { applied: 0, accepted: 0, pending: 0, invited: 0 };
                    }
                    const s = statsMap[sub.bulk_campaign_id];

                    if (sub.status === 'applied') s.applied++;
                    if (['approved', 'work_submitted', 'completed'].includes(sub.status)) s.accepted++;
                    if (sub.status === 'work_submitted') s.pending++;
                    // invited not tracked in submissions table usually, unless status='invited'. Assuming separate table or logic.
                });
            }

            const enrichedCampaigns = campaigns.map(c => ({
                ...c,
                budget_total: c.budget,
                // budget_remaining logic would go here
                counters: {
                    applied_count: statsMap[c.id]?.applied || 0,
                    accepted_count: statsMap[c.id]?.accepted || 0,
                    submissions_pending_count: statsMap[c.id]?.pending || 0,
                    invited_count: 0 // Placeholder as invites table not defined yet
                }
            }));

            res.json({
                success: true,
                campaigns: enrichedCampaigns,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limit),
                }
            });

        } catch (error) {
            console.error("Error getting bulk campaigns:", error);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    }
    
    async createBulkCampaign(req, res) {
        try {
            const userId = req.user.id;
            const formData = req.body;

            // Validate required fields
            if (!formData.title || !formData.deadline) {
                return res.status(400).json({
                    success: false,
                    message: "Title and deadline are required",
                });
            }

            // Handle reference files upload (multiple files)
            let referenceFilesUrls = [];
            
            // First, add links as reference file objects
            if (formData.links && Array.isArray(formData.links)) {
                formData.links.forEach(link => {
                    if (link && link.trim().length > 0) {
                        referenceFilesUrls.push({
                            name: `Link: ${link}`,
                            url: link.trim(),
                            type: 'link',
                            size: 0
                        });
                    }
                });
            }
            
            // Then handle uploaded files
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    try {
                        // Check if it's an image
                        if (file.mimetype.startsWith('image/')) {
                            const { url, error } = await uploadImageToStorage(
                                file.buffer,
                                file.originalname,
                                "campaigns/references"
                            );
                            if (!error && url) {
                                referenceFilesUrls.push({
                                    name: file.originalname,
                                    url: url,
                                    type: file.mimetype,
                                    size: file.size
                                });
                            }
                        } else {
                            // Handle other file types (PDF, videos, etc.) - upload to attachments bucket
                            const timestamp = Date.now();
                            const randomString = crypto.randomBytes(8).toString('hex');
                            const ext = path.extname(file.originalname);
                            const uniqueFileName = `campaigns/references/${userId}/${timestamp}_${randomString}${ext}`;
                            
                            const { data, error: uploadError } = await supabaseAdmin.storage
                                .from('attachments')
                                .upload(uniqueFileName, file.buffer, {
                                    contentType: file.mimetype,
                                    cacheControl: '3600',
                                    upsert: false
                                });
                            
                            if (!uploadError && data) {
                                const { data: urlData } = supabaseAdmin.storage
                                    .from('attachments')
                                    .getPublicUrl(uniqueFileName);
                                
                                if (urlData?.publicUrl) {
                                    referenceFilesUrls.push({
                                        name: file.originalname,
                                        url: urlData.publicUrl,
                                        type: file.mimetype,
                                        size: file.size
                                    });
                                }
                            } else {
                                console.error(`Error uploading file ${file.originalname}:`, uploadError);
                            }
                        }
                    } catch (fileError) {
                        console.error(`Error uploading file ${file.originalname}:`, fileError);
                    }
                }
            }

            // Parse tier pricing structure
            const tierPrices = formData.tierPrices || {};
            const tierMaxCreators = formData.tierMaxCreators || {};
            const budgetType = formData.budgetType || 'creators';
            
            // Define tier mapping
            const tierMapping = {
                "Nano (1K-10K)": "nano",
                "Micro (10K-50K)": "micro",
                "Mid (50K-500K)": "mid",
                "Macro (500K+)": "macro"
            };

            // Build tier pricing structure
            const tierPricingStructure = {};
            let totalBudget = 0;

            if (budgetType === 'creators') {
                // Mode: Set creators per tier
                Object.keys(tierPrices).forEach(tierKey => {
                    const normalizedTier = tierMapping[tierKey] || tierKey.toLowerCase();
                    const price = parseFloat(tierPrices[tierKey] || 0);
                    const maxCreators = parseInt(tierMaxCreators[tierKey] || 0);
                    
                    if (price > 0 && maxCreators > 0) {
                        const tierTotal = price * maxCreators;
                        tierPricingStructure[normalizedTier] = {
                            price_per_creator: price,
                            max_creators: maxCreators,
                            tier_total: tierTotal,
                            follower_range: tierKey
                        };
                        
                        totalBudget += tierTotal;
                    }
                });
            } else if (budgetType === 'total') {
                // Mode: Set total budget
                const totalBudgetAmount = parseFloat(formData.totalBudget || 0);
                totalBudget = totalBudgetAmount;
                tierPricingStructure.total_budget = totalBudgetAmount;
            }

            // If no tier pricing and no total budget, use fallback
            if (totalBudget === 0) {
                totalBudget = parseFloat(formData.budget || formData.totalBudget || 0);
            }

            // Handle languages and categories
            const languagesRaw = formData.languages || [];
            const categoriesRaw = formData.categories || [];
            
            const languages = Array.isArray(languagesRaw) 
                ? languagesRaw.map(v => String(v).toLowerCase()) 
                : [];
            const categories = Array.isArray(categoriesRaw) 
                ? categoriesRaw.map(v => String(v).toLowerCase()) 
                : [];

            // Parse deliverables
            const deliverables = Array.isArray(formData.deliverables) 
                ? formData.deliverables.filter(d => d && d.trim().length > 0)
                : [];

            // Parse deadline and buffer days
            const deadline = new Date(formData.deadline);
            const bufferDays = parseInt(formData.bufferDays || 3);

            // Extract platform from deliverables if not provided
            let platform = formData.platform || null;
            if (!platform && deliverables.length > 0) {
                // Try to infer platform from deliverables
                const deliverableStr = deliverables.join(' ').toLowerCase();
                if (deliverableStr.includes('instagram') || deliverableStr.includes('insta')) {
                    platform = 'instagram';
                } else if (deliverableStr.includes('youtube')) {
                    platform = 'youtube';
                } else if (deliverableStr.includes('facebook')) {
                    platform = 'facebook';
                }
            }

            // Build bulk campaign data for bulk_campaigns table
            const bulkCampaignData = {
                title: formData.title,
                description: formData.description || "",
                
                // Step 1: Basic Info
                categories: categories,
                languages: languages,
                reference_files: referenceFilesUrls,
                
                // Step 2: Deliverables
                deliverables: deliverables,
                
                // Step 3: Pricing
                deadline: deadline.toISOString().split('T')[0],
                buffer_days: bufferDays,
                tier_pricing: tierPricingStructure,
                total_budget: totalBudget,
                budget: totalBudget, // Also set budget field as fallback
                
                // Additional fields
                platform: platform,
                image_url: referenceFilesUrls.length > 0 ? referenceFilesUrls[0].url : null,
                requirements: formData.requirements || formData.deliverablesDescription || null,
                
                // Status
                status: "open",
                created_by: userId,
            };

            console.log("Creating bulk campaign with data:", {
                userId: userId,
                campaignData: {
                    title: bulkCampaignData.title,
                    total_budget: bulkCampaignData.total_budget,
                    platform: bulkCampaignData.platform,
                    tier_pricing: bulkCampaignData.tier_pricing,
                    categories_count: categories.length,
                    languages_count: languages.length,
                    deliverables_count: deliverables.length,
                    tiers_configured: Object.keys(tierPricingStructure).length,
                    reference_files_uploaded: referenceFilesUrls.length
                }
            });

            // Insert into bulk_campaigns table
            const { data: campaign, error } = await supabaseAdmin
                .from("bulk_campaigns")
                .insert(bulkCampaignData)
                .select()
                .single();

            if (error) {
                console.error("Database error creating bulk campaign:", error);
                console.error("Error details:", {
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                    code: error.code
                });
                console.error("Attempted to insert:", JSON.stringify(bulkCampaignData, null, 2));
                return res.status(500).json({
                    success: false,
                    message: "Failed to create bulk campaign",
                    error: error.message,
                    details: error.details,
                    hint: error.hint
                });
            }

            console.log("Bulk campaign created successfully:", campaign.id);
            res.status(201).json({
                success: true,
                campaign: campaign,
                message: "Bulk campaign created successfully",
                summary: {
                    total_budget: totalBudget,
                    tiers_configured: Object.keys(tierPricingStructure).length,
                    reference_files_uploaded: referenceFilesUrls.length,
                    deliverables_count: deliverables.length
                }
            });
        } catch (error) {
            console.error("Exception creating bulk campaign:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message,
            });
        }
    }
}

module.exports = new BulkCampaignController();
