const { supabaseAdmin } = require("../db/config");
const authService = require("./authService");
const profileService = require("./profileService");
const portfolioService = require("./portfolioService");

/**
 * Mock Users Service
 * Creates and manages mock users for testing
 * All mock users use OTP: 123456
 * Enable with ENABLE_MOCK_USERS=true in environment
 */
class MockUsersService {
  constructor() {
    // Check if mock users are enabled
    this.isEnabled = process.env.ENABLE_MOCK_USERS === "true";

    // Define mock users: 3 admins, 5 brand owners, 8 influencers
    this.mockUsers = {
      admins: [
        {
          phone: "+919876543001",
          name: "Aarav Sharma ADM",
          email: "aarav.sharma.adm@stoory.test",
          role: "ADMIN",
        },
        {
          phone: "+919876543002",
          name: "Bhavya Patel ADM",
          email: "bhavya.patel.adm@stoory.test",
          role: "ADMIN",
        },
        {
          phone: "+919876543003",
          name: "Chetan Kumar ADM",
          email: "chetan.kumar.adm@stoory.test",
          role: "ADMIN",
        },
      ],
      brandOwners: [
        {
          phone: "+919876543101",
          name: "Dhruv Agarwal BO",
          email: "dhruv.agarwal.bo@stoory.test",
          role: "BRAND_OWNER",
          brand_name: "TechVista Solutions",
          brand_description: "Leading technology solutions provider specializing in enterprise software",
        },
        {
          phone: "+919876543102",
          name: "Esha Reddy BO",
          email: "esha.reddy.bo@stoory.test",
          role: "BRAND_OWNER",
          brand_name: "Fashion Forward",
          brand_description: "Trendsetting fashion brand for modern millennials",
        },
        {
          phone: "+919876543103",
          name: "Faisal Khan BO",
          email: "faisal.khan.bo@stoory.test",
          role: "BRAND_OWNER",
          brand_name: "Gourmet Delights",
          brand_description: "Premium gourmet food and beverage company",
        },
        {
          phone: "+919876543104",
          name: "Gauri Mehta BO",
          email: "gauri.mehta.bo@stoory.test",
          role: "BRAND_OWNER",
          brand_name: "HealthFit Pro",
          brand_description: "Premium fitness and wellness brand",
        },
        {
          phone: "+919876543105",
          name: "Harsh Joshi BO",
          email: "harsh.joshi.bo@stoory.test",
          role: "BRAND_OWNER",
          brand_name: "Beauty Essentials",
          brand_description: "Natural beauty and skincare products",
        },
      ],
      influencers: [
        {
          phone: "+919876543201",
          name: "Ishita Verma INF",
          email: "ishita.verma.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Tech enthusiast and gadget reviewer. Love exploring the latest technology trends.",
          categories: ["Technology", "Gadgets"],
          languages: ["English", "Hindi"],
          gender: "FEMALE",
          tier: "MICRO",
          min_value: 5000,
          max_value: 25000,
          city: "Mumbai",
          country: "India",
        },
        {
          phone: "+919876543202",
          name: "Jayesh Desai INF",
          email: "jayesh.desai.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Fashion and lifestyle content creator. Sharing style tips and trends.",
          categories: ["Fashion", "Lifestyle"],
          languages: ["English", "Hindi"],
          gender: "MALE",
          tier: "MID",
          min_value: 10000,
          max_value: 50000,
          city: "Delhi",
          country: "India",
        },
        {
          phone: "+919876543203",
          name: "Kavya Nair INF",
          email: "kavya.nair.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Food blogger and recipe creator. Passionate about cooking and food photography.",
          categories: ["Food", "Cooking"],
          languages: ["English", "Hindi"],
          gender: "FEMALE",
          tier: "NANO",
          min_value: 2000,
          max_value: 10000,
          city: "Bangalore",
          country: "India",
        },
        {
          phone: "+919876543204",
          name: "Lakshya Singh INF",
          email: "lakshya.singh.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Fitness coach and wellness advocate. Helping people achieve their fitness goals.",
          categories: ["Fitness", "Health"],
          languages: ["English"],
          gender: "MALE",
          tier: "MACRO",
          min_value: 25000,
          max_value: 100000,
          city: "Pune",
          country: "India",
        },
        {
          phone: "+919876543205",
          name: "Meera Iyer INF",
          email: "meera.iyer.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Beauty and makeup artist. Creating stunning looks and sharing beauty tips.",
          categories: ["Beauty", "Makeup"],
          languages: ["English", "Hindi"],
          gender: "FEMALE",
          tier: "MICRO",
          min_value: 5000,
          max_value: 30000,
          city: "Chennai",
          country: "India",
        },
        {
          phone: "+919876543206",
          name: "Nikhil Rao INF",
          email: "nikhil.rao.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Travel vlogger and adventure seeker. Exploring beautiful destinations around the world.",
          categories: ["Travel", "Adventure"],
          languages: ["English"],
          gender: "MALE",
          tier: "MID",
          min_value: 15000,
          max_value: 60000,
          city: "Goa",
          country: "India",
        },
        {
          phone: "+919876543207",
          name: "Omkar Thakur INF",
          email: "omkar.thakur.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Gaming content creator and streamer. Sharing gaming tips and entertaining gameplay.",
          categories: ["Gaming", "Entertainment"],
          languages: ["English", "Hindi"],
          gender: "MALE",
          tier: "NANO",
          min_value: 3000,
          max_value: 15000,
          city: "Hyderabad",
          country: "India",
        },
        {
          phone: "+919876543208",
          name: "Priya Menon INF",
          email: "priya.menon.inf@stoory.test",
          role: "INFLUENCER",
          bio: "Parenting and family lifestyle blogger. Sharing parenting tips and family moments.",
          categories: ["Parenting", "Lifestyle"],
          languages: ["English", "Hindi"],
          gender: "FEMALE",
          tier: "MICRO",
          min_value: 4000,
          max_value: 20000,
          city: "Kolkata",
          country: "India",
        },
      ],
    };

    // Mock OTP for all users
    this.mockOTP = "123456";

    // Real URLs for social media and portfolio
    this.realUrls = {
      instagram: [
        "https://www.instagram.com/p/C1XyZ9QrK5N/",
        "https://www.instagram.com/p/C2AbC3DsL8M/",
        "https://www.instagram.com/p/C3BcD4EtN9O/",
        "https://www.instagram.com/p/C4CdE5FuO0P/",
        "https://www.instagram.com/p/C5DeF6GvP1Q/",
        "https://www.instagram.com/p/C6EfG7HwQ2R/",
        "https://www.instagram.com/p/C7FgH8IxR3S/",
        "https://www.instagram.com/p/C8GhI9JyS4T/",
      ],
      youtube: [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        "https://www.youtube.com/watch?v=9bZkp7q19f0",
        "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
        "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
        "https://www.youtube.com/watch?v=OPf0YbXqDm0",
        "https://www.youtube.com/watch?v=YQHsXMglC9A",
        "https://www.youtube.com/watch?v=ZbZSe6N_BXs",
      ],
      facebook: [
        "https://www.facebook.com/photo/?fbid=123456789&set=a.123456789",
        "https://www.facebook.com/photo/?fbid=234567890&set=a.234567890",
        "https://www.facebook.com/photo/?fbid=345678901&set=a.345678901",
        "https://www.facebook.com/photo/?fbid=456789012&set=a.456789012",
      ],
      portfolio: {
        images: [
          "https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1553484771-371f6053368b?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557683316-973673baf926?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557683311-eac922347aa1?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682260-96773eb01377?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682259-0ddb5cd0e58f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682259-0ddb5cd0e58f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682259-0ddb5cd0e58f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682259-0ddb5cd0e58f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682259-0ddb5cd0e58f?w=800&h=600&fit=crop",
          "https://images.unsplash.com/photo-1557682250-33bd909cac85?w=800&h=600&fit=crop",
      ],
        videos: [
          "https://videos.pexels.com/video-files/3045163/3045163-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/2491284/2491284-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/3045517/3045517-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/2495382/2495382-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/3045163/3045163-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/2491284/2491284-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/3045517/3045517-hd_1920_1080_30fps.mp4",
          "https://videos.pexels.com/video-files/2495382/2495382-hd_1920_1080_30fps.mp4",
        ],
        thumbnails: [
          "https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=400&h=300&fit=crop",
          "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=400&h=300&fit=crop",
          "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop",
          "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop",
        ],
      },
    };
  }

  /**
   * Check if mock users are enabled
   */
  isMockUsersEnabled() {
    return this.isEnabled;
  }

  /**
   * Check if a phone number is a mock user
   */
  isMockUser(phone) {
    if (!this.isEnabled) {
      return false;
    }
    const allPhones = [
      ...this.mockUsers.admins.map((u) => u.phone),
      ...this.mockUsers.brandOwners.map((u) => u.phone),
      ...this.mockUsers.influencers.map((u) => u.phone),
    ];
    return allPhones.includes(phone);
  }

  /**
   * Get mock user data by phone
   */
  getMockUserData(phone) {
    if (!this.isEnabled) {
      return null;
    }
    const allUsers = [
      ...this.mockUsers.admins,
      ...this.mockUsers.brandOwners,
      ...this.mockUsers.influencers,
    ];
    return allUsers.find((u) => u.phone === phone);
  }

  /**
   * Create social accounts for an influencer
   */
  async createSocialAccounts(userId, influencerIndex) {
    try {
      const influencer = this.mockUsers.influencers[influencerIndex];
      const usernameBase = influencer.name.toLowerCase().replace(/\s+/g, '_').replace(/_inf$/, '');
      
      const platforms = [
        {
          platform_name: "INSTAGRAM",
          username: `${usernameBase}_ig`,
          profile_url: this.realUrls.instagram[influencerIndex] || `https://instagram.com/${usernameBase}_ig`,
          follower_count: (influencerIndex + 1) * 10000,
          engagement_rate: 3.5 + influencerIndex * 0.5,
        },
        {
          platform_name: "YOUTUBE",
          username: `${usernameBase}_yt`,
          profile_url: this.realUrls.youtube[influencerIndex] || `https://youtube.com/@${usernameBase}_yt`,
          follower_count: (influencerIndex + 1) * 5000,
          engagement_rate: 4.0 + influencerIndex * 0.3,
        },
      ];

      // Add Facebook for some influencers
      if (influencerIndex % 2 === 0) {
        platforms.push({
          platform_name: "FACEBOOK",
          username: `${usernameBase}_fb`,
          profile_url: this.realUrls.facebook[Math.floor(influencerIndex / 2)] || `https://facebook.com/${usernameBase}_fb`,
          follower_count: (influencerIndex + 1) * 8000,
          engagement_rate: 2.5 + influencerIndex * 0.4,
        });
      }

      const result = await profileService.upsertSocialPlatforms(userId, platforms);
      return result;
    } catch (err) {
      console.error("[MockUsersService/createSocialAccounts] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create portfolio items for an influencer
   */
  async createPortfolioItems(userId, influencerIndex) {
    try {
      const influencer = this.mockUsers.influencers[influencerIndex];
      const imageIndex = influencerIndex * 2;
      const videoIndex = influencerIndex;
      
      const portfolioItems = [
        {
          media_type: "IMAGE",
          media_url: this.realUrls.portfolio.images[imageIndex] || `https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=800&h=600&fit=crop`,
          thumbnail_url: this.realUrls.portfolio.thumbnails[imageIndex % this.realUrls.portfolio.thumbnails.length] || `https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=400&h=300&fit=crop`,
          description: `Portfolio showcase - ${influencer.name} - Image 1`,
        },
        {
          media_type: "IMAGE",
          media_url: this.realUrls.portfolio.images[imageIndex + 1] || `https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop`,
          thumbnail_url: this.realUrls.portfolio.thumbnails[(imageIndex + 1) % this.realUrls.portfolio.thumbnails.length] || `https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=400&h=300&fit=crop`,
          description: `Portfolio showcase - ${influencer.name} - Image 2`,
        },
        {
          media_type: "VIDEO",
          media_url: this.realUrls.portfolio.videos[videoIndex] || `https://videos.pexels.com/video-files/3045163/3045163-hd_1920_1080_30fps.mp4`,
          thumbnail_url: this.realUrls.portfolio.thumbnails[videoIndex % this.realUrls.portfolio.thumbnails.length] || `https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=400&h=300&fit=crop`,
          duration_seconds: 30 + influencerIndex * 5,
          description: `Portfolio video - ${influencer.name}`,
        },
      ];

      const results = [];
      for (const item of portfolioItems) {
        const result = await portfolioService.createPortfolioItem(userId, item);
        results.push(result);
      }

      const successCount = results.filter((r) => r.success).length;
      return {
        success: successCount > 0,
        count: successCount,
        total: portfolioItems.length,
      };
    } catch (err) {
      console.error("[MockUsersService/createPortfolioItems] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create or update a single mock user
   */
  async createMockUser(userData) {
    try {
      const phone = userData.phone;
      const otp = this.mockOTP;

      // Check if user already exists
      const { data: existingUser, error: checkError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("phone_number", phone)
        .eq("is_deleted", false)
        .maybeSingle();

      if (checkError && checkError.code !== "PGRST116") {
        console.error(
          `[MockUsersService] Error checking user ${phone}:`,
          checkError
        );
        return {
          success: false,
          message: `Failed to check user existence: ${checkError.message}`,
        };
      }

      let userId;
      let isNewUser = false;

      if (existingUser) {
        // User exists, update if needed
        userId = existingUser.id;
        console.log(`[MockUsersService] User ${phone} already exists: ${userId}`);
      } else {
        // Create new user using verifyOTP
        console.log(`[MockUsersService] Creating new user: ${phone}`);
        const verifyResult = await authService.verifyOTP(phone, otp, userData);

        if (!verifyResult.success) {
          return {
            success: false,
            message: `Failed to create user: ${verifyResult.message}`,
          };
        }

        userId = verifyResult.user.id;
        isNewUser = true;
        console.log(`[MockUsersService] User created: ${userId}`);
      }

      // For influencers, create social accounts and portfolio
      if (userData.role === "INFLUENCER" && isNewUser) {
        const influencerIndex = this.mockUsers.influencers.findIndex(
          (u) => u.phone === phone
        );

        if (influencerIndex >= 0) {
          // Create social accounts
          console.log(`[MockUsersService] Creating social accounts for ${phone}`);
          const socialResult = await this.createSocialAccounts(
            userId,
            influencerIndex
          );
          if (!socialResult.success) {
            console.warn(
              `[MockUsersService] Failed to create some social accounts:`,
              socialResult.errors
            );
          }

          // Create portfolio items
          console.log(`[MockUsersService] Creating portfolio items for ${phone}`);
          const portfolioResult = await this.createPortfolioItems(
            userId,
            influencerIndex
          );
          if (!portfolioResult.success) {
            console.warn(
              `[MockUsersService] Failed to create portfolio items:`,
              portfolioResult.error
            );
          }
        }
      }

      // For brand owners, ensure brand profile exists
      if (userData.role === "BRAND_OWNER") {
        const { data: brandProfile, error: profileError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("user_id")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (profileError && profileError.code !== "PGRST116") {
          console.error(
            `[MockUsersService] Error checking brand profile:`,
            profileError
          );
        } else if (!brandProfile && isNewUser) {
          // Profile should have been created by verifyOTP, but verify it exists
          console.log(
            `[MockUsersService] Brand profile should exist for ${phone}`
          );
        }
      }

      return {
        success: true,
        userId,
        isNewUser,
        message: isNewUser
          ? `User created successfully: ${phone}`
          : `User already exists: ${phone}`,
      };
    } catch (err) {
      console.error(`[MockUsersService] Exception for ${userData.phone}:`, err);
      return {
        success: false,
        message: `Failed to create user: ${err.message}`,
      };
    }
  }

  /**
   * Create all mock users
   */
  async createAllMockUsers() {
    if (!this.isEnabled) {
      return {
        success: false,
        message: "Mock users are disabled. Set ENABLE_MOCK_USERS=true to enable.",
      };
    }

    try {
      const results = {
        admins: [],
        brandOwners: [],
        influencers: [],
        summary: {
          total: 0,
          created: 0,
          existing: 0,
          failed: 0,
        },
      };

      // Create admins
      console.log("[MockUsersService] Creating admin users...");
      for (const admin of this.mockUsers.admins) {
        const result = await this.createMockUser(admin);
        results.admins.push({ ...admin, ...result });
        results.summary.total++;
        if (result.success) {
          if (result.isNewUser) {
            results.summary.created++;
          } else {
            results.summary.existing++;
          }
        } else {
          results.summary.failed++;
        }
      }

      // Create brand owners
      console.log("[MockUsersService] Creating brand owner users...");
      for (const brandOwner of this.mockUsers.brandOwners) {
        const result = await this.createMockUser(brandOwner);
        results.brandOwners.push({ ...brandOwner, ...result });
        results.summary.total++;
        if (result.success) {
          if (result.isNewUser) {
            results.summary.created++;
          } else {
            results.summary.existing++;
          }
        } else {
          results.summary.failed++;
        }
      }

      // Create influencers
      console.log("[MockUsersService] Creating influencer users...");
      for (const influencer of this.mockUsers.influencers) {
        const result = await this.createMockUser(influencer);
        results.influencers.push({ ...influencer, ...result });
        results.summary.total++;
        if (result.success) {
          if (result.isNewUser) {
            results.summary.created++;
          } else {
            results.summary.existing++;
          }
        } else {
          results.summary.failed++;
        }
      }

      return {
        success: true,
        results,
        message: `Mock users setup complete. Created: ${results.summary.created}, Existing: ${results.summary.existing}, Failed: ${results.summary.failed}`,
      };
    } catch (err) {
      console.error("[MockUsersService] Exception:", err);
      return {
        success: false,
        message: `Failed to create mock users: ${err.message}`,
      };
    }
  }

  /**
   * Get all mock user credentials
   */
  getMockUserCredentials() {
    if (!this.isEnabled) {
      return {
        enabled: false,
        message: "Mock users are disabled. Set ENABLE_MOCK_USERS=true to enable.",
      };
    }

    return {
      enabled: true,
      otp: this.mockOTP,
      users: {
        admins: this.mockUsers.admins.map((u) => ({
          phone: u.phone,
          name: u.name,
          email: u.email,
          role: u.role,
        })),
        brandOwners: this.mockUsers.brandOwners.map((u) => ({
          phone: u.phone,
          name: u.name,
          email: u.email,
          role: u.role,
          brand_name: u.brand_name,
        })),
        influencers: this.mockUsers.influencers.map((u) => ({
          phone: u.phone,
          name: u.name,
          email: u.email,
          role: u.role,
          categories: u.categories,
        })),
      },
    };
  }
}

module.exports = new MockUsersService();

