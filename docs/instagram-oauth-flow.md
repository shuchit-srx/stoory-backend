## Instagram OAuth Flow – Stoory (Instagram Login, Business Scopes)

This document explains the **end‑to‑end Instagram OAuth flow** used by Stoory:

- Backend endpoints and how they interact with Instagram’s APIs
- Mobile (React Native) flow for “Connect Instagram”
- Token lifecycle: **short‑lived → long‑lived (60‑day) token**
- Data stored in `social_platforms`
- Local testing and Railway deployment

---

## 1. High‑Level Flow

User perspective:

1. User taps **“Connect Instagram”** in the Stoory app.
2. App opens `GET /api/oauth/instagram/authorize` (Stoory backend).
3. Backend redirects user to:
   - `https://api.instagram.com/oauth/authorize?...`
4. User logs in to Instagram and approves requested scopes.
5. Instagram redirects back to:
   - `.../api/oauth/instagram/callback?code={CODE}&state={STATE}`
6. Backend:
   - Exchanges `code` for a **short‑lived token** (1 hour) via `api.instagram.com`.
   - Exchanges short‑lived token for a **long‑lived token** (≈60 days) via `graph.instagram.com`.
   - Fetches profile (and optionally insights) via `graph.instagram.com`.
   - Stores data in Supabase (`social_platforms`).
   - Generates a **temporary JWT** and redirects to an HTTPS app‑link:
     - `{BASE_URL}/oauth/success?token={TEMP_JWT}&platform=instagram`
7. App receives this HTTPS link, extracts `token`, calls:
   - `POST /api/oauth/instagram/verify`
8. Backend verifies the temp token, returns normalized Instagram account data.
9. App marks the Instagram account as **connected** in registration state.

---

## 2. Backend Implementation

### 2.1 Route Mounting

- **File**: `stoory-backend/legacy/index.js`

Key lines:

- Import routes:

```js
const oauthRoutes = require("../routes/oauth");
```

- Mount:

```js
app.use("/api/oauth", oauthRoutes);
```

So the public API endpoints are:

- `GET /api/oauth/instagram/authorize`
- `GET /api/oauth/instagram/callback`
- `POST /api/oauth/instagram/verify`

### 2.2 `GET /api/oauth/instagram/authorize`

- **File**: `stoory-backend/routes/oauth.js`
- **Controller**: `OAuthController.authorizeInstagram`

Behavior:

1. Validates that:
   - `INSTAGRAM_CLIENT_ID`
   - `INSTAGRAM_CLIENT_SECRET`
   are set.
2. Calls `instagramOAuthService.generateState()` to create a CSRF `state`.
3. Calls `instagramOAuthService.buildAuthorizationUrl(state)` which builds:

```text
https://api.instagram.com/oauth/authorize
  ?client_id={INSTAGRAM_CLIENT_ID}
  &redirect_uri={INSTAGRAM_REDIRECT_URI}
  &response_type=code
  &scope=instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish
  &state={STATE}
```

4. Responds with an HTTP **302 redirect** to that URL.

The **redirect URI** used in the query is:

- Local dev:
  - `http://localhost:3000/api/oauth/instagram/callback`
- Production:
  - `https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback`

> This **must** match exactly the valid redirect URI configured in the Meta/Instagram app.

### 2.3 `GET /api/oauth/instagram/callback` - The 5-Step OAuth Flow

- **File**: `stoory-backend/routes/oauth.js`
- **Controller**: `OAuthController.handleInstagramCallback`

This endpoint implements the **5-step Instagram OAuth flow**:

#### Step 1: Authorization (Frontend - Already Done)
- User clicked "Connect Instagram" and was redirected to Instagram
- Instagram redirected back with `?code=XXX&state=XXX`

#### Step 2: Get Short-Lived Token (Backend)
- **URL**: `POST https://api.instagram.com/oauth/access_token`
- **Method**: POST
- **Body Params**:
  - `client_id`: Your Instagram App ID
  - `client_secret`: Your Instagram App Secret
  - `grant_type`: `authorization_code`
  - `redirect_uri`: Must match Step 1
  - `code`: Authorization code from Step 1
- **Result**: Returns `access_token` (short-lived, 1 hour) and `user_id`

#### Step 3: Get Long-Lived Token (Backend - NEW STEP)
- **URL**: `GET https://graph.instagram.com/access_token`
- **Method**: GET
- **Query Params**:
  - `grant_type`: `ig_exchange_token`
  - `client_secret`: Your Instagram App Secret
  - `access_token`: Short-lived token from Step 2
- **Result**: Returns `access_token` (long-lived, **60 days**) - **SAVE THIS TO DB**

#### Step 4: Profile API (Backend)
- **URL**: `GET https://graph.instagram.com/me`
- **Method**: GET
- **Query Params**:
  - `fields`: `id,username,account_type,name,profile_picture_url`
  - `access_token`: **Long-lived token from Step 3**
- **Result**: Returns user profile data

#### Step 5: Insights API (Backend)
- **URL**: `GET https://graph.instagram.com/{user_id}/insights`
- **Method**: GET
- **Query Params**:
  - `metric`: `follower_count`
  - `period`: `lifetime`
  - `access_token`: **Long-lived token from Step 3**
- **Result**: Returns follower count (requires `instagram_business_manage_insights` scope)

**Implementation Details:**
- **Controller**: `OAuthController.handleInstagramCallback`

Query parameters:

- `code` – authorization code from Instagram
- `state` – CSRF state
- `error` / `error_description` – if user cancels / an error occurs

Flow:

1. If `error` is present:
   - Logs the error.
   - Computes `baseUrl`:
     - If `INSTAGRAM_REDIRECT_URI` is set, uses everything **before** `/api/oauth/instagram/callback`.
     - Otherwise uses `req.protocol + '://' + req.get('host')`.
   - Redirects to:  
     `"{baseUrl}/oauth/error?error=...&description=..."`.

2. If `code` is missing:
   - Returns `400 { success: false, message: 'Authorization code not provided' }`.

3. If `code` is present:
   - Logs `"Exchanging code for token..."`.
   - Calls `instagramOAuthService.exchangeCodeForToken(code)`.

#### 2.3.1 Short‑lived → Long‑lived Token Exchange

- **File**: `stoory-backend/services/instagramOAuthService.js`

**Short‑lived token (1 hour) – Step 2 in your spec**

```http
POST https://api.instagram.com/oauth/access_token

Body (x-www-form-urlencoded):
  client_id={INSTAGRAM_CLIENT_ID}
  client_secret={INSTAGRAM_CLIENT_SECRET}
  grant_type=authorization_code
  redirect_uri={INSTAGRAM_REDIRECT_URI}
  code={CODE}
```

Implementation:

- `exchangeCodeForToken`:
  - Builds the above POST.
  - Logs that it is using `api.instagram.com`.
  - On success, obtains `access_token` (short‑lived) and `user_id`.

**Long‑lived token (≈60 days) – Step 3 in your spec**

Immediately after obtaining the short‑lived token, we call:

```http
GET https://graph.instagram.com/access_token
  ?grant_type=ig_exchange_token
  &client_secret={INSTAGRAM_CLIENT_SECRET}
  &access_token={SHORT_LIVED_TOKEN}
```

- Implementation: `exchangeForLongLivedToken(shortLivedToken)`
  - Uses `this.instagramApiBase = 'https://graph.instagram.com'`.
  - On success, returns a **long‑lived** `access_token` and `expires_in` (~60 days).
  - If this step fails, it logs a warning and **falls back** to using the short‑lived token (1 hour).

`exchangeCodeForToken` returns:

- `access_token` – the **long‑lived** token if exchange succeeds, else short‑lived.
- `expires_in` – seconds until expiry.
- `user_id` – user’s Instagram ID.

#### 2.3.2 Profile Fetch (`me` endpoint – Step 4 in your spec)

**Profile API**:

```http
GET https://graph.instagram.com/me
  ?fields=id,username,account_type,name,profile_picture_url
  &access_token={ACCESS_TOKEN}
```

- Implementation: `instagramOAuthService.fetchUserProfile(accessToken, userId)`
  - Uses `this.instagramApiBase = 'https://graph.instagram.com'`.
  - Calls `/me` rather than `/{user_id}` (safer, as you requested).
  - Returns a normalized object:

    ```js
    {
      id,                 // from /me
      username,
      account_type,       // default 'BUSINESS' if missing
      name,
      profile_picture_url,
      followers_count,    // see below
    }
    ```

**Insights (followers) – Step 5 in your spec**

```http
GET https://graph.instagram.com/{user_id}/insights
  ?metric=follower_count
  &period=lifetime
  &access_token={LONG_LIVED_TOKEN}
```

- **Important**: Uses `/{user_id}/insights` (not `/me/insights`) as specified
- `user_id` is obtained from Step 4 profile response (`response.data.id`)
- Uses **long-lived token from Step 3** (not short-lived)
- If `instagram_business_manage_insights` is granted and the account supports insights:
  - Extracts `followers_count` from the response.
- If insights fail:
  - Logs a warning.
  - `followers_count` falls back to `0` (front‑end can override manually if needed).

#### 2.3.3 Temp JWT + Redirect to App

After profile and token processing:

1. `platformData` is built:

   ```js
   const platformData = {
     access_token: tokenData.access_token, // LONG-LIVED TOKEN (60 days) from Step 3
     user_id:      tokenData.user_id,      // From Step 2
     username:     profileData.username,   // From Step 4
     followers_count: profileData.followers_count, // From Step 5
     account_type: profileData.account_type, // From Step 4
     expires_in:   tokenData.expires_in,   // ~60 days in seconds (~5184000)
   };
   ```

   **Critical**: The `access_token` here is the **long-lived token (60 days)** from Step 3, which is what gets saved to the database.

2. A **temporary JWT** is generated:

   ```js
   const tempToken = instagramOAuthService.generateTempToken(
     null,           // userId resolved later
     platformData,
   );
   ```

   - Signed with `OAUTH_TEMP_TOKEN_SECRET` (or `JWT_SECRET` as fallback).
   - Default expiry: `OAUTH_TEMP_TOKEN_EXPIRY` seconds (default 300, i.e., 5 minutes).

3. A success redirect URL is computed:

   - `baseUrl` derived from `INSTAGRAM_REDIRECT_URI` (strip `/api/oauth/instagram/callback`).
   - Fallback: `req.protocol + '://' + req.get('host')`.

   Final URL:

   ```text
   {BASE_URL}/oauth/success?token={TEMP_JWT}&platform=instagram
   ```

4. Backend responds with **302 redirect** to this URL.

For **local dev**, with:

- `INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/oauth/instagram/callback`

the app success URL becomes:

- `http://localhost:3000/oauth/success?token=...&platform=instagram`

For **Railway prod**, with:

- `INSTAGRAM_REDIRECT_URI=https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback`

the success URL is:

- `https://stoory-backend-production.up.railway.app/oauth/success?token=...&platform=instagram`

### 2.4 `POST /api/oauth/instagram/verify`

- **File**: `stoory-backend/routes/oauth.js`
- **Controller**: `OAuthController.verifyInstagramToken`
- **Auth**: requires a valid Stoory user JWT (`authService.authenticateToken`).

Request body:

```json
{ "token": "TEMP_JWT_FROM_SUCCESS_URL" }
```

Flow:

1. Validates `token` is present.
2. Verifies temp JWT via `instagramOAuthService.validateTempToken(token)`.
3. Extracts `platformData` from decoded payload.
4. Uses `req.user.id` (from `authenticateToken`) as the Stoory user ID.
5. Upserts a row into `social_platforms` for this user with:

   - `user_id` - Stoory user ID (from `req.user.id`)
   - `platform_name = 'instagram'`
   - `username` - Instagram username (from Step 4)
   - `profile_link = https://instagram.com/{username}`
   - `followers_count` - From Step 5 insights (or 0 if unavailable)
   - `is_connected = true`
   - `access_token` - **LONG-LIVED TOKEN (60 days) from Step 3** - This is what gets saved!
   - `instagram_user_id` - Instagram user ID (from Step 2)
   - `token_expires_at` - Calculated as `Date.now() + expires_in * 1000` (~60 days from now)

   **Database Schema Note**: The `access_token` column stores the **long-lived token (60 days)** from Step 3, not the short-lived token (1 hour) from Step 2. This ensures users don't need to reconnect frequently.

6. Returns a sanitized payload (no sensitive tokens) to the app:

```json
{
  "success": true,
  "platform": {
    "id": "...",
    "platform": "instagram",
    "username": "...",
    "profile_link": "https://instagram.com/...",
    "followers_count": 1234,
    "is_connected": true
  },
  "message": "Instagram account connected successfully"
}
```

---

## 2.5 Database Storage (Supabase)

### Table: `social_platforms`

When the OAuth flow completes, the following data is stored:

| Column | Value Source | Notes |
|--------|--------------|-------|
| `user_id` | `req.user.id` | Stoory user ID (from authenticated request) |
| `platform_name` | `'instagram'` | Fixed value |
| `username` | Step 4 (`/me` response) | Instagram username |
| `profile_link` | Generated | `https://instagram.com/{username}` |
| `followers_count` | Step 5 (`/{user_id}/insights`) | Or `0` if insights unavailable |
| `is_connected` | `true` | Boolean flag |
| `access_token` | **Step 3 (long-lived token)** | **60-day token** - This is what gets saved! |
| `instagram_user_id` | Step 2 (`user_id` from token exchange) | Instagram's user ID |
| `token_expires_at` | Calculated | `Date.now() + expires_in * 1000` (~60 days from now) |

**Critical Points:**

1. **Long-Lived Token Storage**: The `access_token` column stores the **long-lived token (60 days)** from Step 3, NOT the short-lived token (1 hour) from Step 2. This is essential for user experience.

2. **Token Expiry**: The `token_expires_at` is calculated based on the `expires_in` value from Step 3 (~5184000 seconds = 60 days).

3. **Token Refresh**: After 60 days, users will need to reconnect. You can implement token refresh logic later if needed.

4. **Security**: Tokens are stored in the database. Consider encryption for production environments.

---

## 3. Mobile App Flow (React Native)

### 3.1 Starting the Flow

- **File**: `stoory/stoory/src/screens/auth/register/ConnectSocialMediaScreen.tsx`
- On **Connect** button:

```ts
await nativeOAuthService.startOAuthFlow(currentPlatform.id);
```

For `platform.id === 'instagram'`, this calls:

```ts
nativeOAuthService.startInstagramOAuth();
```

### 3.2 Native OAuth Service (Instagram)

- **File**: `stoory/stoory/src/services/nativeOAuthService.ts`

Key points:

- Uses **backend‑initiated flow**, not direct Instagram URL.
- `startInstagramOAuth` builds:

```ts
const config = getCurrentApiConfig(); // BASE_URL = .../api
const authorizeUrl = `${config.BASE_URL}/oauth/instagram/authorize`;
Linking.openURL(authorizeUrl);
```

So the app opens:

- Local: `https://stoory-backend-production.up.railway.app/api/oauth/instagram/authorize` (in current config) or local if you switch BASE_URL.

### 3.3 Handling the App Link (`/oauth/success`)

The app listens for HTTPS deep links via:

- `nativeOAuthService.initializeDeepLinkListener()` in `ConnectSocialMediaScreen`’s `useEffect`.
- `handleAppLink(url: string)` in `nativeOAuthService`.

When the app is opened with:

```text
{BASE_URL}/oauth/success?token={TEMP_JWT}&platform=instagram
```

`handleAppLink`:

1. Parses the URL.
2. Extracts `token` and `platform`.
3. Calls:

```ts
const response = await oauthApiService.verifyInstagramToken(token);
```

- **File**: `stoory/stoory/src/api/oauthApi.ts`
- Endpoint: `POST /oauth/instagram/verify` (which is `/api/oauth/instagram/verify` in backend).

4. Converts backend response to `OAuthUser` (mobile type) and calls:

```ts
this.handleOAuthSuccess(platform, oauthUser);
```

This triggers the success handler in `ConnectSocialMediaScreen`, which:

- Updates `connectedAccounts` in local state.
- Persists via `updateRegistrationStep('connectedAccounts', ...)`.
- Shows a success toast.

---

## 4. Environment Variables

Backend (`stoory-backend/.env`):

```bash
INSTAGRAM_CLIENT_ID=1021574723473109
INSTAGRAM_CLIENT_SECRET=your_app_secret_here

# Local testing
INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/oauth/instagram/callback

# Temp token JWT
OAUTH_TEMP_TOKEN_SECRET=some_strong_random_string
OAUTH_TEMP_TOKEN_EXPIRY=300
```

On **Railway**, set the same variables in the project’s **Variables** panel, but:

```bash
INSTAGRAM_REDIRECT_URI=https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback
```

---

## 5. Local Testing Flow

1. Ensure `.env` in `stoory-backend` is set with **local** redirect URI.
2. Start backend:

```bash
cd stoory-backend
npm run dev
```

3. Hit authorization endpoint in browser:

```text
http://localhost:3000/api/oauth/instagram/authorize
```

4. Instagram should:
   - Show login + consent screen.
   - Redirect to `http://localhost:3000/api/oauth/instagram/callback?code=...`.

5. Watch server logs - you should see all 5 steps:
   - `🔄 [OAuth Step 2] Exchanging code for short-lived token via api.instagram.com/oauth/access_token...`
   - `✅ [OAuth Step 2] Short-lived token obtained (1 hour expiry)`
   - `🔄 [OAuth Step 3] Exchanging short-lived token for long-lived token (60 days)...`
   - `✅ [OAuth Step 3] Long-lived token obtained (expires in ~60 days)`
   - `🔄 [OAuth Step 4] Fetching profile from graph.instagram.com/me...`
   - `✅ [OAuth Step 4] Profile retrieved - User ID: XXX, Username: XXX`
   - `🔄 [OAuth Step 5] Fetching insights from graph.instagram.com/{user_id}/insights...`
   - `✅ [OAuth Step 5] Follower count retrieved: XXX`
   - Redirect to `http://localhost:3000/oauth/success?token=...`.

6. If running the app, confirm it receives the `/oauth/success` link and successfully calls `/api/oauth/instagram/verify`.

---

## 6. Railway Deployment Flow

1. **Commit and push** code:

```bash
git add .
git commit -m "Implement Instagram Business OAuth flow"
git push
```

2. Railway will build and deploy using `railway.json` + `Dockerfile`.

3. In Railway dashboard:
   - Open **Variables**.
   - Add:

```bash
INSTAGRAM_CLIENT_ID=1021574723473109
INSTAGRAM_CLIENT_SECRET=your_app_secret_here
INSTAGRAM_REDIRECT_URI=https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback
OAUTH_TEMP_TOKEN_SECRET=some_strong_random_string
OAUTH_TEMP_TOKEN_EXPIRY=300
```

4. Verify health:

```text
https://stoory-backend-production.up.railway.app/health
```

5. Test OAuth in production:

```text
https://stoory-backend-production.up.railway.app/api/oauth/instagram/authorize
```

6. Confirm that Instagram’s **Valid OAuth Redirect URIs** (in Meta Developer dashboard) includes:

```text
https://stoory-backend-production.up.railway.app/api/oauth/instagram/callback
```

Once this is configured, the **same flow** used locally will work end‑to‑end in Railway:

- Authorization → short‑lived token → long‑lived token → profile/insights → Supabase → app link → verify → connected account in Stoory.

