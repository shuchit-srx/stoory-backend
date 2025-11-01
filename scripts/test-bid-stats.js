/**
 * Test script to verify bid stats calculation
 * Compares listing counts vs stats counts for a specific user
 */

const request = require('supertest');
const { app, server } = require('../index');
const authService = require('../utils/auth');

let influencerToken = '';
let influencerUserId = '';
let influencerRole = '';

async function run() {
  try {
    console.log('🔍 Testing Bid Stats Calculation...\n');

    // 1. Login as influencer (using test user)
    console.log('1. Logging in as influencer...');
    const loginRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({
        phone: authService.testUsers?.influencer?.phone || '+919876543210',
        token: authService.testUsers?.influencer?.otp || '123456',
      });

    if (loginRes.statusCode !== 200 || !loginRes.body.token) {
      console.error('❌ Login failed:', loginRes.body);
      throw new Error('Failed to login as influencer');
    }

    influencerToken = loginRes.body.token;
    influencerUserId = loginRes.body.user.id;
    influencerRole = loginRes.body.user.role;
    console.log(`✅ Logged in as influencer: ${influencerUserId} (role: ${influencerRole})\n`);

    // 2. Get bids listing with status=pending
    console.log('2. Getting pending bids from listing...');
    const pendingListRes = await request(app)
      .get('/api/bids?status=pending&limit=100')
      .set('Authorization', `Bearer ${influencerToken}`);

    if (pendingListRes.statusCode !== 200) {
      console.error('❌ Failed to get pending bids:', pendingListRes.body);
    } else {
      const pendingBidsCount = pendingListRes.body.bids?.length || 0;
      console.log(`   📋 Listing shows ${pendingBidsCount} pending bids`);
      if (pendingBidsCount > 0) {
        console.log(`   📋 Bid IDs: ${pendingListRes.body.bids.map(b => b.id).join(', ')}`);
      }
    }

    // 3. Get bid stats
    console.log('\n3. Getting bid stats...');
    const statsRes = await request(app)
      .get('/api/bids/stats')
      .set('Authorization', `Bearer ${influencerToken}`);

    if (statsRes.statusCode !== 200) {
      console.error('❌ Failed to get stats:', statsRes.body);
      throw new Error('Failed to get stats');
    }

    console.log('   📊 Stats Response:', JSON.stringify(statsRes.body, null, 2));

    const stats = statsRes.body.stats;
    const pendingFromStats = stats.pending || stats.new || 0; // Check both 'pending' and 'new' fields
    
    console.log(`\n4. Comparison:`);
    console.log(`   📋 Listing pending count: ${pendingListRes.body.bids?.length || 0}`);
    console.log(`   📊 Stats pending count: ${pendingFromStats}`);
    console.log(`   📊 Stats new count: ${stats.new || 0}`);
    console.log(`   📊 Stats closed count: ${stats.closed || 0}`);
    console.log(`   📊 Stats total: ${stats.total || 0}`);

    if ((pendingListRes.body.bids?.length || 0) !== pendingFromStats) {
      console.log(`\n❌ MISMATCH DETECTED! Listing shows ${pendingListRes.body.bids?.length || 0} but stats shows ${pendingFromStats}`);
      console.log(`\n   Debugging info:`);
      console.log(`   - User ID: ${influencerUserId}`);
      console.log(`   - User Role: ${influencerRole}`);
      console.log(`   - Listing returned ${pendingListRes.body.bids?.length || 0} pending bids`);
      console.log(`   - Stats returned ${pendingFromStats} pending`);
    } else {
      console.log(`\n✅ Stats match listing!`);
    }

    // 5. Get campaigns listing and stats for comparison
    console.log('\n5. Testing campaign stats...');
    const campaignPendingListRes = await request(app)
      .get('/api/campaigns?status=pending&limit=100')
      .set('Authorization', `Bearer ${influencerToken}`);

    const campaignStatsRes = await request(app)
      .get('/api/campaigns/stats')
      .set('Authorization', `Bearer ${influencerToken}`);

    if (campaignStatsRes.statusCode === 200) {
      const campaignStats = campaignStatsRes.body.stats;
      console.log(`   📋 Campaign listing pending: ${campaignPendingListRes.body.campaigns?.length || 0}`);
      console.log(`   📊 Campaign stats pending: ${campaignStats.pending || 0}`);
      console.log(`   📊 Campaign stats new: ${campaignStats.new || 0}`);
      console.log(`   📊 Campaign stats closed: ${campaignStats.closed || 0}`);
      console.log(`   📊 Campaign stats total: ${campaignStats.total || 0}`);
    }

    console.log('\n✅ Test completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.body);
    }
    process.exit(1);
  } finally {
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  }
}

run();

