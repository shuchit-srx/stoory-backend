const { supabaseAdmin } = require('../supabase/client');

class UserController {
    /**
     * List influencers for brand owners with filtering and pagination
     */
    async listInfluencers(req, res) {
        try {
            const {
                page = 1,
                limit = 10,
                search,
                languages,
                categories,
                min_range,
                max_range,
                sort_by = 'created_at',
                sort_order = 'desc'
            } = req.query;

            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const offset = (pageNum - 1) * limitNum;

            // Parse list filters (comma-separated or array)
            const parseList = (val) => {
                if (!val) return null;
                if (Array.isArray(val)) return val.filter(Boolean);
                if (typeof val === 'string') return val.split(',').map(v => v.trim()).filter(Boolean);
                return null;
            };

            const languagesFilter = parseList(languages);
            const categoriesFilter = parseList(categories);

            // Whitelist sort fields
            const allowedSortBy = new Set(['created_at', 'min_range', 'max_range']);
            const sortField = allowedSortBy.has(sort_by) ? sort_by : 'created_at';
            const sortAscending = (String(sort_order).toLowerCase() === 'asc');

            let query = supabaseAdmin
                .from('users')
                .select(`
                    id,
                    phone,
                    name,
                    email,
                    role,
                    languages,
                    categories,
                    min_range,
                    max_range,
                    created_at,
                    social_platforms (*)
                `, { count: 'exact' })
                .eq('role', 'influencer')
                .eq('is_deleted', false);

            // Search across name, email, phone
            if (search && String(search).trim().length > 0) {
                const term = String(search).trim();
                query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
            }

            // Array overlaps for languages and categories
            if (languagesFilter && languagesFilter.length > 0) {
                query = query.overlaps('languages', languagesFilter);
            }
            if (categoriesFilter && categoriesFilter.length > 0) {
                query = query.overlaps('categories', categoriesFilter);
            }

            // Range filters
            if (min_range !== undefined && min_range !== null && min_range !== '') {
                const minVal = Number(min_range);
                if (!Number.isNaN(minVal)) {
                    query = query.gte('min_range', minVal);
                }
            }
            if (max_range !== undefined && max_range !== null && max_range !== '') {
                const maxVal = Number(max_range);
                if (!Number.isNaN(maxVal)) {
                    query = query.lte('max_range', maxVal);
                }
            }

            const { data: influencers, error, count } = await query
                .order(sortField, { ascending: sortAscending })
                .range(offset, offset + limitNum - 1);

            if (error) {
                return res.status(500).json({ success: false, message: 'Failed to fetch influencers' });
            }

            return res.json({
                success: true,
                influencers: influencers || [],
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limitNum)
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
}

module.exports = {
    UserController: new UserController()
};



