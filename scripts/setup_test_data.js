const { supabaseAdmin } = require("../supabase/client");

/**
 * Setup test data for frontend testing
 * This script creates test users, conversations, and messages
 */
async function setupTestData() {
  console.log("🚀 Setting up test data for frontend testing...");

  try {
    // 1. Create or get test users
    console.log("📱 Creating test users...");

    const brandOwnerPhone = "9876543211";
    const influencerPhone = "9876543212";

    // Check if users exist, create if they don't
    let brandOwner, influencer;

    // Brand Owner
    const { data: existingBrandOwner } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("phone", brandOwnerPhone)
      .single();

    if (existingBrandOwner) {
      brandOwner = existingBrandOwner;
      console.log("✅ Brand Owner already exists:", brandOwner.name);
    } else {
      const { data: newBrandOwner, error: brandOwnerError } =
        await supabaseAdmin
          .from("users")
          .insert({
            phone: brandOwnerPhone,
            name: "Test Brand Owner",
            email: "test.brandowner@example.com",
            role: "brand_owner",
            gender: "other",
            languages: ["English", "Hindi"],
            categories: ["Technology", "Fashion"],
            min_range: 5000,
            max_range: 100000,
          })
          .select()
          .single();

      if (brandOwnerError) {
        throw new Error(
          `Failed to create brand owner: ${brandOwnerError.message}`
        );
      }

      brandOwner = newBrandOwner;
      console.log("✅ Created Brand Owner:", brandOwner.name);
    }

    // Influencer
    const { data: existingInfluencer } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("phone", influencerPhone)
      .single();

    if (existingInfluencer) {
      influencer = existingInfluencer;
      console.log("✅ Influencer already exists:", influencer.name);
    } else {
      const { data: newInfluencer, error: influencerError } =
        await supabaseAdmin
          .from("users")
          .insert({
            phone: influencerPhone,
            name: "Test Influencer",
            email: "test.influencer@example.com",
            role: "influencer",
            gender: "other",
            languages: ["English", "Hindi"],
            categories: ["Technology", "Lifestyle"],
            min_range: 1000,
            max_range: 50000,
          })
          .select()
          .single();

      if (influencerError) {
        throw new Error(
          `Failed to create influencer: ${influencerError.message}`
        );
      }

      influencer = newInfluencer;
      console.log("✅ Created Influencer:", influencer.name);
    }

    // 2. Create test campaigns and bids
    console.log("🎯 Creating test campaigns and bids...");

    // Campaign
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .insert({
        created_by: brandOwner.id,
        title: "Test Technology Campaign",
        description: "A test campaign for technology products",
        budget: 25000,
        status: "open",
        start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        requirements: "Tech-savvy influencers with 10k+ followers",
        deliverables: ["Instagram Post", "Story", "Reel"],
        campaign_type: "product",
        platform: "Instagram",
        content_type: "Video",
      })
      .select()
      .single();

    if (campaignError) {
      throw new Error(`Failed to create campaign: ${campaignError.message}`);
    }

    console.log("✅ Created Campaign:", campaign.title);

    // Bid
    const { data: bid, error: bidError } = await supabaseAdmin
      .from("bids")
      .insert({
        created_by: brandOwner.id,
        title: "Test Fashion Bid",
        description: "A test bid for fashion content",
        min_budget: 5000,
        max_budget: 15000,
        requirements: "Fashion influencers with 5k+ followers",
        language: "English",
        platform: "Instagram",
        content_type: "Photo",
        category: "Fashion",
        expiry_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      })
      .select()
      .single();

    if (bidError) {
      throw new Error(`Failed to create bid: ${bidError.message}`);
    }

    console.log("✅ Created Bid:", bid.title);

    // 3. Create test requests
    console.log("📝 Creating test requests...");

    // Campaign request
    const { data: campaignRequest, error: campaignRequestError } =
      await supabaseAdmin
        .from("requests")
        .insert({
          campaign_id: campaign.id,
          influencer_id: influencer.id,
          status: "connected",
          proposed_amount: 20000,
          message:
            "Hi! I'm interested in your technology campaign. I have 15k followers and specialize in tech content.",
        })
        .select()
        .single();

    if (campaignRequestError) {
      throw new Error(
        `Failed to create campaign request: ${campaignRequestError.message}`
      );
    }

    console.log("✅ Created Campaign Request");

    // Bid request
    const { data: bidRequest, error: bidRequestError } = await supabaseAdmin
      .from("requests")
      .insert({
        bid_id: bid.id,
        influencer_id: influencer.id,
        status: "connected",
        proposed_amount: 8000,
        message:
          "Hello! I'd love to work on your fashion bid. I have 8k followers and love creating fashion content.",
      })
      .select()
      .single();

    if (bidRequestError) {
      throw new Error(
        `Failed to create bid request: ${bidRequestError.message}`
      );
    }

    console.log("✅ Created Bid Request");

    // 4. Create test conversations
    console.log("💬 Creating test conversations...");

    // Campaign conversation
    const { data: campaignConversation, error: campaignConvError } =
      await supabaseAdmin
        .from("conversations")
        .insert({
          brand_owner_id: brandOwner.id,
          influencer_id: influencer.id,
          campaign_id: campaign.id,
          chat_status: "realtime",
          payment_required: false,
          payment_completed: false,
        })
        .select()
        .single();

    if (campaignConvError) {
      throw new Error(
        `Failed to create campaign conversation: ${campaignConvError.message}`
      );
    }

    console.log("✅ Created Campaign Conversation");

    // Bid conversation
    const { data: bidConversation, error: bidConvError } = await supabaseAdmin
      .from("conversations")
      .insert({
        brand_owner_id: brandOwner.id,
        influencer_id: influencer.id,
        bid_id: bid.id,
        chat_status: "realtime",
        payment_required: false,
        payment_completed: false,
      })
      .select()
      .single();

    if (bidConvError) {
      throw new Error(
        `Failed to create bid conversation: ${bidConvError.message}`
      );
    }

    // 5. Create test messages
    console.log("💌 Creating test messages...");

    // Campaign conversation messages
    const campaignMessages = [
      {
        conversation_id: campaignConversation.id,
        sender_id: influencer.id,
        receiver_id: brandOwner.id,
        message: "Hi! I saw your technology campaign and I'm very interested!",
        seen: true,
      },
      {
        conversation_id: campaignConversation.id,
        sender_id: brandOwner.id,
        receiver_id: influencer.id,
        message:
          "Hello! Thanks for your interest. Can you tell me more about your experience with tech content?",
        seen: true,
      },
      {
        conversation_id: campaignConversation.id,
        sender_id: influencer.id,
        receiver_id: brandOwner.id,
        message:
          "Absolutely! I've been creating tech content for 2 years, focusing on gadgets, apps, and tech reviews. I have 15k followers with 8% engagement rate.",
        seen: false,
      },
    ];

    for (const msg of campaignMessages) {
      const { error: msgError } = await supabaseAdmin.from("messages").insert({
        ...msg,
        created_at: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000), // Random time in last 24 hours
      });

      if (msgError) {
        console.warn("⚠️ Failed to create campaign message:", msgError.message);
      }
    }

    console.log("✅ Created Campaign Messages");

    // Bid conversation messages
    const bidMessages = [
      {
        conversation_id: bidConversation.id,
        sender_id: influencer.id,
        receiver_id: brandOwner.id,
        message:
          "Hi there! I love your fashion bid concept. I specialize in fashion and lifestyle content.",
        seen: true,
      },
      {
        conversation_id: bidConversation.id,
        sender_id: brandOwner.id,
        receiver_id: influencer.id,
        message: "Great! What's your follower count and engagement rate?",
        seen: true,
      },
      {
        conversation_id: bidConversation.id,
        sender_id: influencer.id,
        receiver_id: brandOwner.id,
        message:
          "I have 8k followers with 12% engagement rate. I can create high-quality fashion photos and stories.",
        seen: false,
      },
    ];

    for (const msg of bidMessages) {
      const { error: msgError } = await supabaseAdmin.from("messages").insert({
        ...msg,
        created_at: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000), // Random time in last 24 hours
      });

      if (msgError) {
        console.warn("⚠️ Failed to create bid message:", msgError.message);
      }
    }

    console.log("✅ Created Bid Messages");

    // 6. Create direct connection conversation
    console.log("🔗 Creating direct connection...");

    const { data: directConversation, error: directConvError } =
      await supabaseAdmin
        .from("conversations")
        .insert({
          brand_owner_id: brandOwner.id,
          influencer_id: influencer.id,
          chat_status: "realtime",
          payment_required: false,
          payment_completed: false,
        })
        .select()
        .single();

    if (directConvError) {
      throw new Error(
        `Failed to create direct conversation: ${directConvError.message}`
      );
    }

    // Direct conversation messages
    const directMessages = [
      {
        conversation_id: directConversation.id,
        sender_id: brandOwner.id,
        receiver_id: influencer.id,
        message:
          "Hey! I wanted to connect with you directly. Love your content!",
        seen: true,
      },
      {
        conversation_id: directConversation.id,
        sender_id: influencer.id,
        receiver_id: brandOwner.id,
        message: "Thank you! I'd love to collaborate on future projects.",
        seen: false,
      },
    ];

    for (const msg of directMessages) {
      const { error: msgError } = await supabaseAdmin.from("messages").insert({
        ...msg,
        created_at: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
      });

      if (msgError) {
        console.warn("⚠️ Failed to create direct message:", msgError.message);
      }
    }

    console.log("✅ Created Direct Connection");

    // 7. Summary
    console.log("\n🎉 Test data setup completed successfully!");
    console.log("\n📊 Test Data Summary:");
    console.log(
      `   👥 Users: ${brandOwner.name} (Brand Owner), ${influencer.name} (Influencer)`
    );
    console.log(`   🎯 Campaign: ${campaign.title}`);
    console.log(`   💰 Bid: ${bid.title}`);
    console.log(`   📝 Requests: 2 (Campaign + Bid)`);
    console.log(`   💬 Conversations: 3 (Campaign + Bid + Direct)`);
    console.log(`   💌 Messages: 8 total`);

    console.log("\n🔑 Test Login Credentials:");
    console.log(`   📱 Brand Owner: ${brandOwnerPhone} | OTP: 123456`);
    console.log(`   📱 Influencer: ${influencerPhone} | OTP: 123456`);

    console.log("\n💡 Frontend Testing:");
    console.log("   • Use the phone numbers above (without +91 prefix)");
    console.log("   • Use OTP: 123456 for all accounts");
    console.log("   • Both users will have conversations to test with");
    console.log("   • Messages are marked as seen/unseen for testing");
  } catch (error) {
    console.error("❌ Error setting up test data:", error.message);
    process.exit(1);
  }
}

// Run the setup
if (require.main === module) {
  setupTestData();
}

module.exports = { setupTestData };
