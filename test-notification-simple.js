const fcmService = require('./services/fcmService');
const { supabaseAdmin } = require('./supabase/client');

async function sendSimpleTestNotification() {
  console.log('🚀 Starting simple FCM test notification...');
  
  try {
    // Check if FCM service is initialized
    if (!fcmService.initialized) {
      console.log('❌ FCM service is not initialized. Please check your Firebase configuration.');
      return;
    }

    // Get the first active FCM token
    console.log('📋 Fetching first active FCM token...');
    const { data: tokens, error } = await supabaseAdmin
      .from('fcm_tokens')
      .select(`
        user_id,
        token,
        device_type,
        users!inner(email, name)
      `)
      .eq('is_active', true)
      .limit(1)
      .order('last_used_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching FCM tokens:', error);
      return;
    }

    if (!tokens || tokens.length === 0) {
      console.log('ℹ️ No active FCM tokens found. Users need to register their tokens first.');
      return;
    }

    const token = tokens[0];
    console.log(`📱 Found token for user: ${token.users.email} (${token.users.name || 'No name'})`);
    console.log(`   Device: ${token.device_type}, Token: ${token.token.substring(0, 20)}...`);

    // Test notification payload
    const testNotification = {
      title: '🎉 Stoory Test Notification',
      body: 'This is a test notification from the Stoory backend. FCM is working perfectly!',
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
        source: 'backend_test',
        message: 'Hello from Stoory backend!'
      }
    };

    // Send notification to the user
    console.log('📤 Sending test notification...');
    const result = await fcmService.sendNotificationToUser(token.user_id, testNotification);
    
    if (result.success) {
      console.log('✅ Test notification sent successfully!');
      console.log(`📊 Results: ${result.sent} sent, ${result.failed} failed`);
      
      if (result.details) {
        console.log('📋 Details:', result.details);
      }
    } else {
      console.log('❌ Failed to send test notification:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
  }
}

// Run the test
sendSimpleTestNotification().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});
