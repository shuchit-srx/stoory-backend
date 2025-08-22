const { supabaseAdmin } = require("../supabase/client");

/**
 * Create test campaigns and bids for the real user 'sai'
 * WITHOUT creating conversations (conversations are created dynamically when messages are sent)
 */
async function createTestDataForRealUser() {
  console.log("🔧 Creating test campaigns and bids for real user...\n");

  try {
    // Get the real user
    const realUserId = "79318220-1edb-49e1-9671-3fc683b56e82"; // sai
    const { data: realUser, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", realUserId)
      .single();

    if (userError) {
      console.log("❌ Real user not found:", userError.message);
      return;
    }

    console.log(`✅ Found real user: ${realUser.name} (${realUser.phone})`);

    // Get or create a test influencer
    let influencerId = "729cf6aa-a43f-40ce-b8cc-173791e2ca5a"; // Use existing test influencer

    // Create test campaign for the real user
    console.log("\n📢 Creating test campaign...");
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .insert({
        brand_owner_id: realUserId,
        title: "Tech Innovation Campaign",
        description: "Promoting cutting-edge technology solutions",
        budget: 5000,
        requirements: "Tech content creators with 5k+ followers",
        deliverables: "5 Instagram posts, 2 YouTube videos",
        campaign_type: "technology",
        platform: "instagram,youtube",
        content_type: "video,image",
        status: "active",
      })
      .select()
      .single();

    if (campaignError) {
      console.log("⚠️ Campaign creation failed:", campaignError.message);
      // Try to use existing campaign
      const { data: existingCampaign } = await supabaseAdmin
        .from("campaigns")
        .select("*")
        .eq("brand_owner_id", realUserId)
        .single();

      if (existingCampaign) {
        console.log("✅ Using existing campaign");
        campaign = existingCampaign;
      }
    } else {
      console.log("✅ Campaign created successfully");
    }

    // Create test bid for the real user
    console.log("\n💰 Creating test bid...");
    const { data: bid, error: bidError } = await supabaseAdmin
      .from("bids")
      .insert({
        influencer_id: influencerId,
        title: "Creative Content Bid",
        description: "I can create engaging tech content for your campaign",
        min_budget: 3000,
        max_budget: 5000,
        requirements: "High-quality video and image content",
        language: "english",
        platform: "instagram,youtube",
        content_type: "video,image",
        category: "technology",
        status: "active",
      })
      .select()
      .single();

    if (bidError) {
      console.log("⚠️ Bid creation failed:", bidError.message);
      // Try to use existing bid
      const { data: existingBid } = await supabaseAdmin
        .from("bids")
        .select("*")
        .eq("influencer_id", influencerId)
        .single();

      if (existingBid) {
        console.log("✅ Using existing bid");
        bid = existingBid;
      }
    } else {
      console.log("✅ Bid created successfully");
    }

    // Verify data was created
    console.log("\n🔍 Verifying test data...");
    const { data: userCampaigns, error: campaignsError } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("brand_owner_id", realUserId);

    const { data: userBids, error: bidsError } = await supabaseAdmin
      .from("bids")
      .select("*")
      .eq("influencer_id", realUserId);

    if (campaignsError) {
      console.log("❌ Error verifying campaigns:", campaignsError.message);
    } else {
      console.log(`✅ User has ${userCampaigns?.length || 0} campaigns`);
    }

    if (bidsError) {
      console.log("❌ Error verifying bids:", bidsError.message);
    } else {
      console.log(`✅ User has ${userBids?.length || 0} bids`);
    }

    console.log("\n🎉 Test data created successfully!");
    console.log("\n📱 Important Notes:");
    console.log("   • NO conversations were created automatically");
    console.log(
      "   • Conversations will only appear when users start chatting"
    );
    console.log("   • Use the sendMessage API to start conversations");
    console.log("\n🔗 To start a conversation:");
    console.log("   POST /api/messages/");
    console.log(
      '   Body: { message: "Hello!", receiver_id: "user_id", campaign_id: "campaign_id" }'
    );
  } catch (error) {
    console.error("💥 Failed to create test data:", error.message);
  }
}

// Run the script
if (require.main === module) {
  createTestDataForRealUser();
}

module.exports = { createTestDataForRealUser };
