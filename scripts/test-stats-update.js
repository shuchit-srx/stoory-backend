const { getCampaignsStatsForInfluencer, getBidsStatsForInfluencer } = require('../utils/statsUpdates');
const { supabaseAdmin } = require('../supabase/client');

async function testStats() {
    console.log('Starting stats verification...');

    try {
        // 1. Get actual counts from DB directly
        const { count: openCampaigns } = await supabaseAdmin
            .from('campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'open');

        const { count: pendingCampaigns } = await supabaseAdmin
            .from('campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { count: closedCampaigns } = await supabaseAdmin
            .from('campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'closed');

        const { count: openBids } = await supabaseAdmin
            .from('bids')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'open');

        const { count: pendingBids } = await supabaseAdmin
            .from('bids')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { count: closedBids } = await supabaseAdmin
            .from('bids')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'closed');

        console.log('--- DB Counts ---');
        console.log('Campaigns:', { open: openCampaigns, pending: pendingCampaigns, closed: closedCampaigns });
        console.log('Bids:', { open: openBids, pending: pendingBids, closed: closedBids });

        // 2. Call the stats functions
        // We can pass any dummy ID since it shouldn't matter for global counts anymore
        const dummyUserId = '00000000-0000-0000-0000-000000000000';

        const campaignStats = await getCampaignsStatsForInfluencer(dummyUserId);
        const bidStats = await getBidsStatsForInfluencer(dummyUserId);

        console.log('\n--- Calculated Stats ---');
        console.log('Campaign Stats:', campaignStats);
        console.log('Bid Stats:', bidStats);

        // 3. Verify
        let passed = true;

        // Verify Campaigns
        if (campaignStats.new !== openCampaigns) {
            console.error(`❌ Campaign Open Count Mismatch: Expected ${openCampaigns}, Got ${campaignStats.new}`);
            passed = false;
        }
        if (campaignStats.pending !== pendingCampaigns) {
            console.error(`❌ Campaign Pending Count Mismatch: Expected ${pendingCampaigns}, Got ${campaignStats.pending}`);
            passed = false;
        }
        if (campaignStats.closed !== closedCampaigns) {
            console.error(`❌ Campaign Closed Count Mismatch: Expected ${closedCampaigns}, Got ${campaignStats.closed}`);
            passed = false;
        }
        if (campaignStats.total !== (openCampaigns + pendingCampaigns + closedCampaigns)) {
            console.error(`❌ Campaign Total Count Mismatch: Expected ${openCampaigns + pendingCampaigns + closedCampaigns}, Got ${campaignStats.total}`);
            passed = false;
        }

        // Verify Bids
        if (bidStats.new !== openBids) {
            console.error(`❌ Bid Open Count Mismatch: Expected ${openBids}, Got ${bidStats.new}`);
            passed = false;
        }
        if (bidStats.pending !== pendingBids) {
            console.error(`❌ Bid Pending Count Mismatch: Expected ${pendingBids}, Got ${bidStats.pending}`);
            passed = false;
        }
        if (bidStats.closed !== closedBids) {
            console.error(`❌ Bid Closed Count Mismatch: Expected ${closedBids}, Got ${bidStats.closed}`);
            passed = false;
        }
        if (bidStats.total !== (openBids + pendingBids + closedBids)) {
            console.error(`❌ Bid Total Count Mismatch: Expected ${openBids + pendingBids + closedBids}, Got ${bidStats.total}`);
            passed = false;
        }

        if (passed) {
            console.log('\n✅ All stats verification checks passed!');
        } else {
            console.error('\n❌ Some checks failed.');
            process.exit(1);
        }

    } catch (error) {
        console.error('Test failed with error:', error);
        process.exit(1);
    }
}

testStats();
