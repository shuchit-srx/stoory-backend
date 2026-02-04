/**
 * Script to check and expire campaigns that have passed their expiry time
 * This should be run periodically (e.g., via cron job every hour)
 * 
 * Usage: node scripts/check-campaign-expiry.js
 */

const CampaignService = require('../services/campaignService');

async function main() {
  console.log('[check-campaign-expiry] Starting campaign expiry check...');
  
  try {
    const result = await CampaignService.checkAndExpireCampaigns();
    
    if (result.success) {
      console.log(`[check-campaign-expiry] ${result.message}`);
      if (result.expiredCount > 0) {
        console.log(`[check-campaign-expiry] Expired campaign IDs: ${result.expiredCampaignIds.join(', ')}`);
      }
      process.exit(0);
    } else {
      console.error(`[check-campaign-expiry] Error: ${result.error || result.message}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('[check-campaign-expiry] Exception:', error);
    process.exit(1);
  }
}

main();

