const { supabaseAdmin } = require("../supabase/client");

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
}

module.exports = new BulkCampaignController();
