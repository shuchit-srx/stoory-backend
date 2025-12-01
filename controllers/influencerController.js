const { supabaseAdmin } = require("../supabase/client");
const { applyInfluencerFilters } = require("../utils/filterHelpers");

class InfluencerController {
    /**
     * Search/discover influencers with filtering
     * POST /api/influencers/search
     */
    async searchInfluencers(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                filters = {},
            } = req.body;

            const {
                min_budget,
                max_budget,
                languages,
                locations,
                categories,
                search,
                // Logic parameters
                languages_logic,
                locations_logic,
                categories_logic,
                filter_logic
            } = filters;

            const offset = (page - 1) * limit;

            // Base query for influencers
            let query = supabaseAdmin
                .from("users")
                .select(
                    `
          id,
          name,
          email,
          profile_image_url,
          categories,
          languages,
          locations,
          budget_range_min,
          budget_range_max,
          created_at
        `,
                    { count: "exact" }
                )
                .eq("role", "influencer")
                .eq("is_deleted", false);

            // Apply influencer-specific filters
            query = applyInfluencerFilters(query, {
                min_budget,
                max_budget,
                languages,
                locations,
                categories,
                languages_logic,
                locations_logic,
                categories_logic,
                filter_logic
            });

            // Text search on name
            if (search && search.trim() !== "") {
                query = query.ilike('name', `%${search}%`);
            }

            // Execute query with pagination
            const { data: influencers, error, count } = await query
                .order("created_at", { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) {
                console.error("Error fetching influencers:", error);
                return res.status(500).json({
                    success: false,
                    message: "Failed to fetch influencers",
                    error: error.message,
                });
            }

            return res.json({
                success: true,
                influencers: influencers || [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limit),
                },
                filters_applied: {
                    min_budget,
                    max_budget,
                    languages,
                    locations,
                    categories,
                    search,
                },
            });
        } catch (error) {
            console.error("Search influencers error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message,
            });
        }
    }

    /**
     * AI-based influencer search using Gemini
     * POST /api/influencers/ai-search
     */
    async aiSearchInfluencers(req, res) {
        try {
            const { query: userQuery, limit = 10 } = req.body;

            if (!userQuery || userQuery.trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: "Query is required",
                });
            }

            // Check if Gemini API key is configured
            const geminiApiKey = process.env.GEMINI_API_KEY;
            if (!geminiApiKey) {
                return res.status(500).json({
                    success: false,
                    message: "Gemini API not configured",
                });
            }

            // Use Gemini to parse the natural language query
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const prompt = `Extract filter parameters from this influencer search query: "${userQuery}"

Return ONLY a valid JSON object with these fields (use null if not mentioned):
{
  "min_budget": number or null,
  "max_budget": number or null,
  "languages": array of strings or null,
  "locations": array of strings or null,
  "categories": array of strings or null
}

Examples:
- "Find fashion influencers in Mumbai under 50000" -> {"min_budget": null, "max_budget": 50000, "languages": null, "locations": ["Mumbai"], "categories": ["Fashion"]}
- "Tech reviewers who speak Hindi and English" -> {"min_budget": null, "max_budget": null, "languages": ["Hindi", "English"], "locations": null, "categories": ["Technology"]}
- "Lifestyle influencers in Delhi and Bangalore" -> {"min_budget": null, "max_budget": null, "languages": null, "locations": ["Delhi", "Bangalore"], "categories": ["Lifestyle"]}

Return ONLY the JSON object, no additional text.`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Parse the Gemini response
            let filters;
            try {
                // Extract JSON from response (in case there's extra text)
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    filters = JSON.parse(jsonMatch[0]);
                } else {
                    filters = JSON.parse(text);
                }
            } catch (parseError) {
                console.error("Failed to parse Gemini response:", text);
                return res.status(500).json({
                    success: false,
                    message: "Failed to parse AI response",
                    ai_response: text,
                });
            }

            // Apply filters to database
            let dbQuery = supabaseAdmin
                .from("users")
                .select(
                    `
          id,
          name,
          email,
          profile_image_url,
          categories,
          languages,
          locations,
          budget_range_min,
          budget_range_max
        `
                )
                .eq("role", "influencer")
                .eq("is_deleted", false);

            // Apply extracted filters
            dbQuery = applyInfluencerFilters(dbQuery, filters);

            const { data: influencers, error } = await dbQuery
                .order("created_at", { ascending: false })
                .limit(parseInt(limit));

            if (error) {
                console.error("Error fetching influencers:", error);
                return res.status(500).json({
                    success: false,
                    message: "Failed to fetch influencers",
                    error: error.message,
                });
            }

            return res.json({
                success: true,
                query: userQuery,
                filters_extracted: filters,
                influencers: influencers || [],
                count: influencers?.length || 0,
            });
        } catch (error) {
            console.error("AI search error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message,
            });
        }
    }
}

module.exports = new InfluencerController();
