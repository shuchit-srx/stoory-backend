/**
 * Filter Helper Utilities
 * Provides reusable functions for applying filters to Supabase queries
 */

/**
 * Apply array filter with OR logic (array overlap)
 * Checks if any element in the filter array matches any element in the database array
 * 
 * @param {Object} query - Supabase query object
 * @param {string} field - Database field name (must be array type)
 * @param {Array} values - Filter values
 * @param {string} logic - 'OR' for overlap, 'AND' for contains (default: 'OR')
 * @returns {Object} Modified query object
 */
function applyArrayFilter(query, field, values, logic = 'OR') {
    if (!values || !Array.isArray(values) || values.length === 0) {
        return query;
    }

    // Filter out null/undefined values and convert to lowercase
    const cleanValues = values
        .filter(v => v != null && v !== '')
        .map(v => String(v).toLowerCase());
    if (cleanValues.length === 0) {
        return query;
    }

    if (logic === 'OR') {
        // PostgreSQL array overlap operator (&&)
        // Returns true if arrays have at least one element in common
        return query.overlaps(field, cleanValues);
    } else if (logic === 'AND') {
        // PostgreSQL array contains operator (@>)
        // Returns true if left array contains all elements of right array
        return query.contains(field, cleanValues);
    }

    return query;
}

/**
 * Apply budget range filter
 * For campaigns/bids: filters by min_budget and max_budget
 * For influencers: filters by budget_range_min and budget_range_max
 * 
 * @param {Object} query - Supabase query object
 * @param {string} minField - Database field for minimum budget
 * @param {string} maxField - Database field for maximum budget
 * @param {number} filterMin - Filter minimum value
 * @param {number} filterMax - Filter maximum value
 * @returns {Object} Modified query object
 */
function applyBudgetRangeFilter(query, minField, maxField, filterMin, filterMax) {
    if (filterMin !== undefined && filterMin !== null && !isNaN(filterMin)) {
        query = query.gte(minField, parseFloat(filterMin));
    }
    if (filterMax !== undefined && filterMax !== null && !isNaN(filterMax)) {
        query = query.lte(maxField, parseFloat(filterMax));
    }
    return query;
}

/**
 * Apply text search filter
 * Searches across multiple fields with case-insensitive matching
 * 
 * @param {Object} query - Supabase query object
 * @param {string} searchTerm - Search term
 * @param {Array<string>} fields - Fields to search in
 * @returns {Object} Modified query object
 */
function applyTextSearch(query, searchTerm, fields = ['title', 'description']) {
    if (!searchTerm || searchTerm.trim() === '') {
        return query;
    }

    const term = searchTerm.trim();
    const orConditions = fields.map(field => `${field}.ilike.%${term}%`).join(',');

    return query.or(orConditions);
}

/**
 * Parse array from query parameter
 * Handles both comma-separated strings and JSON arrays
 * 
 * @param {string|Array} param - Query parameter value
 * @returns {Array} Parsed array
 */
function parseArrayParam(param) {
    if (!param) return null;

    // Already an array
    if (Array.isArray(param)) {
        return param.filter(v => v != null && v !== '');
    }

    // Try parsing as JSON
    if (typeof param === 'string') {
        try {
            const parsed = JSON.parse(param);
            if (Array.isArray(parsed)) {
                return parsed.filter(v => v != null && v !== '');
            }
        } catch (e) {
            // Not JSON, try comma-separated
            return param.split(',')
                .map(v => v.trim())
                .filter(v => v !== '');
        }
    }

    return null;
}

/**
 * Apply all common filters for campaigns/bids
 * 
 * @param {Object} query - Supabase query object
 * @param {Object} filters - Filter object
 * @returns {Object} Modified query object
 */
function applyCommonFilters(query, filters) {
    const {
        min_budget,
        max_budget,
        languages,
        locations,
        categories,
        search,
        // Logic parameters (default to OR)
        languages_logic = 'OR',
        locations_logic = 'OR',
        categories_logic = 'OR',
        filter_logic = 'OR' // Global fallback
    } = filters;

    // Budget range
    query = applyBudgetRangeFilter(query, 'min_budget', 'max_budget', min_budget, max_budget);

    // Array filters
    // Use specific logic if provided, otherwise global fallback, otherwise default 'OR'
    query = applyArrayFilter(query, 'languages', parseArrayParam(languages), languages_logic || filter_logic || 'OR');
    query = applyArrayFilter(query, 'locations', parseArrayParam(locations), locations_logic || filter_logic || 'OR');
    query = applyArrayFilter(query, 'categories', parseArrayParam(categories), categories_logic || filter_logic || 'OR');

    // Text search
    query = applyTextSearch(query, search);

    return query;
}

/**
 * Apply influencer-specific filters
 * 
 * @param {Object} query - Supabase query object
 * @param {Object} filters - Filter object
 * @returns {Object} Modified query object
 */
function applyInfluencerFilters(query, filters) {
    const {
        min_budget,
        max_budget,
        languages,
        locations,
        categories,
        // Logic parameters (default to OR)
        languages_logic = 'OR',
        locations_logic = 'OR',
        categories_logic = 'OR',
        filter_logic = 'OR' // Global fallback
    } = filters;

    // Budget range (for influencers, use budget_range_min/max)
    query = applyBudgetRangeFilter(query, 'budget_range_min', 'budget_range_max', min_budget, max_budget);

    // Array filters
    query = applyArrayFilter(query, 'languages', parseArrayParam(languages), languages_logic || filter_logic || 'OR');
    query = applyArrayFilter(query, 'locations', parseArrayParam(locations), locations_logic || filter_logic || 'OR');
    query = applyArrayFilter(query, 'categories', parseArrayParam(categories), categories_logic || filter_logic || 'OR');

    return query;
}

module.exports = {
    applyArrayFilter,
    applyBudgetRangeFilter,
    applyTextSearch,
    parseArrayParam,
    applyCommonFilters,
    applyInfluencerFilters
};
