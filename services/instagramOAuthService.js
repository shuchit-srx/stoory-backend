const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class InstagramOAuthService {
  constructor() {
    this.clientId = process.env.INSTAGRAM_CLIENT_ID;
    this.clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    this.redirectUri = process.env.INSTAGRAM_REDIRECT_URI || 'https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback';
    this.tempTokenSecret = process.env.OAUTH_TEMP_TOKEN_SECRET || process.env.JWT_SECRET || 'oauth-temp-secret';
    this.tempTokenExpiry = process.env.OAUTH_TEMP_TOKEN_EXPIRY || '300'; // 5 minutes
    // Using Instagram Graph API for data fetching (not Facebook Graph API)
    this.instagramApiBase = 'https://graph.instagram.com';
    // Instagram API base for OAuth handshake
    this.instagramApiOAuthBase = 'https://api.instagram.com';
  }

  /**
   * Generate random state parameter for OAuth security
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Build Instagram OAuth authorization URL
   * Using Instagram Business API scopes
   */
  buildAuthorizationUrl(state) {
    // Instagram Business API scopes
    // instagram_business_basic: REQUIRED - profile and media access
    // instagram_business_manage_insights: OPTIONAL - analytics (follower count, likes, views)
    // instagram_business_content_publish: OPTIONAL - post content to account
    const scopes = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish';
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes,
      response_type: 'code',
      state: state,
    });

    const authUrl = `https://api.instagram.com/oauth/authorize?${params.toString()}`;
    
    // Debug logging
    console.log('🔍 [OAuth] Building authorization URL:');
    console.log('  - Client ID:', this.clientId ? `${this.clientId.substring(0, 10)}...` : 'NOT SET');
    console.log('  - Redirect URI:', this.redirectUri);
    console.log('  - Scopes:', scopes);
    console.log('  - Full URL:', authUrl);
    
    return authUrl;
  }

  /**
   * Exchange authorization code for short-lived access token (1 hour)
   * Uses api.instagram.com for OAuth handshake
   */
  async exchangeCodeForToken(code) {
    try {
      // Token exchange uses api.instagram.com (not graph.instagram.com)
      const tokenUrl = `${this.instagramApiOAuthBase}/oauth/access_token`;
      
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
        code: code,
      });

      console.log('🔄 [OAuth Step 2] Exchanging code for short-lived token via api.instagram.com/oauth/access_token...');
      const response = await axios.post(tokenUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.data.error) {
        throw new Error(`Token exchange failed: ${response.data.error.message || JSON.stringify(response.data.error)}`);
      }

      const shortLivedToken = response.data.access_token;
      const userId = response.data.user_id;

      console.log(`✅ [OAuth Step 2] Short-lived token obtained (1 hour expiry), User ID: ${userId}`);

      // Exchange short-lived token for long-lived token (60 days)
      const longLivedToken = await this.exchangeForLongLivedToken(shortLivedToken);

      return {
        access_token: longLivedToken.access_token,
        token_type: response.data.token_type || 'bearer',
        expires_in: longLivedToken.expires_in, // ~60 days in seconds
        user_id: userId,
      };
    } catch (error) {
      console.error('❌ [Instagram OAuth] Token exchange error:', error.response?.data || error.message);
      throw new Error(`Failed to exchange code for token: ${error.message}`);
    }
  }

  /**
   * Exchange short-lived token (1 hour) for long-lived token (60 days)
   * Uses graph.instagram.com for token exchange
   */
  async exchangeForLongLivedToken(shortLivedToken) {
    try {
      const exchangeUrl = `${this.instagramApiBase}/access_token`;
      
      const params = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: this.clientSecret,
        access_token: shortLivedToken,
      });

      console.log('🔄 [OAuth Step 3] Exchanging short-lived token for long-lived token (60 days) via graph.instagram.com/access_token...');
      const response = await axios.get(exchangeUrl, {
        params: Object.fromEntries(params),
      });

      if (response.data.error) {
        throw new Error(`Long-lived token exchange failed: ${response.data.error.message || JSON.stringify(response.data.error)}`);
      }

      const expiresInDays = Math.floor(response.data.expires_in / 86400);
      console.log(`✅ [OAuth Step 3] Long-lived token obtained (expires in ${expiresInDays} days / ${response.data.expires_in} seconds)`);
      
      return {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in, // ~5184000 seconds (60 days)
        token_type: response.data.token_type || 'bearer',
      };
    } catch (error) {
      console.error('❌ [Instagram OAuth] Long-lived token exchange error:', error.response?.data || error.message);
      // If long-lived token exchange fails, return the short-lived token
      console.warn('⚠️ [OAuth] Falling back to short-lived token (1 hour)');
      return {
        access_token: shortLivedToken,
        expires_in: 3600, // 1 hour in seconds
        token_type: 'bearer',
      };
    }
  }

  /**
   * Step 4: Fetch Instagram user profile using Instagram Graph API
   * URL: https://graph.instagram.com/me
   * Uses long-lived token from Step 3
   */
  async fetchUserProfile(accessToken, userId) {
    try {
      // Step 4: Use /me endpoint for profile
      const profileUrl = `${this.instagramApiBase}/me`;
      
      console.log('🔄 [OAuth Step 4] Fetching profile from graph.instagram.com/me...');
      const response = await axios.get(profileUrl, {
        params: {
          fields: 'id,username,account_type,name,profile_picture_url',
          access_token: accessToken, // Using long-lived token from Step 3
        },
      });

      if (response.data.error) {
        throw new Error(`Profile fetch failed: ${response.data.error.message || JSON.stringify(response.data.error)}`);
      }

      // Get the actual user ID from Step 4 response
      const actualUserId = response.data.id || userId;
      console.log(`✅ [OAuth Step 4] Profile retrieved - User ID: ${actualUserId}, Username: ${response.data.username}`);

      // Step 5: Fetch followers count using insights API
      // URL: https://graph.instagram.com/{user_id}/insights
      let followersCount = 0;
      try {
        // Step 5: Use /{user_id}/insights endpoint (as specified in requirements)
        const insightsUrl = `${this.instagramApiBase}/${actualUserId}/insights`;
        console.log(`🔄 [OAuth Step 5] Fetching insights from graph.instagram.com/${actualUserId}/insights...`);
        const insightsResponse = await axios.get(insightsUrl, {
          params: {
            metric: 'follower_count',
            period: 'lifetime', // Lifetime follower count
            access_token: accessToken, // Using long-lived token from Step 3
          },
        });
        
        if (insightsResponse.data?.data?.[0]?.values?.[0]?.value) {
          followersCount = parseInt(insightsResponse.data.data[0].values[0].value, 10);
          console.log(`✅ [OAuth Step 5] Follower count retrieved: ${followersCount}`);
        }
      } catch (insightsError) {
        console.warn('⚠️ [Instagram OAuth Step 5] Could not fetch followers count:', insightsError.response?.data || insightsError.message);
        console.warn('   This may require instagram_business_manage_insights scope');
        // Continue without followers count - user can enter manually
      }

      return {
        id: actualUserId,
        username: response.data.username || actualUserId,
        account_type: response.data.account_type || 'BUSINESS',
        name: response.data.name || response.data.username,
        profile_picture_url: response.data.profile_picture_url,
        followers_count: followersCount,
      };
    } catch (error) {
      console.error('❌ [Instagram OAuth] Profile fetch error:', error.response?.data || error.message);
      // Return basic info even if detailed fetch fails
      return {
        id: userId,
        username: userId,
        account_type: 'unknown',
        followers_count: 0,
      };
    }
  }

  /**
   * Generate temporary JWT token for app handoff
   */
  generateTempToken(userId, platformData) {
    const payload = {
      userId,
      platform: 'instagram',
      platformData,
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, this.tempTokenSecret, {
      expiresIn: `${this.tempTokenExpiry}s`, // 5 minutes default
    });
  }

  /**
   * Validate and decode temporary token
   */
  validateTempToken(token) {
    try {
      const decoded = jwt.verify(token, this.tempTokenSecret);
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }
}

module.exports = new InstagramOAuthService();

