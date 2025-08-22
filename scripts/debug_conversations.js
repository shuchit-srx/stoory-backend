const { supabaseAdmin } = require("../supabase/client");

/**
 * Debug script to check conversations and test the API
 */
async function debugConversations() {
  console.log("🔍 Debugging conversations issue...\n");

  try {
    // 1. Check if conversations exist
    console.log("📊 Checking conversations in database...");
    const { data: conversations, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .limit(10);

    if (convError) {
      console.error("❌ Error fetching conversations:", convError);
      return;
    }

    console.log(`✅ Found ${conversations.length} conversations:`);
    conversations.forEach((conv, index) => {
      console.log(`   ${index + 1}. ID: ${conv.id}`);
      console.log(`      Brand Owner: ${conv.brand_owner_id}`);
      console.log(`      Influencer: ${conv.influencer_id}`);
      console.log(`      Campaign: ${conv.campaign_id || "None"}`);
      console.log(`      Bid: ${conv.bid_id || "None"}`);
      console.log(`      Chat Status: ${conv.chat_status}`);
      console.log(`      Created: ${conv.created_at}`);
      console.log(`      Updated: ${conv.updated_at}`);
      console.log("");
    });

    // 2. Check if messages exist
    console.log("💌 Checking messages in database...");
    const { data: messages, error: msgError } = await supabaseAdmin
      .from("messages")
      .select("*")
      .limit(10);

    if (msgError) {
      console.error("❌ Error fetching messages:", msgError);
      return;
    }

    console.log(`✅ Found ${messages.length} messages:`);
    messages.forEach((msg, index) => {
      console.log(`   ${index + 1}. ID: ${msg.id}`);
      console.log(`      Conversation: ${msg.conversation_id}`);
      console.log(`      Sender: ${msg.sender_id}`);
      console.log(`      Receiver: ${msg.receiver_id}`);
      console.log(`      Message: ${msg.message.substring(0, 50)}...`);
      console.log(`      Seen: ${msg.seen}`);
      console.log(`      Created: ${msg.created_at}`);
      console.log("");
    });

    // 3. Check test users
    console.log("👥 Checking test users...");
    const testPhones = ["9876543211", "9876543212"];

    for (const phone of testPhones) {
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, name, phone, role")
        .eq("phone", phone)
        .eq("is_deleted", false)
        .single();

      if (userError) {
        console.log(`   ❌ User ${phone}: ${userError.message}`);
      } else {
        console.log(
          `   ✅ User ${phone}: ${user.name} (${user.role}) - ID: ${user.id}`
        );
      }
    }

    // 4. Test the actual query that the controller uses
    console.log("\n🧪 Testing the controller query...");
    const testUserId = "9876543211"; // Brand owner phone

    // First get the user ID
    const { data: testUser, error: testUserError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("phone", testUserId)
      .eq("is_deleted", false)
      .single();

    if (testUserError) {
      console.log(`❌ Could not find test user: ${testUserError.message}`);
      return;
    }

    console.log(`✅ Test user ID: ${testUser.id}`);

    // Now test the exact query from the controller
    const {
      data: testConversations,
      error: testError,
      count,
    } = await supabaseAdmin
      .from("conversations")
      .select(
        "id, brand_owner_id, influencer_id, chat_status, campaign_id, bid_id, created_at, updated_at"
      )
      .or(`brand_owner_id.eq.${testUser.id},influencer_id.eq.${testUser.id}`)
      .order("updated_at", { ascending: false })
      .range(0, 9)
      .limit(10);

    if (testError) {
      console.error("❌ Controller query failed:", testError);
      return;
    }

    console.log(
      `✅ Controller query successful: Found ${testConversations.length} conversations`
    );

    // 5. Check for any RLS (Row Level Security) issues
    console.log("\n🔒 Checking RLS policies...");
    const { data: rlsPolicies, error: rlsError } = await supabaseAdmin.rpc(
      "get_policies",
      { table_name: "conversations" }
    );

    if (rlsError) {
      console.log(
        "⚠️ Could not check RLS policies (this is normal):",
        rlsError.message
      );
    } else {
      console.log("✅ RLS policies:", rlsPolicies);
    }

    // 6. Summary and recommendations
    console.log("\n📋 Summary:");
    console.log(`   • Conversations in DB: ${conversations.length}`);
    console.log(`   • Messages in DB: ${messages.length}`);
    console.log(`   • Test user found: ${testUser ? "Yes" : "No"}`);
    console.log(
      `   • Controller query works: ${testConversations ? "Yes" : "No"}`
    );

    if (conversations.length === 0) {
      console.log("\n🚨 Issue: No conversations found in database!");
      console.log("   Solution: Run the test data setup script:");
      console.log("   node scripts/setup_test_data.js");
    } else if (testConversations.length === 0) {
      console.log("\n🚨 Issue: User has no conversations!");
      console.log(
        "   Solution: Check if user ID matches conversation participants"
      );
    } else {
      console.log("\n✅ Database looks good! The issue might be in:");
      console.log("   • Frontend authentication token");
      console.log("   • API endpoint URL");
      console.log("   • CORS or network issues");
    }
  } catch (error) {
    console.error("💥 Debug script error:", error.message);
  }
}

// Run the debug
if (require.main === module) {
  debugConversations();
}

module.exports = { debugConversations };
