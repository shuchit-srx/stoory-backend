require('dotenv').config();
const mockUsersService = require('../services/mockUsersService');

async function seedMockUsers() {
  console.log('🚀 Starting mock users seeding...\n');
  
  if (!mockUsersService.isMockUsersEnabled()) {
    console.error('❌ Mock users are disabled!');
    console.log('   Set ENABLE_MOCK_USERS=true in your .env file to enable mock users.\n');
    process.exit(1);
  }

  console.log('✅ Mock users are enabled\n');
  
  const result = await mockUsersService.createAllMockUsers();
  
  if (result.success) {
    console.log('\n✅ Mock users setup completed successfully!\n');
    console.log('Summary:');
    console.log(`  Total: ${result.results.summary.total}`);
    console.log(`  Created: ${result.results.summary.created}`);
    console.log(`  Existing: ${result.results.summary.existing}`);
    console.log(`  Failed: ${result.results.summary.failed}\n`);
    
    // Display credentials
    const credentials = mockUsersService.getMockUserCredentials();
    console.log('📋 Mock User Credentials:');
    console.log(`   OTP: ${credentials.otp}\n`);
    
    console.log('Admins:');
    credentials.users.admins.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.name} - ${u.phone}`);
    });
    
    console.log('\nBrand Owners:');
    credentials.users.brandOwners.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.name} (${u.brand_name}) - ${u.phone}`);
    });
    
    console.log('\nInfluencers:');
    credentials.users.influencers.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.name} - ${u.phone}`);
    });
  } else {
    console.error('\n❌ Failed to setup mock users:', result.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedMockUsers()
    .then(() => {
      console.log('\n✨ Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n💥 Error:', err);
      process.exit(1);
    });
}

module.exports = { seedMockUsers };

