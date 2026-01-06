const instagramOAuthService = require('../services/instagramOAuthService');
const { supabaseAdmin } = require('../supabase/client');
const { retrySupabaseQuery } = require('../utils/supabaseRetry');

class OAuthController {
  /**
   * Initiate Instagram OAuth flow
   * Redirects user to Meta authorization page
   */
  async authorizeInstagram(req, res) {
    try {
      if (!instagramOAuthService.clientId || !instagramOAuthService.clientSecret) {
        console.error('❌ [OAuth] Missing credentials:', {
          hasClientId: !!instagramOAuthService.clientId,
          hasClientSecret: !!instagramOAuthService.clientSecret,
        });
        return res.status(500).json({
          success: false,
          message: 'Instagram OAuth not configured. Please set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET environment variables.',
        });
      }

      // Generate state for CSRF protection
      const state = instagramOAuthService.generateState();
      
      // Store state in session or return it to client (for mobile, we'll return it)
      // For now, we'll include it in the redirect URL and validate it in callback
      const authUrl = instagramOAuthService.buildAuthorizationUrl(state);

      // For mobile apps, we can either:
      // 1. Redirect directly (browser-based)
      // 2. Return the URL for the app to open
      
      // Since this is called from mobile, we'll redirect directly
      console.log('🚀 [OAuth] Redirecting to Instagram authorization...');
      res.redirect(authUrl);
    } catch (error) {
      console.error('❌ [OAuth] Authorization error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to initiate OAuth flow',
        error: error.message,
      });
    }
  }

  /**
   * Handle Instagram OAuth callback from Meta
   * Exchanges code for token, fetches profile, saves to DB, redirects to app
   */
  async handleInstagramCallback(req, res) {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle OAuth errors
      if (error) {
        console.error('❌ [OAuth] Instagram callback error:', error, error_description);
        // Use dynamic base URL for error redirect
        const baseUrl = process.env.INSTAGRAM_REDIRECT_URI 
          ? process.env.INSTAGRAM_REDIRECT_URI.replace('/api/oauth/instagram/callback', '')
          : req.protocol + '://' + req.get('host');
        const errorUrl = `${baseUrl}/oauth/error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(error_description || 'OAuth authorization failed')}`;
        return res.redirect(errorUrl);
      }

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Authorization code not provided',
        });
      }

      // Step 2 & 3: Exchange code for short-lived token, then exchange for long-lived token
      console.log('🔄 [OAuth] Starting token exchange (Steps 2 & 3)...');
      const tokenData = await instagramOAuthService.exchangeCodeForToken(code);
      console.log('✅ [OAuth] Token exchange complete - Long-lived token ready (60 days)');

      // Step 4 & 5: Fetch user profile and insights
      console.log('🔄 [OAuth] Starting profile and insights fetch (Steps 4 & 5)...');
      const profileData = await instagramOAuthService.fetchUserProfile(
        tokenData.access_token, // Long-lived token from Step 3
        tokenData.user_id
      );
      console.log('✅ [OAuth] Profile and insights fetch complete');

      // Generate temporary token for app handoff
      // IMPORTANT: tokenData.access_token is the LONG-LIVED token (60 days) - this is what we save to DB
      const platformData = {
        access_token: tokenData.access_token, // Long-lived token (60 days) - SAVE THIS TO DB
        user_id: tokenData.user_id,
        username: profileData.username,
        followers_count: profileData.followers_count,
        account_type: profileData.account_type,
        expires_in: tokenData.expires_in, // ~60 days in seconds (~5184000)
      };

      const tempToken = instagramOAuthService.generateTempToken(null, platformData); // userId will be set when app verifies

      // Redirect to app with temporary token (use dynamic base URL)
      const baseUrl = process.env.INSTAGRAM_REDIRECT_URI 
        ? process.env.INSTAGRAM_REDIRECT_URI.replace('/api/oauth/instagram/callback', '')
        : req.protocol + '://' + req.get('host');
      const successUrl = `${baseUrl}/oauth/success?token=${encodeURIComponent(tempToken)}&platform=instagram`;
      console.log('✅ [OAuth] Redirecting to app with token:', successUrl.substring(0, 100) + '...');
      res.redirect(successUrl);
    } catch (error) {
      console.error('❌ [OAuth] Callback error:', error);
      const errorUrl = `https://stoory-backend-production.up.railway.app/oauth/error?error=callback_failed&description=${encodeURIComponent(error.message)}`;
      res.redirect(errorUrl);
    }
  }

  /**
   * Verify temporary token and save Instagram account to user's profile
   * Called by mobile app after receiving the token
   */
  async verifyInstagramToken(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token is required',
        });
      }

      // Validate token
      const decoded = instagramOAuthService.validateTempToken(token);

      // Get user ID from request (user must be authenticated)
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        });
      }

      const platformData = decoded.platformData;

      // Check if Instagram account already exists for this user
      const { data: existingPlatform, error: checkError } = await retrySupabaseQuery(
        () => supabaseAdmin
          .from('social_platforms')
          .select('id')
          .eq('user_id', userId)
          .eq('platform_name', 'instagram')
          .maybeSingle(),
        { maxRetries: 3, initialDelay: 200 }
      );

      // Prepare platform data
      const platformRecord = {
        user_id: userId,
        platform_name: 'instagram',
        username: platformData.username,
        profile_link: `https://instagram.com/${platformData.username}`,
        followers_count: platformData.followers_count || 0,
        is_connected: true,
        // Store OAuth tokens securely (consider encryption in production)
        // IMPORTANT: This is the LONG-LIVED token (60 days) from Step 3, not the short-lived token
        access_token: platformData.access_token, // Long-lived token (60 days)
        instagram_user_id: platformData.user_id,
        token_expires_at: platformData.expires_in
          ? new Date(Date.now() + platformData.expires_in * 1000).toISOString() // ~60 days from now
          : null,
      };

      let savedPlatform;

      if (existingPlatform) {
        // Update existing platform
        const { data, error } = await retrySupabaseQuery(
          () => supabaseAdmin
            .from('social_platforms')
            .update(platformRecord)
            .eq('id', existingPlatform.id)
            .select()
            .single(),
          { maxRetries: 3, initialDelay: 200 }
        );

        if (error) {
          throw new Error(`Failed to update Instagram account: ${error.message}`);
        }

        savedPlatform = data;
      } else {
        // Insert new platform
        const { data, error } = await retrySupabaseQuery(
          () => supabaseAdmin
            .from('social_platforms')
            .insert(platformRecord)
            .select()
            .single(),
          { maxRetries: 3, initialDelay: 200 }
        );

        if (error) {
          throw new Error(`Failed to save Instagram account: ${error.message}`);
        }

        savedPlatform = data;
      }

      // Return platform data (without sensitive tokens)
      const responseData = {
        id: savedPlatform.id,
        platform: savedPlatform.platform_name,
        username: savedPlatform.username,
        profile_link: savedPlatform.profile_link,
        followers_count: savedPlatform.followers_count,
        is_connected: savedPlatform.is_connected,
      };

      res.json({
        success: true,
        platform: responseData,
        message: 'Instagram account connected successfully',
      });
    } catch (error) {
      console.error('❌ [OAuth] Token verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify token',
        error: error.message,
      });
    }
  }
}

module.exports = new OAuthController();

